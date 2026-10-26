import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { setupSchema, type User } from '@opendialer/shared';
import { Brand, ThemeToggle } from '../components/Chrome';
import { Field } from '../components/ui';
import { describeError, request } from '../lib/api';
import { COUNTRIES, browserTimeZone, timeZones, zodIssues } from '../lib/format';
import { useAuth } from '../store/auth';

export function SetupPage() {
  const pub = useAuth((s) => s.publicSettings);
  const nav = useNavigate();
  const zones = useMemo(() => timeZones(), []);
  const [form, setForm] = useState({
    username: 'admin',
    password: '',
    confirm: '',
    displayName: 'Administrator',
    companyName: '',
    defaultCountry: 'US',
    defaultTimezone: zones.includes(browserTimeZone()) ? browserTimeZone() : 'UTC',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (pub && !pub.needsSetup) return <Navigate to="/login" replace />;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { confirm, ...rest } = form;
    const parsed = setupSchema.safeParse({ ...rest, companyName: rest.companyName.trim() || 'OpenDialer' });
    const errs = parsed.success ? {} : zodIssues(parsed.error);
    if (confirm !== form.password) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    if (!parsed.success || errs.confirm) return;
    setBusy(true);
    setError(null);
    try {
      const r = await request<{ token: string; user: User }>('POST', '/setup', { body: parsed.data, noAuthRedirect: true });
      await useAuth.getState().acceptSession(r.token, r.user);
      await useAuth.getState().loadPublic();
      nav('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="card auth-card" style={{ width: 'min(560px, 100%)' }}>
        <div className="row between">
          <span />
          <ThemeToggle />
        </div>
        <Brand to="/setup" />
        <form className="stack" onSubmit={submit} noValidate>
          <h1>Welcome – first-time setup</h1>
          <p className="muted">Create the administrator account and set your company defaults. You can change everything later in Settings.</p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <fieldset className="stack">
            <legend>Administrator</legend>
            <Field label="Username" error={errors.username}>
              <input name="username" autoComplete="username" value={form.username} onChange={set('username')} />
            </Field>
            <Field label="Display name" error={errors.displayName}>
              <input name="displayName" value={form.displayName} onChange={set('displayName')} />
            </Field>
            <div className="grid cols-2">
              <Field label="Password" hint="At least 8 characters" error={errors.password}>
                <input name="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
              </Field>
              <Field label="Confirm password" error={errors.confirm}>
                <input name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
              </Field>
            </div>
          </fieldset>
          <fieldset className="stack">
            <legend>Company</legend>
            <Field label="Company name" error={errors.companyName}>
              <input name="companyName" value={form.companyName} placeholder="Acme Sales" onChange={set('companyName')} />
            </Field>
            <div className="grid cols-2">
              <Field label="Default country" hint="Used to read national phone numbers" error={errors.defaultCountry}>
                <select name="defaultCountry" value={form.defaultCountry} onChange={set('defaultCountry')}>
                  {COUNTRIES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name} ({code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Default timezone" error={errors.defaultTimezone}>
                <select name="defaultTimezone" value={form.defaultTimezone} onChange={set('defaultTimezone')}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </fieldset>
          <button type="submit" className="btn primary large block" disabled={busy}>
            {busy ? 'Creating…' : 'Create admin & continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
