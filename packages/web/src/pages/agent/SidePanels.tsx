import { useState } from 'react';
import { formatPhone, type CallLog, type Callback, type Disposition, type Paginated } from '@opendialer/shared';
import type { AgentController } from '../../agent/controller';
import { useAgent } from '../../agent/store';
import { ErrorBox, Modal, useLoad } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { fmtDateTime, fmtDuration, fromLocalInput, leadName, toLocalInput } from '../../lib/format';
import { toast } from '../../store/toasts';

function Reschedule({ cb, onClose, onDone }: { cb: Callback; onClose: () => void; onDone: () => void }) {
  const [at, setAt] = useState(toLocalInput(cb.scheduledAt));
  const [note, setNote] = useState(cb.note);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Reschedule callback" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.patch(`/callbacks/${cb.id}`, { scheduledAt: fromLocalInput(at), note });
            toast.success('Callback rescheduled');
            onDone();
          } catch (err) {
            toast.error(describeError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>When</span>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
        </label>
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CallbacksPanel({ ctrl }: { ctrl: AgentController }) {
  const version = useAgent((s) => s.callbacksVersion);
  const state = useAgent((s) => s.agent?.state);
  const call = useAgent((s) => s.call);
  const { data, error, reload } = useLoad(() => api.get<Callback[]>('/callbacks', { scope: 'mine', status: 'pending' }), [version]);
  const [editing, setEditing] = useState<Callback | null>(null);
  const canDial = (state === 'ready' || state === 'paused') && !call;
  const list = data ?? [];

  const cancel = async (cb: Callback) => {
    try {
      await api.patch(`/callbacks/${cb.id}`, { status: 'cancelled' });
      toast.info('Callback cancelled');
      void reload();
    } catch (err) {
      toast.error(describeError(err));
    }
  };

  return (
    <section className="card" aria-label="My callbacks">
      <h3>
        My callbacks <span className="badge">{list.length}</span>
      </h3>
      <ErrorBox error={error} onRetry={reload} />
      {list.length === 0 ? (
        <p className="muted small">No pending callbacks.</p>
      ) : (
        <ul className="list-plain">
          {list.map((cb) => {
            const due = new Date(cb.scheduledAt).getTime() <= Date.now();
            return (
              <li key={cb.id} className="stack tight">
                <div className="row between">
                  <strong>{cb.lead ? leadName(cb.lead) || formatPhone(cb.lead.phone) : `Lead #${cb.leadId}`}</strong>
                  <span className={`badge ${due ? 'red' : 'blue'}`}>{fmtDateTime(cb.scheduledAt)}</span>
                </div>
                <div className="muted small">
                  {cb.lead && formatPhone(cb.lead.phone)}
                  {cb.userId == null && ' · any agent'}
                  {cb.note && ` · ${cb.note}`}
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={!canDial || !cb.lead}
                    onClick={async () => {
                      const err = await ctrl.manualDial(cb.lead!.phone, cb.leadId);
                      if (err) toast.error(err);
                    }}
                  >
                    Dial now
                  </button>
                  <button type="button" className="btn small" onClick={() => setEditing(cb)}>
                    Reschedule
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => void cancel(cb)}>
                    Cancel
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <Reschedule
          cb={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </section>
  );
}

export function RecentCalls({ dispositions }: { dispositions: Disposition[] }) {
  const version = useAgent((s) => s.callsVersion);
  const disposeVersion = useAgent((s) => s.agent?.state);
  const { data, error, reload } = useLoad(() => api.get<Paginated<CallLog>>('/calls', { page: 1, pageSize: 10 }), [version, disposeVersion === 'ready' || disposeVersion === 'assigned']);
  const items = data?.items ?? [];
  const dispo = (id: number | null) => dispositions.find((d) => d.id === id);
  return (
    <section className="card" aria-label="Recent calls">
      <h3>Recent calls</h3>
      <ErrorBox error={error} onRetry={reload} />
      {items.length === 0 ? (
        <p className="muted small">No calls yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Number</th>
                <th>Result</th>
                <th>Talk</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const d = dispo(c.dispositionId);
                return (
                  <tr key={c.id}>
                    <td className="nowrap small">{new Date(c.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="nowrap">
                      {c.leadName ? <div>{c.leadName}</div> : null}
                      <span className="small muted">{formatPhone(c.phone)}</span>
                    </td>
                    <td>{d ? <span className="badge" style={{ background: d.color, color: '#fff' }}>{d.code}</span> : <span className="badge">{c.result}</span>}</td>
                    <td className="nowrap">{fmtDuration(c.talkSec)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
