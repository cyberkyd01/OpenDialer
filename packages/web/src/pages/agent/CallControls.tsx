import { useState } from 'react';
import { formatPhone } from '@opendialer/shared';
import type { AgentController } from '../../agent/controller';
import { recordingPolicy, useAgent } from '../../agent/store';
import { promptDialog, useNow } from '../../components/ui';
import { fmtDuration } from '../../lib/format';
import { dtmfTone } from '../../phone/tones';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

const CAUSE_LABEL: Record<string, string> = {
  normal: 'Call ended',
  busy: 'Busy',
  'no-answer': 'No answer',
  cancelled: 'Cancelled',
  failed: 'Call failed',
};

export function CallControls({ ctrl }: { ctrl: AgentController }) {
  const call = useAgent((s) => s.call);
  const recordToggle = useAgent((s) => s.recordToggle);
  const policy = useAgent((s) => recordingPolicy(s));
  const [keypad, setKeypad] = useState(false);
  const [digits, setDigits] = useState('');
  const now = useNow(500);

  if (!call) {
    if (policy !== 'agent') return null;
    return (
      <section className="card" aria-label="Call">
        <label className="check">
          <input type="checkbox" checked={recordToggle} onChange={(e) => void ctrl.setRecord(e.target.checked)} /> Record my next call
        </label>
      </section>
    );
  }

  const live = call.phase !== 'ended';
  const talking = call.phase === 'talking';
  const seconds =
    call.phase === 'talking'
      ? (now - (call.answeredAt ?? now)) / 1000
      : call.phase === 'ended'
        ? ((call.endedAt ?? now) - (call.answeredAt ?? call.startedAt)) / 1000
        : (now - call.startedAt) / 1000;
  const phaseLabel =
    call.phase === 'dialing' ? 'Dialing…' : call.phase === 'ringing' ? 'Ringing…' : call.phase === 'talking' ? (call.held ? 'On hold' : 'Talking') : (CAUSE_LABEL[call.cause ?? ''] ?? `Ended (${call.cause})`);

  const transfer = async () => {
    const target = await promptDialog({ title: 'Blind transfer', message: 'Number or extension to transfer this call to:', confirmLabel: 'Transfer', placeholder: 'e.g. 2001 or +14155550123' });
    if (target) await ctrl.transfer(target);
  };

  return (
    <section className="card stack" aria-label="Call">
      <div className="call-phase" data-testid="call-phase" data-phase={call.phase} style={{ color: talking ? 'var(--st-talking)' : live ? 'var(--st-dialing)' : 'var(--muted)' }}>
        {phaseLabel}
      </div>
      <div className="call-timer" aria-label="Call timer">
        {fmtDuration(seconds)}
      </div>
      <div className="muted" style={{ textAlign: 'center' }}>
        {formatPhone(call.phone) || call.phone}
        {call.recording && (
          <span className="badge red" style={{ marginLeft: 8 }}>
            <span className="rec-dot" /> REC
          </span>
        )}
      </div>
      {live && (
        <button type="button" className="btn danger large block" onClick={() => ctrl.hangup()}>
          Hang up
        </button>
      )}
      {talking && (
        <div className="grid cols-2">
          <button type="button" className={`btn ${call.muted ? 'active' : ''}`} aria-pressed={call.muted} onClick={() => ctrl.mute(!call.muted)}>
            {call.muted ? 'Unmute' : 'Mute'}
          </button>
          <button type="button" className={`btn ${call.held ? 'active' : ''}`} aria-pressed={call.held} onClick={() => void ctrl.hold(!call.held)}>
            {call.held ? 'Resume' : 'Hold'}
          </button>
          <button type="button" className={`btn ${keypad ? 'active' : ''}`} aria-pressed={keypad} onClick={() => setKeypad(!keypad)}>
            Keypad
          </button>
          <button type="button" className="btn" onClick={() => void transfer()}>
            Transfer
          </button>
        </div>
      )}
      {talking && keypad && (
        <div className="stack tight">
          <input readOnly value={digits} aria-label="Sent digits" className="mono" />
          <div className="keypad">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className="btn"
                onClick={() => {
                  dtmfTone(k);
                  ctrl.sendDtmf(k);
                  setDigits((d) => (d + k).slice(-24));
                }}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}
      {policy === 'agent' && (
        <label className="check">
          <input type="checkbox" checked={recordToggle} onChange={(e) => void ctrl.setRecord(e.target.checked)} /> Record this call
        </label>
      )}
      {policy === 'always' && <span className="muted small">All calls in this campaign are recorded.</span>}
    </section>
  );
}
