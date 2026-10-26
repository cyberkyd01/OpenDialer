import { useState } from 'react';
import { ErrorBox, useLoad } from '../../components/ui';
import { api, describeError, downloadFile } from '../../lib/api';
import { fmtBytes, fmtDateTime, fmtDuration } from '../../lib/format';
import { toast } from '../../store/toasts';

interface SystemInfo {
  version: string;
  node: string;
  uptimeSec: number;
  dataDir: string;
  dbBytes: number;
  agentsOnline: number;
  memoryMb: number;
}

export default function System() {
  const info = useLoad(() => api.get<SystemInfo>('/admin/system'), []);
  const backups = useLoad(() => api.get<{ file: string; bytes: number; at: string }[]>('/admin/backups'), []);
  const [busy, setBusy] = useState(false);
  const s = info.data;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>System & backup</h1>
      </div>
      <ErrorBox error={info.error} onRetry={info.reload} />
      {s && (
        <div className="grid cols-4">
          <div className="stat">
            <div className="label">Version</div>
            <div className="value">{s.version}</div>
          </div>
          <div className="stat">
            <div className="label">Uptime</div>
            <div className="value">{fmtDuration(s.uptimeSec)}</div>
          </div>
          <div className="stat">
            <div className="label">Database</div>
            <div className="value">{fmtBytes(s.dbBytes)}</div>
          </div>
          <div className="stat">
            <div className="label">Agents online</div>
            <div className="value">{s.agentsOnline}</div>
          </div>
        </div>
      )}
      {s && (
        <div className="card">
          <dl className="kv">
            <dt>Node.js</dt>
            <dd>{s.node}</dd>
            <dt>Memory</dt>
            <dd>{s.memoryMb} MB</dd>
            <dt>Data directory</dt>
            <dd className="mono">{s.dataDir}</dd>
          </dl>
        </div>
      )}
      <section className="stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Backups</h2>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.post<{ file: string; bytes: number }>('/admin/backup');
                toast.success(`Backup ${r.file} created (${fmtBytes(r.bytes)})`);
                void backups.reload();
              } catch (err) {
                toast.error(describeError(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
        <ErrorBox error={backups.error} onRetry={backups.reload} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(backups.data ?? []).map((b) => (
                <tr key={b.file}>
                  <td className="mono">{b.file}</td>
                  <td>{fmtBytes(b.bytes)}</td>
                  <td className="nowrap">{fmtDateTime(b.at)}</td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => void downloadFile(`/admin/backups/${encodeURIComponent(b.file)}`, undefined, b.file).catch((e) => toast.error(describeError(e)))}
                    >
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {backups.data && backups.data.length === 0 && <div className="empty">No backups yet.</div>}
        </div>
      </section>
    </div>
  );
}
