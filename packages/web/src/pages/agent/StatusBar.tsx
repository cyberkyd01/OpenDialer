import { useState } from 'react';
import type { AgentController } from '../../agent/controller';
import { isBusyState, useAgent } from '../../agent/store';
import { StateBadge, useNow } from '../../components/ui';
import { fmtDuration, secondsSince } from '../../lib/format';

const STATE_LABEL: Record<string, string> = {
  offline: 'Offline',
  paused: 'Paused',
  ready: 'Ready – waiting for a lead',
  assigned: 'Lead assigned',
  dialing: 'Dialing',
  talking: 'Talking',
  wrapup: 'Wrap-up',
};

export function StatusBar({ ctrl, pauseCodes }: { ctrl: AgentController; pauseCodes: string[] }) {
  const agent = useAgent((s) => s.agent);
  const campaign = useAgent((s) => s.campaign);
  const pendingPause = useAgent((s) => s.pendingPause);
  const busy = useAgent((s) => s.busy);
  const [menu, setMenu] = useState(false);
  const now = useNow(1000);
  const state = agent?.state ?? 'offline';
  const codes = pauseCodes.length ? pauseCodes : ['Break'];

  return (
    <section className={`statusbar st-${state}`} aria-label="Agent status">
      <div className="stack tight grow" style={{ minWidth: 200 }}>
        <div className="row">
          <StateBadge state={state} />
          <span className="state-name" data-testid="agent-state" data-state={state}>
            {STATE_LABEL[state] ?? state}
            {state === 'paused' && agent?.pauseCode ? ` (${agent.pauseCode})` : ''}
          </span>
          <span className="timer" aria-label="Time in state">
            {fmtDuration(secondsSince(agent?.since, now))}
          </span>
        </div>
        <div className="muted small">
          {campaign ? (
            <>
              Campaign <strong>{campaign.name}</strong> · {campaign.dialMode}
              {campaign.status !== 'active' && <span className="badge amber" style={{ marginLeft: 6 }}>{campaign.status}</span>}
            </>
          ) : (
            'Manual dialing (no campaign)'
          )}
          {pendingPause && (
            <span className="badge amber" style={{ marginLeft: 8 }} data-testid="pending-pause">
              Pause after this call: {pendingPause}
            </span>
          )}
        </div>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn success large"
          disabled={busy || state === 'ready' || isBusyState(state)}
          onClick={() => void ctrl.ready()}
        >
          Ready
        </button>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn warning large"
            aria-haspopup="menu"
            aria-expanded={menu}
            disabled={busy}
            onClick={() => setMenu(!menu)}
          >
            Pause ▾
          </button>
          {menu && (
            <div
              role="menu"
              className="card pad-sm"
              style={{ position: 'absolute', right: 0, top: '110%', zIndex: 30, minWidth: 180 }}
              onMouseLeave={() => setMenu(false)}
            >
              <div className="stack tight">
                {codes.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="menuitem"
                    className="btn small block"
                    onClick={() => {
                      setMenu(false);
                      void ctrl.pause(c);
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy || isBusyState(state)}
          onClick={() => void ctrl.leave()}
          title="Leave this campaign"
        >
          Change campaign
        </button>
      </div>
    </section>
  );
}
