import { useState } from 'react';
import { formatPhone } from '@opendialer/shared';
import type { AgentController } from '../../agent/controller';
import { useAgent } from '../../agent/store';
import { api, describeError } from '../../lib/api';

export function ManualDial({ ctrl }: { ctrl: AgentController }) {
  const state = useAgent((s) => s.agent?.state);
  const call = useAgent((s) => s.call);
  const busy = useAgent((s) => s.busy);
  const [number, setNumber] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const allowed = (state === 'ready' || state === 'paused') && !call;

  const check = async () => {
    if (!number.trim()) return;
    setChecking(true);
    setMsg(null);
    try {
      const r = await api.get<{ phone: string; dnc: boolean }>('/dnc/check', { phone: number.trim() });
      setMsg(r.dnc ? { kind: 'error', text: `${formatPhone(r.phone)} is on the do-not-call list` } : { kind: 'success', text: `${formatPhone(r.phone)} is not on the DNC list` });
    } catch (err) {
      setMsg({ kind: 'error', text: describeError(err) });
    } finally {
      setChecking(false);
    }
  };

  const dial = async () => {
    if (!number.trim()) return;
    setMsg(null);
    const err = await ctrl.manualDial(number.trim());
    if (err) setMsg({ kind: 'error', text: err });
    else setNumber('');
  };

  return (
    <section className="card stack" aria-label="Manual dial">
      <h3 style={{ margin: 0 }}>Manual dial</h3>
      <form
        className="stack tight"
        onSubmit={(e) => {
          e.preventDefault();
          void dial();
        }}
      >
        <input
          type="tel"
          inputMode="tel"
          aria-label="Phone number"
          placeholder="+1 415 555 0123"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          disabled={!allowed}
        />
        <div className="row">
          <button type="button" className="btn" disabled={!number.trim() || checking} onClick={() => void check()}>
            Check DNC
          </button>
          <button type="submit" className="btn primary" disabled={!allowed || busy || !number.trim()}>
            Dial
          </button>
        </div>
        {!allowed && <span className="muted small">Available when you are Ready or Paused and not on a call.</span>}
        {msg && (
          <div className={`alert ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'} data-testid="manual-dial-msg">
            {msg.text}
          </div>
        )}
      </form>
    </section>
  );
}
