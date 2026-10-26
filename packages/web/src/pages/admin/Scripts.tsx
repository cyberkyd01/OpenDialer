import { useEffect, useState } from 'react';
import { SCRIPT_PLACEHOLDERS, scriptCreateSchema, type Script } from '@opendialer/shared';
import { ScriptView } from '../../components/ScriptView';
import { ErrorBox, confirmDialog, useLoad } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { ScriptMarkup } from '../../lib/scriptMarkup';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

const SAMPLE_LEAD = { firstName: 'Jane', lastName: 'Doe', company: 'Acme Inc', email: 'jane@acme.test', phone: '+15551234567', custom: {} };

export default function Scripts() {
  const { data, error, reload } = useLoad(() => api.get<Script[]>('/scripts'), []);
  const user = useAuth((s) => s.user);
  const company = useAuth((s) => s.settings?.companyName ?? '');
  const [selId, setSelId] = useState<number | 'new' | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [serverPreview, setServerPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scripts = data ?? [];
  const sel = typeof selId === 'number' ? scripts.find((s) => s.id === selId) : null;

  useEffect(() => {
    if (selId === null && scripts.length) setSelId(scripts[0].id);
  }, [scripts, selId]);
  useEffect(() => {
    setName(sel?.name ?? '');
    setBody(sel?.body ?? (selId === 'new' ? 'Hi **{{first_name}}**, this is {{agent_name}} from {{company_name}}.\n\nDo you have a minute?' : ''));
    setServerPreview(null);
  }, [sel?.id, sel?.updatedAt, selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const parsed = scriptCreateSchema.safeParse({ name, body });
    if (!parsed.success) {
      toast.error('Give the script a name');
      return;
    }
    setBusy(true);
    try {
      if (selId === 'new') {
        const s = await api.post<Script>('/scripts', parsed.data);
        await reload();
        setSelId(s.id);
      } else if (sel) {
        await api.patch(`/scripts/${sel.id}`, parsed.data);
        await reload();
      }
      toast.success('Script saved');
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const insert = (ph: string) => setBody((b) => `${b}{{${ph.replace('<field>', 'field_name')}}}`);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Call scripts</h1>
        <button type="button" className="btn primary" onClick={() => setSelId('new')}>
          + New script
        </button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="row">
        {scripts.map((s) => (
          <button key={s.id} type="button" className={`btn small ${selId === s.id ? 'primary' : ''}`} onClick={() => setSelId(s.id)}>
            {s.name}
          </button>
        ))}
        {selId === 'new' && <span className="badge blue">new script</span>}
      </div>
      {(sel || selId === 'new') && (
        <div className="grid cols-2">
          <div className="card stack">
            <label className="field">
              <span>Name</span>
              <input aria-label="Script name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Body</span>
              <textarea aria-label="Script body" className="editor" value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            <div className="stack tight">
              <span className="muted small">
                Placeholders (click to insert). Formatting: blank line = new paragraph, **bold**, "# " heading, "- " bullet.
              </span>
              <div className="row">
                {SCRIPT_PLACEHOLDERS.map((p) => (
                  <button key={p} type="button" className="btn small mono" onClick={() => insert(p)}>
                    {`{{${p}}}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-actions">
              {sel && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: `Delete "${sel.name}"?`, message: 'Campaigns using it will have no script.', confirmLabel: 'Delete', danger: true }))) return;
                    try {
                      await api.del(`/scripts/${sel.id}`);
                      setSelId(null);
                      void reload();
                    } catch (err) {
                      toast.error(describeError(err));
                    }
                  }}
                >
                  Delete
                </button>
              )}
              <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
                Save script
              </button>
            </div>
          </div>
          <div className="card stack">
            <div className="card-title">
              <h3 style={{ margin: 0 }}>Live preview</h3>
              {sel && (
                <button
                  type="button"
                  className="btn small"
                  onClick={async () => {
                    try {
                      const r = await api.get<{ rendered: string }>(`/scripts/${sel.id}/preview`);
                      setServerPreview(r.rendered);
                    } catch (err) {
                      toast.error(describeError(err));
                    }
                  }}
                >
                  Server preview (saved version)
                </button>
              )}
            </div>
            <span className="muted small">Sample lead: Jane Doe, Acme Inc</span>
            <ScriptView body={body} lead={SAMPLE_LEAD} agentName={user?.displayName} companyName={company} />
            {serverPreview != null && (
              <>
                <hr />
                <span className="muted small">Rendered by the server:</span>
                <ScriptMarkup text={serverPreview} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
