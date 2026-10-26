import { useEffect, useState } from 'react';
import { formatPhone, type CallLog, type Campaign, type Disposition, type Paginated, type User } from '@opendialer/shared';
import { Empty, ErrorBox, Pager, useLoad } from '../../components/ui';
import { api, blobUrl, describeError } from '../../lib/api';
import { fmtDateTime, fmtDuration, toDateInput } from '../../lib/format';

/** <audio> player that fetches the recording with the auth header and plays it from a blob URL. */
export function RecordingPlayer({ callId }: { callId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (url) return <audio controls src={url} autoPlay style={{ maxWidth: 260, height: 32 }} />;
  return (
    <span className="row nowrap-row">
      <button
        type="button"
        className="btn small"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          try {
            setUrl(await blobUrl(`/calls/${callId}/recording`));
          } catch (e) {
            setErr(describeError(e));
          } finally {
            setLoading(false);
          }
        }}
      >
        ▶ Play
      </button>
      {err && <span className="danger-text small">{err}</span>}
    </span>
  );
}

export default function Calls() {
  const campaigns = useLoad(() => api.get<Campaign[]>('/campaigns'), []);
  const users = useLoad(() => api.get<User[]>('/users'), []);
  const dispositions = useLoad(() => api.get<Disposition[]>('/dispositions'), []);
  const [f, setF] = useState({ campaignId: '', userId: '', result: '', dispositionId: '', phone: '', from: toDateInput(new Date(Date.now() - 6 * 86400000)), to: toDateInput(new Date()) });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(
    () =>
      api.get<Paginated<CallLog>>('/calls', {
        campaignId: applied.campaignId || undefined,
        userId: applied.userId || undefined,
        result: applied.result || undefined,
        dispositionId: applied.dispositionId || undefined,
        phone: applied.phone || undefined,
        from: applied.from ? new Date(`${applied.from}T00:00:00`).toISOString() : undefined,
        to: applied.to ? new Date(`${applied.to}T23:59:59.999`).toISOString() : undefined,
        page,
        pageSize: 50,
      }),
    [applied, page],
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Calls & recordings</h1>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied(f);
        }}
      >
        <input type="date" aria-label="From" style={{ width: 'auto' }} value={f.from} onChange={set('from')} />
        <input type="date" aria-label="To" style={{ width: 'auto' }} value={f.to} onChange={set('to')} />
        <select aria-label="Campaign" style={{ width: 'auto' }} value={f.campaignId} onChange={set('campaignId')}>
          <option value="">All campaigns</option>
          {(campaigns.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Agent" style={{ width: 'auto' }} value={f.userId} onChange={set('userId')}>
          <option value="">All agents</option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
        <select aria-label="Result" style={{ width: 'auto' }} value={f.result} onChange={set('result')}>
          <option value="">Any result</option>
          {['answered', 'no_answer', 'busy', 'failed', 'cancelled', 'unknown'].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select aria-label="Disposition" style={{ width: 'auto' }} value={f.dispositionId} onChange={set('dispositionId')}>
          <option value="">Any disposition</option>
          {(dispositions.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <input aria-label="Phone" placeholder="Phone" style={{ maxWidth: 160 }} value={f.phone} onChange={set('phone')} />
        <button type="submit" className="btn primary">
          Filter
        </button>
      </form>
      <ErrorBox error={error} onRetry={reload} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Agent</th>
              <th>Campaign</th>
              <th>Lead</th>
              <th>Number</th>
              <th>Result</th>
              <th>Disposition</th>
              <th>Talk</th>
              <th>Notes</th>
              <th>Recording</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((c) => (
              <tr key={c.id}>
                <td className="nowrap">{fmtDateTime(c.startedAt)}</td>
                <td>{c.agentName}</td>
                <td>{c.campaignName ?? ''}</td>
                <td>{c.leadName ?? ''}</td>
                <td className="mono nowrap">{formatPhone(c.phone)}</td>
                <td>{c.result}</td>
                <td>{c.dispositionCode ?? ''}</td>
                <td>{fmtDuration(c.talkSec)}</td>
                <td style={{ maxWidth: 240 }}>{c.notes}</td>
                <td>{c.hasRecording ? <RecordingPlayer callId={c.id} /> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <Empty>No calls match.</Empty>}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
