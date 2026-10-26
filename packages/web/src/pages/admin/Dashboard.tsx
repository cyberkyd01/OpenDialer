import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { formatPhone, RT_NAMESPACE, type Ack, type Campaign, type WallboardSnapshot } from '@opendialer/shared';
import { ErrorBox, StateBadge, confirmDialog, useLoad, useNow } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { getServerUrl, getToken } from '../../lib/config';
import { fmtDuration, secondsSince } from '../../lib/format';
import { toast } from '../../store/toasts';

type Mode = 'socket' | 'polling';

/** Live wallboard over its own socket (`wallboard:subscribe`); REST polling only if the subscription is refused. */
function useWallboard() {
  const [snap, setSnap] = useState<WallboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('socket');

  useEffect(() => {
    if (mode !== 'socket') return;
    const socket: Socket = io(getServerUrl() + RT_NAMESPACE, { auth: { token: getToken() ?? '' } });
    socket.on('connect', () => {
      setError(null);
      socket.emit('wallboard:subscribe', {}, (r: Ack<WallboardSnapshot>) => {
        if (r.ok && r.data) setSnap(r.data);
        else setMode('polling');
      });
    });
    socket.on('wallboard:update', (s: WallboardSnapshot) => setSnap(s));
    socket.on('connect_error', (e: Error) => setError(`Live connection failed: ${e.message}`));
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'polling') return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.get<WallboardSnapshot>('/wallboard');
        if (!stop) {
          setSnap(s);
          setError(null);
        }
      } catch (err) {
        if (!stop) setError(describeError(err));
      }
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [mode]);

  return { snap, error, mode };
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const { snap, error, mode } = useWallboard();
  const campaigns = useLoad(() => api.get<Campaign[]>('/campaigns'), []);
  const now = useNow(1000);
  const names = useMemo(() => new Map((campaigns.data ?? []).map((c) => [c.id, c.name])), [campaigns.data]);

  const forceLogout = async (userId: number, name: string) => {
    if (!(await confirmDialog({ title: `Log out ${name}?`, message: 'Their current lead is released and any call record is closed.', confirmLabel: 'Log out', danger: true }))) return;
    try {
      await api.post(`/agents/${userId}/logout`);
      toast.success(`${name} logged out`);
    } catch (err) {
      toast.error(describeError(err));
    }
  };

  const t = snap?.today;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Live dashboard</h1>
        <span className="muted small">
          {mode === 'socket' ? 'Live' : 'Polling every 2 s'}
          {snap ? ` · updated ${new Date(snap.at).toLocaleTimeString()}` : ''}
        </span>
      </div>
      <ErrorBox error={error} />
      <div className="grid cols-4">
        <Stat label="Calls today" value={t?.calls ?? '–'} />
        <Stat label="Answered" value={t?.answered ?? '–'} />
        <Stat label="Contacts / sales" value={t ? `${t.contacts} / ${t.sales}` : '–'} />
        <Stat label="Talk time" value={t ? fmtDuration(t.talkSec) : '–'} />
      </div>

      <section className="stack">
        <h2>
          Agents <span className="badge">{snap?.agents.length ?? 0} online</span>
        </h2>
        {snap && snap.agents.length === 0 && <p className="muted">No agents are logged in.</p>}
        <div className="grid auto" data-testid="agent-grid">
          {snap?.agents.map((a) => (
            <div key={a.userId} className={`agent-tile st-${a.state}`} data-testid="agent-tile" data-agent={a.username} data-state={a.state}>
              <div className="row between">
                <strong>{a.displayName}</strong>
                <StateBadge state={a.state} label={a.state === 'paused' && a.pauseCode ? `paused · ${a.pauseCode}` : a.state} />
              </div>
              <div className="countdown" style={{ fontSize: '1.3rem' }}>
                {fmtDuration(secondsSince(a.stateSince, now))}
              </div>
              <div className="small muted">{a.campaignName ?? 'No campaign'}</div>
              {(a.leadName || a.phone) && (
                <div className="small">
                  {a.leadName} {a.phone && <span className="mono">{formatPhone(a.phone)}</span>}
                </div>
              )}
              <div className="row between small muted" style={{ marginTop: 6 }}>
                <span>
                  {a.callsToday} calls · {fmtDuration(a.talkSecToday)} talk
                </span>
                <button type="button" className="btn small ghost" onClick={() => void forceLogout(a.userId, a.displayName)}>
                  Log out
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>Campaigns</h2>
        {snap && snap.campaigns.length === 0 && <p className="muted">No active or paused campaigns.</p>}
        <div className="grid auto">
          {snap?.campaigns.map((c) => {
            const done = c.leadsDone + c.leadsDnc + c.leadsInvalid;
            const pct = c.leadsTotal ? Math.round((done / c.leadsTotal) * 100) : 0;
            return (
              <div key={c.campaignId} className="card pad-sm stack tight">
                <strong>{names.get(c.campaignId) ?? `Campaign #${c.campaignId}`}</strong>
                <div className="bar" title={`${pct}% worked`}>
                  <span style={{ width: `${pct}%`, background: 'var(--primary)' }} />
                </div>
                <div className="small muted">
                  {c.dialable} dialable · {c.leadsTotal} leads · {pct}% done
                </div>
                <div className="small">
                  {c.callsToday} calls today · {c.contacts} contacts · {c.sales} sales · {c.agentsOnline} agents
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
