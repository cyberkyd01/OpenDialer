import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Campaign, CampaignStats, CampaignStatus, LeadList, LeadStatus, Script, User } from '@opendialer/shared';
import { Empty, ErrorBox, Loading, Modal, Tabs, confirmDialog, useLoad } from '../../components/ui';
import { api, describeError, downloadFile } from '../../lib/api';
import { fmtDateTime, fmtDuration } from '../../lib/format';
import { hasRole, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';
import { CampaignForm, DAY_NAMES, campaignToInput } from './CampaignForm';
import { StatusBadge } from './Campaigns';
import { ImportWizard } from './ImportWizard';
import { LEAD_STATUSES, LeadsTable } from './LeadsTable';

type Full = Campaign & { script: Script | null; agentIds: number[] };
type Tab = 'overview' | 'lists' | 'leads' | 'agents' | 'settings';

function Overview({ c }: { c: Full }) {
  const { data, error, reload } = useLoad(() => api.get<CampaignStats>(`/campaigns/${c.id}/stats`), [c.id]);
  useEffect(() => {
    const t = setInterval(() => void reload(), 10000);
    return () => clearInterval(t);
  }, [reload]);
  const s = data;
  const stat = (label: string, value: string | number) => (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
  return (
    <div className="stack">
      <ErrorBox error={error} onRetry={reload} />
      {s && (
        <>
          <div className="grid cols-4">
            {stat('Leads', s.leadsTotal)}
            {stat('Dialable now', s.dialable)}
            {stat('Calls today', s.callsToday)}
            {stat('Agents online', s.agentsOnline)}
            {stat('Calls total', s.callsTotal)}
            {stat('Answered', s.callsAnswered)}
            {stat('Contacts / sales', `${s.contacts} / ${s.sales}`)}
            {stat('Avg talk', fmtDuration(s.avgTalkSec))}
          </div>
          <div className="card">
            <h3>Lead status</h3>
            <div className="grid cols-3 small">
              <span>New: {s.leadsNew}</span>
              <span>In progress: {s.leadsInProgress}</span>
              <span>Callback: {s.leadsCallback}</span>
              <span>Done: {s.leadsDone}</span>
              <span>DNC: {s.leadsDnc}</span>
              <span>Invalid: {s.leadsInvalid}</span>
            </div>
          </div>
        </>
      )}
      <div className="card">
        <h3>Configuration</h3>
        <dl className="kv">
          <dt>Dial mode</dt>
          <dd>{c.dialMode}</dd>
          <dt>Calling hours</dt>
          <dd>
            {c.callingHoursStart === c.callingHoursEnd ? 'All day' : `${c.callingHoursStart}–${c.callingHoursEnd}`} on {c.callingDays.map((d) => DAY_NAMES[d]).join(', ')} ({c.timezoneMode === 'lead' ? "lead's timezone" : c.fixedTimezone})
          </dd>
          <dt>Attempts</dt>
          <dd>
            max {c.maxAttempts}, retry after {c.retryMinutes} min
          </dd>
          <dt>Preview / wrap-up</dt>
          <dd>
            {c.previewTimeoutSec ? `${c.previewTimeoutSec}s auto-dial` : 'manual dial'} / {c.wrapupTimeoutSec ? `${c.wrapupTimeoutSec}s` : 'unlimited'}
          </dd>
          <dt>Recording</dt>
          <dd>{c.recording}</dd>
          <dt>Script</dt>
          <dd>{c.script?.name ?? '—'}</dd>
          {c.description && (
            <>
              <dt>Description</dt>
              <dd>{c.description}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

function ResetDialog({ c, lists, onClose }: { c: Full; lists: LeadList[]; onClose: () => void }) {
  const [listId, setListId] = useState('');
  const [statuses, setStatuses] = useState<LeadStatus[]>(['done', 'callback', 'invalid']);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Reset leads" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await api.post<{ changed: number }>(`/campaigns/${c.id}/reset-leads`, {
              listId: listId ? Number(listId) : undefined,
              onlyStatus: statuses.length ? statuses : undefined,
            });
            toast.success(`${r.changed} leads reset to "new"`);
            onClose();
          } catch (err) {
            toast.error(describeError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">Matching leads go back to status "new" with zero attempts. DNC leads are never reset.</p>
        <label className="field">
          <span>List</span>
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">All lists</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Only leads with status</legend>
          <div className="days">
            {LEAD_STATUSES.filter((s) => s !== 'dnc').map((s) => (
              <label key={s}>
                <input type="checkbox" checked={statuses.includes(s)} onChange={(e) => setStatuses(e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s))} />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn danger" disabled={busy}>
            Reset leads
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Lists({ c }: { c: Full }) {
  const { data, error, reload } = useLoad(() => api.get<LeadList[]>(`/campaigns/${c.id}/lists`), [c.id]);
  const [name, setName] = useState('');
  const [importing, setImporting] = useState<LeadList | null>(null);
  const [resetting, setResetting] = useState(false);
  const lists = data ?? [];

  const create = async () => {
    if (!name.trim()) return;
    try {
      await api.post(`/campaigns/${c.id}/lists`, { name: name.trim() });
      setName('');
      toast.success('List created');
      void reload();
    } catch (err) {
      toast.error(describeError(err));
    }
  };

  return (
    <div className="stack">
      <ErrorBox error={error} onRetry={reload} />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input aria-label="New list name" style={{ maxWidth: 280 }} placeholder="New list name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn primary" disabled={!name.trim()}>
          Create list
        </button>
        <span className="grow" />
        <button type="button" className="btn" onClick={() => setResetting(true)}>
          Reset leads…
        </button>
        <button type="button" className="btn" onClick={() => void downloadFile('/reports/export/leads.csv', { campaignId: c.id }, `leads-${c.id}.csv`).catch((e) => toast.error(describeError(e)))}>
          Export leads CSV
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>List</th>
              <th>Leads</th>
              <th>Active</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lists.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.leadCount}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`List ${l.name} active`}
                    checked={l.active}
                    onChange={async (e) => {
                      try {
                        await api.patch(`/lists/${l.id}`, { active: e.target.checked });
                        void reload();
                      } catch (err) {
                        toast.error(describeError(err));
                      }
                    }}
                  />
                </td>
                <td className="nowrap">{fmtDateTime(l.createdAt)}</td>
                <td className="actions">
                  <button type="button" className="btn small primary" onClick={() => setImporting(l)}>
                    Import CSV
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: `Delete list "${l.name}"?`, message: `All ${l.leadCount} leads in it are deleted.`, confirmLabel: 'Delete', danger: true }))) return;
                      try {
                        await api.del(`/lists/${l.id}`);
                        void reload();
                      } catch (err) {
                        toast.error(describeError(err));
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lists.length === 0 && <Empty>No lists yet. Create a list, then import a CSV into it.</Empty>}
      </div>
      {importing && <ImportWizard list={importing} onClose={() => setImporting(null)} onDone={() => void reload()} />}
      {resetting && <ResetDialog c={c} lists={lists} onClose={() => setResetting(false)} />}
    </div>
  );
}

function LeadsTab({ c }: { c: Full }) {
  const lists = useLoad(() => api.get<LeadList[]>(`/campaigns/${c.id}/lists`), [c.id]);
  return <LeadsTable campaignId={c.id} lists={lists.data ?? []} />;
}

function Agents({ c, onSaved }: { c: Full; onSaved: () => void }) {
  const { data, error, reload } = useLoad(() => api.get<User[]>('/users'), []);
  const [sel, setSel] = useState<number[]>(c.agentIds);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel(c.agentIds), [c.agentIds]);
  const agents = (data ?? []).filter((u) => u.role === 'agent');
  return (
    <div className="stack">
      <ErrorBox error={error} onRetry={reload} />
      <p className="muted">Agents assigned here can join this campaign. Supervisors and admins can always join.</p>
      <div className="card">
        {agents.length === 0 && <p className="muted">No agent users yet – create them under Users.</p>}
        <div className="stack tight">
          {agents.map((u) => (
            <label key={u.id} className="check">
              <input type="checkbox" checked={sel.includes(u.id)} onChange={(e) => setSel(e.target.checked ? [...sel, u.id] : sel.filter((x) => x !== u.id))} />
              {u.displayName} <span className="muted small">({u.username})</span>
              {!u.active && <span className="badge red">inactive</span>}
            </label>
          ))}
        </div>
        {agents.length > 0 && (
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn small" onClick={() => setSel(agents.map((a) => a.id))}>
              Select all
            </button>
            <button type="button" className="btn small" onClick={() => setSel([])}>
              Clear
            </button>
          </div>
        )}
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.put(`/campaigns/${c.id}/agents`, { userIds: sel });
              toast.success('Agents saved');
              onSaved();
            } catch (err) {
              toast.error(describeError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save agents
        </button>
      </div>
    </div>
  );
}

export default function CampaignDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const { data: c, error, reload, loading } = useLoad(() => api.get<Full>(`/campaigns/${id}`), [id]);
  const [tab, setTab] = useState<Tab>('overview');

  if (!c) return loading ? <Loading /> : <ErrorBox error={error ?? 'Not found'} onRetry={reload} />;

  const setStatus = async (status: CampaignStatus) => {
    try {
      await api.post(`/campaigns/${c.id}/status`, { status });
      toast.success(`Campaign ${status === 'active' ? 'activated' : status}`);
      void reload();
    } catch (err) {
      toast.error(describeError(err));
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row">
          <h1>{c.name}</h1>
          <StatusBadge status={c.status} />
        </div>
        <div className="row">
          {c.status !== 'active' && (
            <button type="button" className="btn success" onClick={() => void setStatus('active')}>
              Activate
            </button>
          )}
          {c.status === 'active' && (
            <button type="button" className="btn warning" onClick={() => void setStatus('paused')}>
              Pause
            </button>
          )}
          {c.status !== 'completed' && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                if (await confirmDialog({ title: 'Complete campaign?', message: 'Agents can no longer join it. You can re-activate it later.', confirmLabel: 'Complete' })) void setStatus('completed');
              }}
            >
              Complete
            </button>
          )}
          {hasRole(user, 'admin') && (
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                if (!(await confirmDialog({ title: `Delete "${c.name}"?`, message: 'All lists, leads and callbacks of this campaign are deleted. Call history is kept.', confirmLabel: 'Delete', danger: true }))) return;
                try {
                  await api.del(`/campaigns/${c.id}`);
                  nav('/admin/campaigns');
                } catch (err) {
                  toast.error(describeError(err));
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'lists', label: 'Lists & import' },
          { id: 'leads', label: 'Leads' },
          { id: 'agents', label: `Agents (${c.agentIds.length})` },
          { id: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'overview' && <Overview c={c} />}
      {tab === 'lists' && <Lists c={c} />}
      {tab === 'leads' && <LeadsTab c={c} />}
      {tab === 'agents' && <Agents c={c} onSaved={() => void reload()} />}
      {tab === 'settings' && (
        <div className="card">
          <CampaignForm
            key={c.updatedAt}
            initial={campaignToInput(c)}
            submitLabel="Save settings"
            onSubmit={async (v) => {
              await api.patch(`/campaigns/${c.id}`, v);
              toast.success('Campaign saved');
              void reload();
            }}
          />
        </div>
      )}
    </div>
  );
}
