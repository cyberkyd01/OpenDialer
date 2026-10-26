import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Campaign, Disposition } from '@opendialer/shared';
import { AgentController, getController, setController } from '../../agent/controller';
import { useAgent } from '../../agent/store';
import { Brand, ThemeToggle } from '../../components/Chrome';
import { ErrorBox, Modal, Spinner, useLoad } from '../../components/ui';
import { api } from '../../lib/api';
import { hasRole, useAuth } from '../../store/auth';
import { CallControls } from './CallControls';
import { CallbacksPanel, RecentCalls } from './SidePanels';
import { LeadCard, ScriptPanel } from './LeadCard';
import { ManualDial } from './ManualDial';
import { StatusBar } from './StatusBar';
import { WrapupPanel } from './WrapupPanel';

function PhonePill() {
  const status = useAgent((s) => s.phoneStatus);
  const kind = useAgent((s) => s.phoneKind);
  const err = useAgent((s) => s.phoneError);
  const map: Record<string, [string, string]> = {
    registered: ['ok', 'Registered'],
    connected: ['ok', 'Connected'],
    simulated: ['sim', 'Simulated'],
    connecting: ['warn', 'Connecting'],
    disconnected: ['warn', kind ? 'Offline' : 'Connecting'],
    error: ['err', 'Error'],
  };
  const [cls, label] = map[status] ?? ['warn', status];
  return (
    <span className={`status-pill ${cls}`} title={err ?? `Softphone: ${label}`} data-testid="phone-status">
      <span className="dot" /> Phone: {label}
    </span>
  );
}

function ConnPill() {
  const c = useAgent((s) => s.connection);
  if (c === 'connected' || c === 'idle') return null;
  const cls = c === 'replaced' || c === 'closed' ? 'err' : 'warn';
  const label = c === 'connecting' ? 'Connecting…' : c === 'reconnecting' ? 'Reconnecting…' : c === 'replaced' ? 'Signed in elsewhere' : c;
  return (
    <span className={`status-pill ${cls}`}>
      <span className="dot" /> {label}
    </span>
  );
}

function CampaignPicker({ ctrl }: { ctrl: AgentController }) {
  const { data, error, loading, reload } = useLoad(() => api.get<Campaign[]>('/campaigns'), []);
  const usable = useMemo(() => (data ?? []).filter((c) => c.status === 'active' || c.status === 'paused'), [data]);
  const [sel, setSel] = useState<string>('');
  const busy = useAgent((s) => s.busy);
  const connection = useAgent((s) => s.connection);
  const blocked = connection === 'replaced' || connection === 'connecting';
  useEffect(() => {
    if (!sel && usable.length) setSel(String(usable.find((c) => c.status === 'active')?.id ?? usable[0].id));
  }, [usable, sel]);
  return (
    <div className="card" style={{ maxWidth: 560, margin: '2rem auto' }}>
      <h2>Start working</h2>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? (
        <Spinner label="Loading campaigns…" />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void ctrl.join(sel ? Number(sel) : null);
          }}
        >
          {usable.length ? (
            <label className="field">
              <span>Campaign</span>
              <select aria-label="Campaign" value={sel} onChange={(e) => setSel(e.target.value)}>
                {usable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} – {c.dialMode}
                    {c.status === 'paused' ? ' (paused)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted">You are not assigned to an active campaign yet. You can still join for manual dialing.</p>
          )}
          <div className="row">
            <button type="submit" className="btn primary large" disabled={busy || blocked || !sel}>
              Join campaign
            </button>
            <button type="button" className="btn" disabled={busy || blocked} onClick={() => void ctrl.join(null)}>
              Manual dialing only
            </button>
          </div>
          {connection === 'connecting' && <span className="muted small">Connecting to the server…</span>}
        </form>
      )}
    </div>
  );
}

function ReplacedModal() {
  const replaced = useAgent((s) => s.connection === 'replaced');
  const nav = useNavigate();
  if (!replaced) return null;
  return (
    <Modal title="Signed in elsewhere" onClose={() => {}}>
      <p>Your account was opened in another window or device. This console has been disconnected and its softphone stopped.</p>
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            useAuth.getState().logout();
            nav('/login');
          }}
        >
          Log out
        </button>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Use this window
        </button>
      </div>
    </Modal>
  );
}

export default function AgentConsole() {
  const user = useAuth((s) => s.user);
  const settings = useAuth((s) => s.settings);
  const nav = useNavigate();
  const [ctrl, setCtrl] = useState<AgentController | null>(null);
  const joined = useAgent((s) => s.joined);
  const connection = useAgent((s) => s.connection);
  const dispositions = useLoad(() => api.get<Disposition[]>('/dispositions'), []);

  useEffect(() => {
    const c = new AgentController({ onUnauthorized: () => useAuth.getState().expire() });
    setController(c);
    setCtrl(c);
    void c.start();
    return () => {
      c.stop();
      if (getController() === c) setController(null);
    };
  }, []);

  const logout = async () => {
    await ctrl?.leave();
    useAuth.getState().logout();
    nav('/login');
  };

  return (
    <>
      <header className="topbar">
        <Brand to="/agent" />
        <span className="who" data-testid="agent-name">
          {user?.displayName}
        </span>
        <span className="spacer" />
        <ConnPill />
        <PhonePill />
        {hasRole(user, 'supervisor') && (
          <Link className="btn small" to="/admin/dashboard">
            Admin
          </Link>
        )}
        <ThemeToggle />
        <button type="button" className="btn small" onClick={() => void logout()}>
          Log out
        </button>
      </header>
      {connection === 'reconnecting' && <div className="banner warn">Connection lost – reconnecting… your call stays up.</div>}
      <main className="page">
        {!ctrl ? null : !joined ? (
          <CampaignPicker ctrl={ctrl} />
        ) : (
          <>
            <StatusBar ctrl={ctrl} pauseCodes={settings?.pauseCodes ?? []} />
            <div className="console">
              <div className="stack">
                <LeadCard ctrl={ctrl} dispositions={dispositions.data ?? []} consentNotice={settings?.recordingConsentNotice ?? ''} />
                <ScriptPanel agentName={user?.displayName ?? ''} companyName={settings?.companyName ?? ''} />
              </div>
              <div className="stack col-call">
                <CallControls ctrl={ctrl} />
                <WrapupPanel ctrl={ctrl} dispositions={dispositions.data ?? []} pauseCodes={settings?.pauseCodes ?? []} />
              </div>
              <div className="stack col-side">
                <ManualDial ctrl={ctrl} />
                <CallbacksPanel ctrl={ctrl} />
                <RecentCalls dispositions={dispositions.data ?? []} />
              </div>
            </div>
          </>
        )}
      </main>
      <ReplacedModal />
    </>
  );
}
