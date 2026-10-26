import { useEffect, useState } from 'react';
import { formatPhone, type Disposition, type Lead } from '@opendialer/shared';
import type { AgentController } from '../../agent/controller';
import { useAgent } from '../../agent/store';
import { ScriptView } from '../../components/ScriptView';
import { useNow } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { fmtDateTime, fmtTimeIn, leadName } from '../../lib/format';
import { toast } from '../../store/toasts';

export function LeadCard({ ctrl, dispositions, consentNotice }: { ctrl: AgentController; dispositions: Disposition[]; consentNotice: string }) {
  const lead = useAgent((s) => s.lead);
  const assignment = useAgent((s) => s.assignment);
  const agent = useAgent((s) => s.agent);
  const call = useAgent((s) => s.call);
  const busy = useAgent((s) => s.busy);
  const previewDeadline = useAgent((s) => s.previewDeadline);
  const now = useNow(500);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setNotes(lead?.notes ?? ''), [lead?.id, lead?.notes]);

  const state = agent?.state;
  if (!lead) {
    return (
      <section className="card" aria-label="Lead">
        <div className="waiting">
          {state === 'ready' ? (
            <>
              <div className="big">Waiting for the next lead…</div>
              <div>You will get a lead as soon as one is available.</div>
            </>
          ) : state === 'paused' ? (
            <>
              <div className="big">You are paused</div>
              <div>Press Ready to start receiving leads, or dial a number manually.</div>
            </>
          ) : call ? (
            <>
              <div className="big">Manual call</div>
              <div className="lead-phone">{formatPhone(call.phone) || call.phone}</div>
            </>
          ) : (
            <div className="big">No lead</div>
          )}
        </div>
      </section>
    );
  }

  const lastDispo = dispositions.find((d) => d.id === lead.lastDispositionId);
  const isPreview = assignment && state === 'assigned' && !call;
  const remaining = previewDeadline ? Math.max(0, Math.ceil((previewDeadline - now) / 1000)) : null;
  const customEntries = Object.entries(lead.custom ?? {}).filter(([, v]) => v !== '');
  const localTime = fmtTimeIn(lead.timezone, new Date(now));

  const saveNotes = async () => {
    setSaving(true);
    try {
      const updated = await api.patch<Lead>(`/leads/${lead.id}`, { notes });
      ctrl.patchLead(updated);
      toast.success('Notes saved');
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card stack" aria-label="Lead" data-testid="lead-card">
      <div className="row between">
        <div className="stack tight" style={{ minWidth: 0 }}>
          <div className="lead-name" data-testid="lead-name">
            {leadName(lead) || 'Unknown name'}
          </div>
          {lead.company && <div className="muted">{lead.company}</div>}
        </div>
        <span className="badge">{lead.status}</span>
      </div>
      <div className="lead-phone" data-testid="lead-phone">
        {formatPhone(lead.phone) || lead.phone}
      </div>
      {call?.recording && (
        <div className="consent" role="status">
          <span className="rec-dot" aria-hidden="true" />
          <span>Recording. {consentNotice}</span>
        </div>
      )}
      {assignment?.callback && (
        <div className="alert info">
          <strong>Callback</strong> scheduled {fmtDateTime(assignment.callback.scheduledAt)}
          {assignment.callback.note && <> – {assignment.callback.note}</>}
        </div>
      )}
      {isPreview && (
        <div className="row">
          <button type="button" className="btn primary large" disabled={busy} onClick={() => void ctrl.dialAssigned()}>
            📞 Dial{remaining != null ? ` (${remaining}s)` : ''}
          </button>
          <button type="button" className="btn large" disabled={busy} onClick={() => void ctrl.skip(true)}>
            Skip
          </button>
          {remaining != null && <span className="countdown muted">Auto-dial in {remaining}s</span>}
        </div>
      )}
      <dl className="kv">
        {lead.email && (
          <>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${lead.email}`}>{lead.email}</a>
            </dd>
          </>
        )}
        <dt>Timezone</dt>
        <dd>{lead.timezone ? `${lead.timezone}${localTime ? ` · local time ${localTime}` : ''}` : <span className="muted">unknown</span>}</dd>
        <dt>Attempts</dt>
        <dd>{lead.attempts}</dd>
        <dt>Last result</dt>
        <dd>
          {lastDispo ? (
            <span className="row">
              <span className="swatch" style={{ background: lastDispo.color }} /> {lastDispo.label}
            </span>
          ) : (
            <span className="muted">–</span>
          )}
          {lead.lastAttemptAt && <span className="muted small"> · {fmtDateTime(lead.lastAttemptAt)}</span>}
        </dd>
        {customEntries.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <label className="field">
        <span>Lead notes</span>
        <textarea aria-label="Lead notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>
      <div className="row end">
        <button type="button" className="btn small" disabled={saving || notes === (lead.notes ?? '')} onClick={() => void saveNotes()}>
          {saving ? 'Saving…' : 'Save notes'}
        </button>
      </div>
    </section>
  );
}

export function ScriptPanel({ agentName, companyName }: { agentName: string; companyName: string }) {
  const assignment = useAgent((s) => s.assignment);
  const campaign = useAgent((s) => s.campaign);
  const lead = useAgent((s) => s.lead);
  const script = assignment?.script ?? campaign?.script ?? null;
  if (!script || !script.body.trim()) return null;
  return (
    <section className="card" aria-label="Script">
      <h3>Script · {script.name}</h3>
      <ScriptView body={script.body} lead={lead} agentName={agentName} companyName={companyName} />
    </section>
  );
}
