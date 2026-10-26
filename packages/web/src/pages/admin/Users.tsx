import { useEffect, useState } from 'react';
import { userCreateSchema, userUpdateSchema, type Role, type User } from '@opendialer/shared';
import { Empty, ErrorBox, Field, Modal, confirmDialog, useLoad } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { fmtDateTime, zodIssues } from '../../lib/format';
import { hasRole, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

interface Form {
  username: string;
  password: string;
  displayName: string;
  role: Role;
  active: boolean;
  sipUsername: string;
  sipAuthUsername: string;
  sipPassword: string;
}

const empty: Form = { username: '', password: '', displayName: '', role: 'agent', active: true, sipUsername: '', sipAuthUsername: '', sipPassword: '' };

function UserEditor({ id, onClose, onSaved }: { id: number | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Form>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (id == null) return;
    api
      .get<User>(`/users/${id}`)
      .then((u) =>
        setV({
          username: u.username,
          password: '',
          displayName: u.displayName,
          role: u.role,
          active: u.active,
          sipUsername: u.sipUsername ?? '',
          sipAuthUsername: u.sipAuthUsername ?? '',
          sipPassword: u.sipPassword ?? '',
        }),
      )
      .catch((e) => setLoadErr(describeError(e)));
  }, [id]);

  const set = <K extends keyof Form>(k: K, val: Form[K]) => setV({ ...v, [k]: val });
  const nul = (s: string) => (s.trim() ? s.trim() : null);

  const save = async () => {
    const body = {
      username: v.username.trim(),
      displayName: v.displayName.trim(),
      role: v.role,
      active: v.active,
      sipUsername: nul(v.sipUsername),
      sipAuthUsername: nul(v.sipAuthUsername),
      sipPassword: nul(v.sipPassword),
      ...(v.password ? { password: v.password } : {}),
    };
    const parsed = id == null ? userCreateSchema.safeParse(body) : userUpdateSchema.safeParse(body);
    if (!parsed.success) return setErrors(zodIssues(parsed.error));
    setErrors({});
    setBusy(true);
    try {
      if (id == null) await api.post('/users', parsed.data);
      else await api.patch(`/users/${id}`, parsed.data);
      toast.success('User saved');
      onSaved();
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={id == null ? 'New user' : `Edit ${v.displayName || 'user'}`} onClose={onClose}>
      <ErrorBox error={loadErr} />
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <div className="grid cols-2">
          <Field label="Username" error={errors.username}>
            <input name="username" autoComplete="off" value={v.username} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field label="Display name" error={errors.displayName}>
            <input name="displayName" value={v.displayName} onChange={(e) => set('displayName', e.target.value)} />
          </Field>
          <Field label={id == null ? 'Password' : 'New password (reset)'} hint={id == null ? 'At least 8 characters' : 'Leave empty to keep the current password'} error={errors.password}>
            <input name="password" type="password" autoComplete="new-password" value={v.password} onChange={(e) => set('password', e.target.value)} />
          </Field>
          <Field label="Role">
            <select name="role" value={v.role} onChange={(e) => set('role', e.target.value as Role)}>
              <option value="agent">Agent</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Active (can log in)
        </label>
        <fieldset className="grid cols-3">
          <legend>Softphone (SIP)</legend>
          <Field label="SIP username" hint="Extension / user part" error={errors.sipUsername}>
            <input name="sipUsername" autoComplete="off" value={v.sipUsername} onChange={(e) => set('sipUsername', e.target.value)} />
          </Field>
          <Field label="Auth username" hint="If different" error={errors.sipAuthUsername}>
            <input name="sipAuthUsername" autoComplete="off" value={v.sipAuthUsername} onChange={(e) => set('sipAuthUsername', e.target.value)} />
          </Field>
          <Field label="SIP password" error={errors.sipPassword}>
            <input name="sipPassword" type="password" autoComplete="new-password" value={v.sipPassword} onChange={(e) => set('sipPassword', e.target.value)} />
          </Field>
        </fieldset>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {id == null ? 'Create user' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Users() {
  const me = useAuth((s) => s.user);
  const admin = hasRole(me, 'admin');
  const { data, error, reload } = useLoad(() => api.get<User[]>('/users'), []);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Users</h1>
        {admin && (
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            + New user
          </button>
        )}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>SIP</th>
              <th>Status</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                <td className="mono">{u.username}</td>
                <td>{u.role}</td>
                <td className="mono">{u.sipUsername ?? <span className="muted">—</span>}</td>
                <td>{u.active ? <span className="badge green">active</span> : <span className="badge red">inactive</span>}</td>
                <td className="nowrap">{fmtDateTime(u.createdAt)}</td>
                <td className="actions">
                  {admin && (
                    <>
                      <button type="button" className="btn small" onClick={() => setEditing(u.id)}>
                        Edit
                      </button>
                      {u.id !== me?.id && (
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={async () => {
                            if (!(await confirmDialog({ title: `Delete ${u.displayName}?`, message: 'Users with call history are deactivated instead.', confirmLabel: 'Delete', danger: true }))) return;
                            try {
                              await api.del(`/users/${u.id}`);
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.length === 0 && <Empty>No users.</Empty>}
      </div>
      {editing != null && (
        <UserEditor
          id={editing === 'new' ? null : editing}
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
