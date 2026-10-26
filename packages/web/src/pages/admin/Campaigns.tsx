import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Campaign } from '@opendialer/shared';
import { Empty, ErrorBox, Modal, useLoad } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { toast } from '../../store/toasts';
import { CampaignForm, defaultCampaign } from './CampaignForm';

export function StatusBadge({ status }: { status: string }) {
  const cls = status === 'active' ? 'green' : status === 'paused' ? 'amber' : status === 'completed' ? '' : 'blue';
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default function Campaigns() {
  const { data, error, reload } = useLoad(() => api.get<Campaign[]>('/campaigns'), []);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Campaigns</h1>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          + New campaign
        </button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Hours</th>
              <th>Recording</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/admin/campaigns/${c.id}`}>{c.name}</Link>
                </td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
                <td>{c.dialMode}</td>
                <td className="nowrap">{c.callingHoursStart === c.callingHoursEnd ? 'All day' : `${c.callingHoursStart}–${c.callingHoursEnd}`}</td>
                <td>{c.recording}</td>
                <td className="nowrap">{fmtDateTime(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.length === 0 && <Empty>No campaigns yet – create your first one.</Empty>}
      </div>
      {creating && (
        <Modal title="New campaign" wide onClose={() => setCreating(false)}>
          <CampaignForm
            initial={defaultCampaign()}
            submitLabel="Create campaign"
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              const c = await api.post<Campaign>('/campaigns', v);
              toast.success(`Campaign "${c.name}" created`);
              setCreating(false);
              nav(`/admin/campaigns/${c.id}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
