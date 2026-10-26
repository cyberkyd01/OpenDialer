import { useEffect, useState } from 'react';
import { formatPhone, leadUpdateSchema, type CallLog, type Lead, type LeadList, type LeadStatus, type Paginated } from '@opendialer/shared';
import { Empty, ErrorBox, Field, Modal, Pager, confirmDialog, useLoad } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { fmtDateTime, fmtDuration, fromLocalInput, leadName, toLocalInput, zodIssues } from '../../lib/format';
import { hasRole, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

export const LEAD_STATUSES: LeadStatus[] = ['new', 'in_progress', 'callback', 'done', 'dnc', 'invalid'];

export function LeadStatusBadge({ status }: { status: string }) {
  const cls = status === 'new' ? 'blue' : status === 'callback' ? 'amber' : status === 'dnc' || status === 'invalid' ? 'red' : status === 'done' ? 'green' : '';
  return <span className={`badge ${cls}`}>{status}</span>;
}

type LeadDetail = Lead & { calls: CallLog[]; callbacks: Record<string, unknown>[] };

export function LeadEditor({ leadId, onClose, onSaved }: { leadId: number; onClose: () => void; onSaved: () => void }) {
  const { data, error } = useLoad(() => api.get<LeadDetail>(`/leads/${leadId}`), [leadId]);
  const [v, setV] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<[string, string][]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setV({
      firstName: data.firstName,
      lastName: data.lastName,
      company: data.company,
      email: data.email,
      phone: data.phone,
      timezone: data.timezone ?? '',
      priority: String(data.priority),
      notes: data.notes,
      status: data.status,
      attempts: String(data.attempts),
      nextAttemptAt: data.nextAttemptAt ? toLocalInput(data.nextAttemptAt) : '',
    });
    setCustom(Object.entries(data.custom ?? {}));
  }, [data]);

  const set = (k: string) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    const patch = {
      firstName: v.firstName,
      lastName: v.lastName,
      company: v.company,
      email: v.email,
      phone: v.phone,
      timezone: v.timezone.trim() || null,
      priority: Number(v.priority),
      notes: v.notes,
      status: v.status as LeadStatus,
      attempts: Number(v.attempts),
      nextAttemptAt: v.nextAttemptAt ? fromLocalInput(v.nextAttemptAt) : null,
      custom: Object.fromEntries(custom.filter(([k]) => k.trim()).map(([k, val]) => [k.trim(), val])),
    };
    const parsed = leadUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(zodIssues(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api.patch(`/leads/${leadId}`, parsed.data);
      toast.success('Lead saved');
      onSaved();
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={data ? leadName(data) || formatPhone(data.phone) : 'Lead'} drawer onClose={onClose}>
      <ErrorBox error={error} />
      {data && (
        <div className="stack">
          <div className="grid cols-2">
            <Field label="First name" error={errors.firstName}>
              <input value={v.firstName ?? ''} onChange={set('firstName')} />
            </Field>
            <Field label="Last name" error={errors.lastName}>
              <input value={v.lastName ?? ''} onChange={set('lastName')} />
            </Field>
            <Field label="Phone" error={errors.phone}>
              <input value={v.phone ?? ''} onChange={set('phone')} />
            </Field>
            <Field label="Company" error={errors.company}>
              <input value={v.company ?? ''} onChange={set('company')} />
            </Field>
            <Field label="Email" error={errors.email}>
              <input value={v.email ?? ''} onChange={set('email')} />
            </Field>
            <Field label="Timezone" hint="IANA, e.g. America/Chicago" error={errors.timezone}>
              <input value={v.timezone ?? ''} onChange={set('timezone')} />
            </Field>
            <Field label="Status" error={errors.status}>
              <select value={v.status ?? 'new'} onChange={set('status')}>
                {LEAD_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority (0–100)" error={errors.priority}>
              <input type="number" value={v.priority ?? '0'} onChange={set('priority')} />
            </Field>
            <Field label="Attempts" error={errors.attempts}>
              <input type="number" value={v.attempts ?? '0'} onChange={set('attempts')} />
            </Field>
            <Field label="Next attempt" error={errors.nextAttemptAt}>
              <input type="datetime-local" value={v.nextAttemptAt ?? ''} onChange={set('nextAttemptAt')} />
            </Field>
          </div>
          <Field label="Notes" error={errors.notes}>
            <textarea rows={3} value={v.notes ?? ''} onChange={set('notes')} />
          </Field>
          <fieldset className="stack tight">
            <legend>Custom fields</legend>
            {custom.map(([k, val], i) => (
              <div key={i} className="row nowrap-row">
                <input aria-label="Field name" value={k} onChange={(e) => setCustom(custom.map((c, j) => (j === i ? [e.target.value, c[1]] : c)))} />
                <input aria-label="Field value" value={val} onChange={(e) => setCustom(custom.map((c, j) => (j === i ? [c[0], e.target.value] : c)))} />
                <button type="button" className="btn ghost icon-btn" aria-label="Remove field" onClick={() => setCustom(custom.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn small" onClick={() => setCustom([...custom, ['', '']])}>
              + Add field
            </button>
          </fieldset>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
              Save lead
            </button>
          </div>
          <h3>Call history</h3>
          {data.calls.length === 0 ? (
            <p className="muted small">No calls yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Agent</th>
                    <th>Result</th>
                    <th>Disposition</th>
                    <th>Talk</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calls.map((c) => (
                    <tr key={c.id}>
                      <td className="nowrap">{fmtDateTime(c.startedAt)}</td>
                      <td>{c.agentName}</td>
                      <td>{c.result}</td>
                      <td>{c.dispositionCode ?? ''}</td>
                      <td>{fmtDuration(c.talkSec)}</td>
                      <td>{c.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.callbacks.length > 0 && (
            <>
              <h3>Callbacks</h3>
              <ul className="small">
                {(data.callbacks as unknown as { id: number; scheduled_at: string; status: string; note: string }[]).map((c) => (
                  <li key={c.id}>
                    {fmtDateTime(c.scheduled_at)} – {c.status} {c.note && `– ${c.note}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Searchable, paginated lead table with an edit drawer (used per campaign and globally). */
export function LeadsTable({ campaignId, lists, showCampaign }: { campaignId?: number; lists?: LeadList[]; showCampaign?: boolean }) {
  const user = useAuth((s) => s.user);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [listId, setListId] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<number | null>(null);
  const pageSize = 50;
  const { data, error, reload } = useLoad(
    () => api.get<Paginated<Lead>>('/leads', { campaignId, listId: listId || undefined, status: status || undefined, q: query || undefined, page, pageSize }),
    [campaignId, listId, status, query, page],
  );

  const del = async (l: Lead) => {
    if (!(await confirmDialog({ title: 'Delete lead?', message: `${leadName(l) || l.phone} and its callbacks will be removed.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api.del(`/leads/${l.id}`);
      toast.success('Lead deleted');
      void reload();
    } catch (err) {
      toast.error(describeError(err));
    }
  };

  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <input style={{ maxWidth: 280 }} aria-label="Search leads" placeholder="Search name, company, email, phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Status filter" style={{ width: 'auto' }} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {lists && lists.length > 0 && (
          <select aria-label="List filter" style={{ width: 'auto' }} value={listId} onChange={(e) => (setListId(e.target.value), setPage(1))}>
            <option value="">All lists</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="btn">
          Search
        </button>
      </form>
      <ErrorBox error={error} onRetry={reload} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Company</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Last attempt</th>
              <th>Next attempt</th>
              {showCampaign && <th>Campaign</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((l) => (
              <tr key={l.id}>
                <td>
                  <button type="button" className="btn ghost small" onClick={() => setEditing(l.id)}>
                    {leadName(l) || '(no name)'}
                  </button>
                </td>
                <td className="nowrap mono">{formatPhone(l.phone)}</td>
                <td>{l.company}</td>
                <td>
                  <LeadStatusBadge status={l.status} />
                </td>
                <td>{l.attempts}</td>
                <td className="nowrap">{fmtDateTime(l.lastAttemptAt)}</td>
                <td className="nowrap">{fmtDateTime(l.nextAttemptAt)}</td>
                {showCampaign && <td>#{l.campaignId}</td>}
                <td className="actions">
                  <button type="button" className="btn small" onClick={() => setEditing(l.id)}>
                    Edit
                  </button>
                  {hasRole(user, 'supervisor') && (
                    <button type="button" className="btn small ghost" onClick={() => void del(l)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <Empty>No leads match.</Empty>}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      {editing != null && (
        <LeadEditor
          leadId={editing}
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

