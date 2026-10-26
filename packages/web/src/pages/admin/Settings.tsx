import { useEffect, useMemo, useState } from 'react';
import { settingsSchema, type Settings } from '@opendialer/shared';
import { ErrorBox, Field, Loading, useLoad } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { COUNTRIES, timeZones, zodIssues } from '../../lib/format';
import { hasRole, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

export default function SettingsPage() {
  const user = useAuth((s) => s.user);
  const admin = hasRole(user, 'admin');
  const { data, error, reload } = useLoad(() => api.get<Settings>('/settings'), []);
  const [v, setV] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState('');
  const zones = useMemo(() => timeZones(), []);
  useEffect(() => setV(data), [data]);

  if (!v) return error ? <ErrorBox error={error} onRetry={reload} /> : <Loading />;
  const t = v.telephony;
  const setT = (patch: Partial<Settings['telephony']>) => setV({ ...v, telephony: { ...t, ...patch } });

  const save = async () => {
    const parsed = settingsSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(zodIssues(parsed.error));
      toast.error('Please fix the highlighted fields');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const s = await api.put<Settings>('/settings', parsed.data);
      setV(s);
      useAuth.getState().setSettings(s);
      void useAuth.getState().loadPublic();
      toast.success('Settings saved');
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <div className="page-head">
        <h1>Settings</h1>
        {admin ? (
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        ) : (
          <span className="muted small">Read-only – only admins can change settings.</span>
        )}
      </div>
      <fieldset disabled={!admin} className="stack" style={{ border: 'none', padding: 0 }}>
        <section className="card stack">
          <h2>Company</h2>
          <div className="grid cols-3">
            <Field label="Company name" error={errors.companyName}>
              <input value={v.companyName} onChange={(e) => setV({ ...v, companyName: e.target.value })} />
            </Field>
            <Field label="Default country" error={errors.defaultCountry}>
              <select value={v.defaultCountry} onChange={(e) => setV({ ...v, defaultCountry: e.target.value })}>
                {!COUNTRIES.some(([c]) => c === v.defaultCountry) && <option value={v.defaultCountry}>{v.defaultCountry}</option>}
                {COUNTRIES.map(([c, n]) => (
                  <option key={c} value={c}>
                    {n} ({c})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Default timezone" error={errors.defaultTimezone}>
              <select value={v.defaultTimezone} onChange={(e) => setV({ ...v, defaultTimezone: e.target.value })}>
                {!zones.includes(v.defaultTimezone) && <option>{v.defaultTimezone}</option>}
                {zones.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="card stack">
          <h2>Telephony</h2>
          <div className="row">
            <label className="check">
              <input type="radio" name="mode" checked={t.mode === 'sim'} onChange={() => setT({ mode: 'sim' })} /> Simulation (no real calls – demo & training)
            </label>
            <label className="check">
              <input type="radio" name="mode" checked={t.mode === 'sip'} onChange={() => setT({ mode: 'sip' })} /> SIP over WebRTC
            </label>
          </div>
          <div className="grid cols-2">
            <Field label="WebSocket URL (WSS)" hint="e.g. wss://pbx.example.com:8089/ws" error={errors['telephony.wssUrl']}>
              <input value={t.wssUrl} onChange={(e) => setT({ wssUrl: e.target.value })} placeholder="wss://pbx.example.com:8089/ws" />
            </Field>
            <Field label="SIP domain" hint="e.g. pbx.example.com" error={errors['telephony.sipDomain']}>
              <input value={t.sipDomain} onChange={(e) => setT({ sipDomain: e.target.value })} />
            </Field>
            <Field label="Ring timeout (seconds)" error={errors['telephony.ringTimeoutSec']}>
              <input type="number" min={5} max={180} value={t.ringTimeoutSec} onChange={(e) => setT({ ringTimeoutSec: Number(e.target.value) })} />
            </Field>
            <label className="check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={t.register} onChange={(e) => setT({ register: e.target.checked })} /> Register softphones (needed to receive calls)
            </label>
          </div>
          <fieldset className="stack tight">
            <legend>ICE servers (STUN / TURN)</legend>
            {t.iceServers.map((s, i) => (
              <div key={i} className="grid cols-4" style={{ alignItems: 'end' }}>
                <Field label="URLs" error={errors[`telephony.iceServers.${i}.urls`]}>
                  <input value={s.urls} placeholder="stun:stun.example.com:3478" onChange={(e) => setT({ iceServers: t.iceServers.map((x, j) => (j === i ? { ...x, urls: e.target.value } : x)) })} />
                </Field>
                <Field label="Username">
                  <input value={s.username ?? ''} onChange={(e) => setT({ iceServers: t.iceServers.map((x, j) => (j === i ? { ...x, username: e.target.value || undefined } : x)) })} />
                </Field>
                <Field label="Credential">
                  <input type="password" value={s.credential ?? ''} onChange={(e) => setT({ iceServers: t.iceServers.map((x, j) => (j === i ? { ...x, credential: e.target.value || undefined } : x)) })} />
                </Field>
                <button type="button" className="btn ghost" onClick={() => setT({ iceServers: t.iceServers.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="btn small" onClick={() => setT({ iceServers: [...t.iceServers, { urls: '' }] })}>
                + Add ICE server
              </button>
            </div>
          </fieldset>
        </section>

        <section className="card stack">
          <h2>Pause codes</h2>
          <div className="row">
            {v.pauseCodes.map((c) => (
              <span key={c} className="badge">
                {c}
                <button type="button" className="btn ghost small" style={{ minHeight: 0, padding: '0 0.2rem' }} aria-label={`Remove ${c}`} onClick={() => setV({ ...v, pauseCodes: v.pauseCodes.filter((x) => x !== c) })}>
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="row">
            <input aria-label="New pause code" style={{ maxWidth: 240 }} value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. Coaching" />
            <button
              type="button"
              className="btn small"
              disabled={!newCode.trim() || v.pauseCodes.includes(newCode.trim())}
              onClick={() => {
                setV({ ...v, pauseCodes: [...v.pauseCodes, newCode.trim()] });
                setNewCode('');
              }}
            >
              Add
            </button>
          </div>
        </section>

        <section className="card stack">
          <h2>Compliance</h2>
          <div className="grid cols-2">
            <Field label="Max attempts per number per day" hint="Across all campaigns, 0 = no limit" error={errors.maxAttemptsPerDay}>
              <input type="number" min={0} max={100} value={v.maxAttemptsPerDay} onChange={(e) => setV({ ...v, maxAttemptsPerDay: Number(e.target.value) })} />
            </Field>
            <label className="check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={v.requireConsentFlag} onChange={(e) => setV({ ...v, requireConsentFlag: e.target.checked })} /> Only dial leads with custom field <code>consent</code> = yes
            </label>
          </div>
          <Field label="Recording consent notice" hint="Shown to the agent on the lead card while a call is recorded" error={errors.recordingConsentNotice}>
            <textarea rows={2} value={v.recordingConsentNotice} onChange={(e) => setV({ ...v, recordingConsentNotice: e.target.value })} />
          </Field>
        </section>
      </fieldset>
    </form>
  );
}
