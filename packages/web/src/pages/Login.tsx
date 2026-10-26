import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginSchema } from '@opendialer/shared';
import { Brand, ThemeToggle } from '../components/Chrome';
import { Field } from '../components/ui';
import { describeError } from '../lib/api';
import { displayServerUrl, setServerUrl } from '../lib/config';
import { hasRole, useAuth } from '../store/auth';

export function LoginPage() {
  const user = useAuth((s) => s.user);
  const serverError = useAuth((s) => s.serverError);
  const pub = useAuth((s) => s.publicSettings);
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(displayServerUrl());
  const [showServer, setShowServer] = useState(Boolean(serverError));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    const from = (loc.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : hasRole(user, 'supervisor') ? '/admin/dashboard' : '/agent'} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ username: username.trim(), password });
    if (!parsed.success) {
      setError('Enter your username and password');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setServerUrl(server);
      const p = await useAuth.getState().loadPublic();
      if (p?.needsSetup) {
        nav('/setup');
        return;
      }
      await useAuth.getState().login(parsed.data.username, parsed.data.password);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="row between">
          <span />
          <ThemeToggle />
        </div>
        <Brand to="/login" />
        <form className="stack" onSubmit={submit} noValidate>
          <h1 style={{ textAlign: 'center' }}>Sign in</h1>
          {serverError && !error && <div className="alert warning">Server not reachable: {serverError}</div>}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <Field label="Username">
            <input name="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {showServer ? (
            <Field label="Server" hint="Leave as is when this page is served by your OpenDialer server.">
              <input name="server" inputMode="url" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://dialer.example.com:8443" />
            </Field>
          ) : (
            <button type="button" className="btn ghost small" onClick={() => setShowServer(true)}>
              Server: {server}
            </button>
          )}
          <button type="submit" className="btn primary large block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {pub && <p className="muted small" style={{ textAlign: 'center' }}>OpenDialer {pub.version}</p>}
        </form>
      </div>
    </div>
  );
}
