import { useEffect, useMemo, useState } from 'react';
import type { Disposition, DispositionCategory } from '@opendialer/shared';
import type { AgentController } from '../../agent/controller';
import { useAgent } from '../../agent/store';
import { confirmDialog, useNow } from '../../components/ui';
import { fromLocalInput, toLocalInput } from '../../lib/format';

const GROUPS: { cat: DispositionCategory; label: string }[] = [
  { cat: 'contact', label: 'Contact' },
  { cat: 'callback', label: 'Callback' },
  { cat: 'no_contact', label: 'No contact' },
  { cat: 'invalid', label: 'Invalid' },
  { cat: 'dnc', label: 'Do not call' },
];

export function WrapupPanel({ ctrl, dispositions, pauseCodes }: { ctrl: AgentController; dispositions: Disposition[]; pauseCodes: string[] }) {
  const agent = useAgent((s) => s.agent);
  const call = useAgent((s) => s.call);
  const disposedEarly = useAgent((s) => s.disposedEarly);
  const busy = useAgent((s) => s.busy);
  const wrapupDeadline = useAgent((s) => s.wrapupDeadline);
  const lead = useAgent((s) => s.lead);
  const now = useNow(1000);
  const callId = call?.callId ?? agent?.callId ?? null;

  const [selected, setSelected] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [cbAt, setCbAt] = useState('');
  const [cbNote, setCbNote] = useState('');
  const [cbPersonal, setCbPersonal] = useState(true);
  const [pauseAfter, setPauseAfter] = useState(false);
  const [pauseCode, setPauseCode] = useState(pauseCodes[0] ?? 'Break');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
    setNotes('');
    setCbAt(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
    setCbNote('');
    setCbPersonal(true);
    setPauseAfter(false);
    setError(null);
  }, [callId]);

  const grouped = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: dispositions.filter((d) => d.category === g.cat).sort((a, b) => a.sortOrder - b.sortOrder) })).filter((g) => g.items.length),
    [dispositions],
  );

  const state = agent?.state;
  const visible = callId != null && !disposedEarly && (state === 'wrapup' || state === 'talking' || state === 'dialing');
  if (!visible) return null;

  const chosen = dispositions.find((d) => d.id === selected) ?? null;
  const isCallback = chosen?.category === 'callback';
  const remaining = wrapupDeadline ? Math.ceil((wrapupDeadline - now) / 1000) : null;

  const submit = async () => {
    if (!chosen) {
      setError('Choose a disposition');
      return;
    }
    if (isCallback && !cbAt) {
      setError('Pick a date and time for the callback');
      return;
    }
    if (isCallback && !lead) {
      setError('Callbacks need a lead – this was a manual call to an unknown number');
      return;
    }
    if (chosen.category === 'dnc') {
      const ok = await confirmDialog({
        title: 'Add to do-not-call list?',
        message: 'This number will never be dialed again by any campaign.',
        confirmLabel: 'Yes, do not call',
        danger: true,
      });
      if (!ok) return;
    }
    setError(null);
    await ctrl.dispose({
      dispositionId: chosen.id,
      notes: notes.trim() || undefined,
      callback: isCallback ? { scheduledAt: fromLocalInput(cbAt), note: cbNote.trim() || undefined, personal: cbPersonal } : undefined,
      pauseAfter: pauseAfter ? pauseCode : null,
    });
  };

  return (
    <section className="card stack" aria-label="Disposition" data-testid="wrapup-panel">
      <div className="card-title" style={{ margin: 0 }}>
        <h3 style={{ margin: 0 }}>{state === 'wrapup' ? 'Wrap-up' : 'Disposition'}</h3>
        {remaining != null && (
          <span className={`countdown ${remaining <= 0 ? 'danger-text' : 'muted'}`}>{remaining > 0 ? `${remaining}s left` : 'Wrap-up time exceeded'}</span>
        )}
      </div>
      {state !== 'wrapup' && <p className="muted small" style={{ margin: 0 }}>You can save the result before the call ends.</p>}
      {grouped.map((g) => (
        <div key={g.cat} className="dispo-group">
          <h4>{g.label}</h4>
          <div className="dispo-grid">
            {g.items.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`btn dispo-btn ${selected === d.id ? 'selected' : ''}`}
                style={{ background: d.color }}
                aria-pressed={selected === d.id}
                onClick={() => setSelected(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {isCallback && (
        <fieldset className="stack">
          <legend>Callback</legend>
          <label className="field">
            <span>When</span>
            <input type="datetime-local" aria-label="Callback time" value={cbAt} onChange={(e) => setCbAt(e.target.value)} />
          </label>
          <label className="field">
            <span>Callback note</span>
            <input value={cbNote} aria-label="Callback note" onChange={(e) => setCbNote(e.target.value)} placeholder="e.g. Call back after the board meeting" />
          </label>
          <div className="row">
            <label className="check">
              <input type="radio" name="cbwho" checked={cbPersonal} onChange={() => setCbPersonal(true)} /> Only me
            </label>
            <label className="check">
              <input type="radio" name="cbwho" checked={!cbPersonal} onChange={() => setCbPersonal(false)} /> Any agent
            </label>
          </div>
        </fieldset>
      )}
      <label className="field">
        <span>Call notes</span>
        <textarea aria-label="Call notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={pauseAfter} onChange={(e) => setPauseAfter(e.target.checked)} /> Pause after
        </label>
        {pauseAfter && (
          <select aria-label="Pause code" value={pauseCode} onChange={(e) => setPauseCode(e.target.value)} style={{ width: 'auto' }}>
            {(pauseCodes.length ? pauseCodes : ['Break']).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <button type="button" className="btn primary large block" disabled={busy || !chosen} onClick={() => void submit()}>
        {chosen ? `Submit – ${chosen.label}` : 'Choose a disposition'}
      </button>
    </section>
  );
}
