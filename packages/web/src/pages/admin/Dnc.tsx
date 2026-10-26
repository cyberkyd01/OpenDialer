import { useState } from 'react';
import { dncCreateSchema, formatPhone, type DncEntry, type Paginated } from '@opendialer/shared';
import { Empty, ErrorBox, Pager, confirmDialog, useLoad } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { hasRole, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

export default function Dnc() {
  const user = useAuth((s) => s.user);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(() => api.get<Paginated<DncEntry>>('/dnc', { q: query || undefined, page, pageSize: 50 }), [query, page]);
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState('');
  const [checkMsg, setCheckMsg] = useState<string | null>(null);

  const add = async () => {
    const parsed = dncCreateSchema.safeParse({ phone: phone.trim(), note });
    if (!parsed.success) {
      toast.error('Enter a phone number');
      return;
    }
    try {
      const e = await api.post<DncEntry>('/dnc', parsed.data);
      toast.success(`${formatPhone(e.phone)} added to the DNC list`);
      setPhone('');
      setNote('');
      void reload();
    } catch (err) {
      toast.error(describeError(err));
    }
  };

  const importFile = async () => {
    if (!file) return;
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const r = await api.upload<{ added: number; invalid: number; total: number }>('/dnc/import', form);
      toast.success(`Imported ${r.added} of ${r.total} numbers (${r.invalid} invalid)`);
      setFile(null);
      void reload();
    } catch (err) {
      toast.error(describeError(err));
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Do-not-call list</h1>
      </div>
      <div className="grid cols-3">
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <h3>Add number</h3>
          <input aria-label="DNC phone" placeholder="+1 415 555 0100" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input aria-label="DNC note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="btn primary" disabled={!phone.trim()}>
            Add to DNC
          </button>
        </form>
        {hasRole(user, 'supervisor') && (
          <div className="card stack">
            <h3>Import</h3>
            <p className="muted small">CSV or text file, one number per line or cell.</p>
            <input type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="DNC file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button type="button" className="btn" disabled={!file} onClick={() => void importFile()}>
              Import numbers
            </button>
          </div>
        )}
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api.get<{ phone: string; dnc: boolean }>('/dnc/check', { phone: check });
              setCheckMsg(`${formatPhone(r.phone)} ${r.dnc ? 'IS on the DNC list' : 'is not on the DNC list'}`);
            } catch (err) {
              setCheckMsg(describeError(err));
            }
          }}
        >
          <h3>Check a number</h3>
          <input aria-label="Check phone" value={check} onChange={(e) => setCheck(e.target.value)} />
          <button type="submit" className="btn" disabled={!check.trim()}>
            Check
          </button>
          {checkMsg && <div className="alert info">{checkMsg}</div>}
        </form>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <input style={{ maxWidth: 280 }} aria-label="Search DNC" placeholder="Search number or note" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn">
          Search
        </button>
      </form>
      <ErrorBox error={error} onRetry={reload} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Number</th>
              <th>Source</th>
              <th>Note</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((d) => (
              <tr key={d.id}>
                <td className="mono nowrap">{formatPhone(d.phone)}</td>
                <td>{d.source}</td>
                <td>{d.note}</td>
                <td className="nowrap">{fmtDateTime(d.createdAt)}</td>
                <td className="actions">
                  {hasRole(user, 'admin') && (
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={async () => {
                        if (!(await confirmDialog({ title: 'Remove from DNC?', message: `${formatPhone(d.phone)} may be dialed again.`, confirmLabel: 'Remove', danger: true }))) return;
                        try {
                          await api.del(`/dnc/${d.id}`);
                          void reload();
                        } catch (err) {
                          toast.error(describeError(err));
                        }
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <Empty>No numbers.</Empty>}
      </div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
