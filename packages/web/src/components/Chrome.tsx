import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setTheme, useTheme, type ThemeChoice } from '../lib/theme';
import { hasRole, useAuth } from '../store/auth';

export function ThemeToggle() {
  const theme = useTheme();
  const next: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
  const icon = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐';
  return (
    <button
      type="button"
      className="btn ghost icon-btn"
      title={`Theme: ${theme} (click to change)`}
      aria-label={`Theme: ${theme}`}
      onClick={() => setTheme(next[theme])}
    >
      {icon}
    </button>
  );
}

export function Brand({ to = '/' }: { to?: string }) {
  const company = useAuth((s) => s.settings?.companyName ?? s.publicSettings?.companyName);
  return (
    <Link to={to} className="brand">
      <img src="/icons/icon-192.png" alt="" />
      <span>{company && company !== 'OpenDialer' ? company : 'OpenDialer'}</span>
    </Link>
  );
}

/** Top bar used by the admin area (the agent console has its own richer header). */
export function TopBar({ children }: { children?: ReactNode }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const nav = useNavigate();
  return (
    <header className="topbar">
      <Brand to={hasRole(user, 'supervisor') ? '/admin/dashboard' : '/agent'} />
      {children}
      <span className="spacer" />
      {hasRole(user, 'supervisor') && (
        <Link className="btn small" to="/agent">
          Agent console
        </Link>
      )}
      <span className="who">{user?.displayName}</span>
      <ThemeToggle />
      <button
        type="button"
        className="btn small"
        onClick={() => {
          logout();
          nav('/login');
        }}
      >
        Log out
      </button>
    </header>
  );
}
