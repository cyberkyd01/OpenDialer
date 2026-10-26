import { useState } from 'react';
import { apiKeyCreateSchema, webhookCreateSchema, type ApiKey, type Webhook } from '@opendialer/shared';
import { Empty, ErrorBox, Field, Modal, confirmDialog, useLoad } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { fmtDateTime, zodIssues } from '../../lib/format';
import { toast } from '../../store/toasts';

function WebhookEditor({ hook, events, onClose, onSaved }: { hook: Webhook | null; events: string[]; onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState(hook?.url ?? '');
  const [sel, setSel] = useState<string[]>(hook?.events ?? [...events]);
  const [secret, setSecret] = useState(hook?.secret ?? '');
  const [active, setActive] = useState(hook?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Modal title={hook ? 'Edit webhook' : 'New webhook'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = webhookCreateSchema.safeParse({ url: url.trim(), events: sel, secret, active });
          if (!parsed.success) return setErrors(zodIssues(parsed.error));
          try {
            if (hook) await api.patch(`/webhooks/${hook.id}`, parsed.data);
            else await api.post('/webhooks', parsed.data);
            toast.success('Webhook saved');
            onSaved();
          } catch (err) {
            toast.error(describeError(err));
          }
        }}
      >
        <Field label="URL" error={errors.url}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://crm.example.com/hooks/opendialer" />
        </Field>
        <Field label="Signing secret" hint="Sent as X-OpenDialer-Signature: sha256=HMAC(body)">
          <input value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
        <fieldset>
          <legend>Events {errors.events && <span className="danger-text small">{errors.events}</span>}</legend>
          <div className="days">
            {events.map((ev) => (
              <label key={ev}>
                <input type="checkbox" checked={sel.includes(ev)} onChange={(e) => setSel(e.target.checked ? [...sel, ev] : sel.filter((x) => x !== ev))} />
                <span className="mono">{ev}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Integrations() {
  const hooks = useLoad(() => api.get<{ items: Webhook[]; events: string[] }>('/webhooks'), []);
  const keys = useLoad(() => api.get<ApiKey[]>('/api-keys'), []);
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null);
  const [keyName, setKeyName] = useState('');
  const [plaintext, setPlaintext] = useState<string | null>(null);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Integrations</h1>
      </div>
      <section className="stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Webhooks</h2>
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            + New webhook
          </button>
        </div>
        <ErrorBox error={hooks.error} onRetry={hooks.reload} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Events</th>
                <th>Active</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(hooks.data?.items ?? []).map((h) => (
                <tr key={h.id}>
                  <td className="mono" style={{ wordBreak: 'break-all' }}>
                    {h.url}
                  </td>
                  <td className="small">{h.events.join(', ')}</td>
                  <td>{h.active ? 'yes' : 'no'}</td>
                  <td className="nowrap">{fmtDateTime(h.createdAt)}</td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn small"
                      onClick={async () => {
                        try {
                          const r = await api.post<{ ok: boolean }>(`/webhooks/${h.id}/test`);
                          if (r.ok) toast.success('Test delivered');
                          else toast.error('Test delivery failed (see server log)');
                        } catch (err) {
                          toast.error(describeError(err));
                        }
                      }}
                    >
                      Test
                    </button>
                    <button type="button" className="btn small" onClick={() => setEditing(h)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={async () => {
                        if (!(await confirmDialog({ title: 'Delete webhook?', confirmLabel: 'Delete', danger: true }))) return;
                        await api.del(`/webhooks/${h.id}`).catch((e) => toast.error(describeError(e)));
                        void hooks.reload();
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hooks.data && hooks.data.items.length === 0 && <Empty>No webhooks.</Empty>}
        </div>
      </section>

      <section className="stack">
        <h2>API keys</h2>
        <p className="muted small">
          Send as <code>X-API-Key</code> header. Keys act with admin rights – keep them secret.
        </p>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = apiKeyCreateSchema.safeParse({ name: keyName.trim() });
            if (!parsed.success) return;
            try {
              const r = await api.post<ApiKey & { plaintext: string }>('/api-keys', parsed.data);
              setPlaintext(r.plaintext);
              setKeyName('');
              void keys.reload();
            } catch (err) {
              toast.error(describeError(err));
            }
          }}
        >
          <input aria-label="API key name" style={{ maxWidth: 260 }} placeholder="Key name, e.g. CRM sync" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          <button type="submit" className="btn primary" disabled={!keyName.trim()}>
            Create key
          </button>
        </form>
        <ErrorBox error={keys.error} onRetry={keys.reload} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Created</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(keys.data ?? []).map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="mono">{k.prefix}…</td>
                  <td className="nowrap">{fmtDateTime(k.createdAt)}</td>
                  <td className="nowrap">{fmtDateTime(k.lastUsedAt) || '—'}</td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={async () => {
                        if (!(await confirmDialog({ title: `Revoke "${k.name}"?`, message: 'Integrations using it stop working immediately.', confirmLabel: 'Revoke', danger: true }))) return;
                        await api.del(`/api-keys/${k.id}`).catch((e) => toast.error(describeError(e)));
                        void keys.reload();
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {keys.data && keys.data.length === 0 && <Empty>No API keys.</Empty>}
        </div>
      </section>
      {editing && (
        <WebhookEditor
          hook={editing === 'new' ? null : editing}
          events={hooks.data?.events ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void hooks.reload();
          }}
        />
      )}
      {plaintext && (
        <Modal title="New API key" onClose={() => setPlaintext(null)}>
          <p>Copy this key now – it is shown only once.</p>
          <div className="plaintext-key" data-testid="api-key-plaintext">
            {plaintext}
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(plaintext).then(() => toast.success('Copied'))}>
              Copy
            </button>
            <button type="button" className="btn primary" onClick={() => setPlaintext(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
