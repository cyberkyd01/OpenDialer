import { useState } from 'react';
import { dispositionCreateSchema, type Disposition, type DispositionCreateInput } from '@opendialer/shared';
import { ErrorBox, Field, Modal, confirmDialog, useLoad } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { zodIssues } from '../../lib/format';
import { hasRole, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

const CATS = ['contact', 'no_contact', 'callback', 'dnc', 'invalid'] as const;

function Editor({ initial, id, onClose, onSaved }: { initial: DispositionCreateInput; id: number | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof DispositionCreateInput>(k: K, val: DispositionCreateInput[K]) => setV({ ...v, [k]: val });
  return (
    <Modal title={id ? 'Edit disposition' : 'New disposition'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = dispositionCreateSchema.safeParse(v);
          if (!parsed.success) return setErrors(zodIssues(parsed.error));
          setBusy(true);
          try {
            if (id) await api.patch(`/dispositions/${id}`, parsed.data);
            else await api.post('/dispositions', parsed.data);
            toast.success('Disposition saved');
            onSaved();
          } catch (err) {
            toast.error(describeError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid cols-2">
          <Field label="Code" hint="UPPERCASE_CODE" error={errors.code}>
            <input value={v.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Label" error={errors.label}>
            <input value={v.label} onChange={(e) => set('label', e.target.value)} />
          </Field>
          <Field label="Category">
            <select value={v.category} onChange={(e) => set('category', e.target.value as DispositionCreateInput['category'])}>
              {CATS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Retry after (minutes)" hint="Empty = lead is finished" error={errors.retryMinutes}>
            <input type="number" value={v.retryMinutes ?? ''} onChange={(e) => set('retryMinutes', e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label="Color" error={errors.color}>
            <input type="color" value={v.color} onChange={(e) => set('color', e.target.value)} />
          </Field>
          <Field label="Sort order" error={errors.sortOrder}>
            <input type="number" value={v.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />
          </Field>
        </div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={v.countsAsContact} onChange={(e) => set('countsAsContact', e.target.checked)} /> Counts as contact
          </label>
          <label className="check">
            <input type="checkbox" checked={v.isSale} onChange={(e) => set('isSale', e.target.checked)} /> Is a sale
          </label>
        </div>
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

export default function Dispositions() {
  const user = useAuth((s) => s.user);
  const admin = hasRole(user, 'admin');
  const { data, error, reload } = useLoad(() => api.get<Disposition[]>('/dispositions'), []);
  const [editing, setEditing] = useState<{ id: number | null; v: DispositionCreateInput } | null>(null);
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Dispositions</h1>
        {admin && (
          <button
            type="button"
            className="btn primary"
            onClick={() => setEditing({ id: null, v: { code: '', label: '', category: 'contact', retryMinutes: null, countsAsContact: false, isSale: false, color: '#64748b', sortOrder: 100 } })}
          >
            + New disposition
          </button>
        )}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Code</th>
              <th>Category</th>
              <th>Retry</th>
              <th>Contact</th>
              <th>Sale</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((d) => (
              <tr key={d.id}>
                <td>
                  <span className="swatch" style={{ background: d.color }} /> {d.label}
                </td>
                <td className="mono">{d.code}</td>
                <td>{d.category}</td>
                <td>{d.retryMinutes == null ? 'finished' : `${d.retryMinutes} min`}</td>
                <td>{d.countsAsContact ? 'yes' : ''}</td>
                <td>{d.isSale ? 'yes' : ''}</td>
                <td className="actions">
                  {admin && (
                    <>
                      <button type="button" className="btn small" onClick={() => setEditing({ id: d.id, v: { code: d.code, label: d.label, category: d.category, retryMinutes: d.retryMinutes, countsAsContact: d.countsAsContact, isSale: d.isSale, color: d.color, sortOrder: d.sortOrder } })}>
                        Edit
                      </button>
                      {!d.system && (
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={async () => {
                            if (!(await confirmDialog({ title: `Delete "${d.label}"?`, confirmLabel: 'Delete', danger: true }))) return;
                            try {
                              await api.del(`/dispositions/${d.id}`);
                              void reload();
                            } catch (err) {
                              toast.error(describeError(err));
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                  {d.system && <span className="badge">system</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Editor
          id={editing.id}
          initial={editing.v}
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
