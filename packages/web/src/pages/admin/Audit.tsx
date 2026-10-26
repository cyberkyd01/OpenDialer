import { useState } from 'react';
import type { AuditEntry, Paginated } from '@opendialer/shared';
import { Empty, ErrorBox, Pager, useLoad } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';

const ENTITIES = ['', 'user', 'campaign', 'list', 'lead', 'call', 'callback', 'dnc', 'disposition', 'script', 'settings', 'webhook', 'apikey', 'db'];

export default function Audit() {
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(() => api.get<Paginated<AuditEntry>>('/audit', { entity: entity || undefined, page, pageSize: 50 }), [entity, page]);
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Audit log</h1>
        <select aria-label="Entity" style={{ width: 'auto' }} value={entity} onChange={(e) => (setEntity(e.target.value), setPage(1))}>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {e || 'All entities'}
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
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((a) => (
              <tr key={a.id}>
                <td className="nowrap">{fmtDateTime(a.at)}</td>
                <td>{a.username ?? (a.userId ? `#${a.userId}` : 'system')}</td>
                <td className="mono">{a.action}</td>
                <td className="nowrap">
                  {a.entity}
                  {a.entityId ? ` #${a.entityId}` : ''}
                </td>
                <td className="mono small" style={{ maxWidth: 420, wordBreak: 'break-all' }}>
                  {a.details}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <Empty>No entries.</Empty>}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
