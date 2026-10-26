import { useMemo, useState, type FormEvent } from 'react';
import { campaignCreateSchema, type Campaign, type CampaignCreateInput, type Script } from '@opendialer/shared';
import { Field, useLoad } from '../../components/ui';
import { api } from '../../lib/api';
import { timeZones, zodIssues } from '../../lib/format';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function defaultCampaign(): CampaignCreateInput {
  return { ...campaignCreateSchema.parse({ name: 'placeholder' }), name: '' };
}

export function campaignToInput(c: Campaign): CampaignCreateInput {
  return {
    name: c.name,
    description: c.description,
    dialMode: c.dialMode,
    callerId: c.callerId,
    scriptId: c.scriptId,
    callingHoursStart: c.callingHoursStart,
    callingHoursEnd: c.callingHoursEnd,
    callingDays: [...c.callingDays],
    timezoneMode: c.timezoneMode,
    fixedTimezone: c.fixedTimezone,
    maxAttempts: c.maxAttempts,
    retryMinutes: c.retryMinutes,
    previewTimeoutSec: c.previewTimeoutSec,
    wrapupTimeoutSec: c.wrapupTimeoutSec,
    recording: c.recording,
    dialPrefix: c.dialPrefix,
  };
}

/** Full campaign settings form (create + edit), validated with the shared zod schema. */
export function CampaignForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CampaignCreateInput;
  submitLabel: string;
  onSubmit: (v: CampaignCreateInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<CampaignCreateInput>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(), []);
  const scripts = useLoad(() => api.get<Script[]>('/scripts'), []);

  const set = <K extends keyof CampaignCreateInput>(k: K, val: CampaignCreateInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const num = (k: 'maxAttempts' | 'retryMinutes' | 'previewTimeoutSec' | 'wrapupTimeoutSec') => ({
    type: 'number' as const,
    value: Number.isFinite(v[k]) ? String(v[k]) : '',
    onChange: (e: { target: { value: string } }) => set(k, e.target.value === '' ? Number.NaN : Number(e.target.value)),
    'aria-invalid': Boolean(errors[k]),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = campaignCreateSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(zodIssues(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const allDay = v.callingHoursStart === v.callingHoursEnd;

  return (
    <form className="stack" onSubmit={submit} noValidate aria-label="Campaign settings">
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="grid cols-2">
        <Field label="Name" error={errors.name}>
          <input name="name" value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Dial mode" hint="Preview: agent reviews then dials. Progressive: dials immediately. Manual: click-to-dial only.">
          <select name="dialMode" value={v.dialMode} onChange={(e) => set('dialMode', e.target.value as CampaignCreateInput['dialMode'])}>
            <option value="preview">Preview</option>
            <option value="progressive">Progressive</option>
            <option value="manual">Manual</option>
          </select>
        </Field>
      </div>
      <Field label="Description" error={errors.description}>
        <textarea name="description" rows={2} value={v.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="grid cols-3">
        <Field label="Caller ID" hint="Shown to the called party if your PBX allows it" error={errors.callerId}>
          <input name="callerId" value={v.callerId} onChange={(e) => set('callerId', e.target.value)} />
        </Field>
        <Field label="Dial prefix" hint='e.g. "9" for an outside line' error={errors.dialPrefix}>
          <input name="dialPrefix" value={v.dialPrefix} onChange={(e) => set('dialPrefix', e.target.value)} />
        </Field>
        <Field label="Script">
          <select name="scriptId" value={v.scriptId ?? ''} onChange={(e) => set('scriptId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— none —</option>
            {(scripts.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="stack">
        <legend>Calling hours</legend>
        <div className="row">
          <button
            type="button"
            className="btn small"
            onClick={() => setV((p) => ({ ...p, callingHoursStart: '00:00', callingHoursEnd: '00:00', callingDays: [0, 1, 2, 3, 4, 5, 6] }))}
          >
            24/7
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => setV((p) => ({ ...p, callingHoursStart: '09:00', callingHoursEnd: '20:00', callingDays: [1, 2, 3, 4, 5] }))}
          >
            Weekdays 9–20
          </button>
          {allDay && <span className="badge blue">All day</span>}
        </div>
        <div className="grid cols-2">
          <Field label="From (lead's local time)" error={errors.callingHoursStart}>
            <input name="callingHoursStart" type="time" value={v.callingHoursStart} onChange={(e) => set('callingHoursStart', e.target.value)} />
          </Field>
          <Field label="Until" hint="Same as start = all day" error={errors.callingHoursEnd}>
            <input name="callingHoursEnd" type="time" value={v.callingHoursEnd} onChange={(e) => set('callingHoursEnd', e.target.value)} />
          </Field>
        </div>
        <div className="days" role="group" aria-label="Calling days">
          {DAY_NAMES.map((d, i) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={v.callingDays.includes(i)}
                onChange={(e) => set('callingDays', e.target.checked ? [...v.callingDays, i].sort() : v.callingDays.filter((x) => x !== i))}
              />
              {d}
            </label>
          ))}
        </div>
        <div className="grid cols-2">
          <Field label="Timezone mode" hint="Lead: each lead's own zone (from data or area code). Fixed: one zone for all.">
            <select name="timezoneMode" value={v.timezoneMode} onChange={(e) => set('timezoneMode', e.target.value as 'lead' | 'fixed')}>
              <option value="lead">Lead's timezone</option>
              <option value="fixed">Fixed timezone</option>
            </select>
          </Field>
          <Field label="Fixed / fallback timezone" error={errors.fixedTimezone}>
            <select name="fixedTimezone" value={v.fixedTimezone} onChange={(e) => set('fixedTimezone', e.target.value)}>
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
      <fieldset className="grid cols-4">
        <legend>Attempts & timing</legend>
        <Field label="Max attempts" error={errors.maxAttempts}>
          <input name="maxAttempts" min={1} max={50} {...num('maxAttempts')} />
        </Field>
        <Field label="Retry after (min)" error={errors.retryMinutes}>
          <input name="retryMinutes" min={1} {...num('retryMinutes')} />
        </Field>
        <Field label="Preview timeout (s)" hint="0 = agent must click Dial" error={errors.previewTimeoutSec}>
          <input name="previewTimeoutSec" min={0} {...num('previewTimeoutSec')} />
        </Field>
        <Field label="Wrap-up timeout (s)" hint="0 = unlimited" error={errors.wrapupTimeoutSec}>
          <input name="wrapupTimeoutSec" min={0} {...num('wrapupTimeoutSec')} />
        </Field>
      </fieldset>
      <Field label="Call recording" hint="Recordings are made in the agent's browser and uploaded to the server.">
        <select name="recording" value={v.recording} onChange={(e) => set('recording', e.target.value as CampaignCreateInput['recording'])}>
          <option value="off">Off</option>
          <option value="agent">Agent decides (Record toggle)</option>
          <option value="always">Always</option>
        </select>
      </Field>
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
