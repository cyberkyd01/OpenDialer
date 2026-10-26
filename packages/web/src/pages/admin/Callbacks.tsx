import { useState } from 'react';
import { formatPhone, type Callback, type Campaign, type User } from '@opendialer/shared';
import { Empty, ErrorBox, Modal, useLoad } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { fmtDateTime, fromLocalInput, leadName, toLocalInput } from '../../lib/format';
import { toast } from '../../store/toasts';

function EditCallback({ cb, agents, onClose, onSaved }: { cb: Callback; agents: User[]; onClose: () => void; onSaved: () => void }) {
  const [at, setAt] = useState(toLocalInput(cb.scheduledAt));
  const [note, setNote] = useState(cb.note);
  const [userId, setUserId] = useState(cb.userId == null ? '' : String(cb.userId));
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Edit callback" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.patch(`/callbacks/${cb.id}`, { scheduledAt: fromLocalInput(at), note, userId: userId ? Number(userId) : null });
            toast.success('Callback updated');
            onSaved();
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
          <span>Assigned to</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Any agent on the campaign</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
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

export default function Callbacks() {
  const [status, setStatus] = useState('pending');
  const [campaignId, setCampaignId] = useState('');
  const [userId, setUserId] = useState('');
  const campaigns = useLoad(() => api.get<Campaign[]>('/campaigns'), []);
  const users = useLoad(() => api.get<User[]>('/users'), []);
  const { data, error, reload } = useLoad(
    () => api.get<Callback[]>('/callbacks', { scope: 'all', status, campaignId: campaignId || undefined, userId: userId || undefined }),
    [status, campaignId, userId],
  );
  const [editing, setEditing] = useState<Callback | null>(null);
  const agents = (users.data ?? []).filter((u) => u.active);
  const camp = new Map((campaigns.data ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Callbacks</h1>
      </div>
      <div className="row">
        <select aria-label="Status" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select aria-label="Campaign" style={{ width: 'auto' }} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">All campaigns</option>
          {(campaigns.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Agent" style={{ width: 'auto' }} value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Lead</th>
              <th>Number</th>
              <th>Campaign</th>
              <th>Agent</th>
              <th>Note</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((cb) => (
              <tr key={cb.id}>
                <td className="nowrap">{fmtDateTime(cb.scheduledAt)}</td>
                <td>{cb.lead ? leadName(cb.lead) : `#${cb.leadId}`}</td>
                <td className="mono nowrap">{cb.lead ? formatPhone(cb.lead.phone) : ''}</td>
                <td>{camp.get(cb.campaignId) ?? `#${cb.campaignId}`}</td>
                <td>{cb.userId == null ? <span className="muted">any agent</span> : (cb.agentName ?? `#${cb.userId}`)}</td>
                <td>{cb.note}</td>
                <td>{cb.status}</td>
                <td className="actions">
                  {cb.status === 'pending' && (
                    <>
                      <button type="button" className="btn small" onClick={() => setEditing(cb)}>
                        Reassign / reschedule
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={async () => {
                          try {
                            await api.patch(`/callbacks/${cb.id}`, { status: 'cancelled' });
                            void reload();
                          } catch (err) {
                            toast.error(describeError(err));
                          }
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.length === 0 && <Empty>No callbacks.</Empty>}
      </div>
      {editing && (
        <EditCallback
          cb={editing}
          agents={agents}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
