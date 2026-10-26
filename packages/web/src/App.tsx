import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '@opendialer/shared';
import { DialogHost, Loading } from './components/ui';
import { Toasts } from './components/Toasts';
import { setUnauthorizedHandler } from './lib/api';
import { hasRole, useAuth } from './store/auth';
import { LoginPage } from './pages/Login';
import { SetupPage } from './pages/Setup';

const AgentConsole = lazy(() => import('./pages/agent/AgentConsole'));
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));

function RequireAuth({ children, role = 'agent' }: { children: ReactNode; role?: Role }) {
  const user = useAuth((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!hasRole(user, role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Home() {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={hasRole(user, 'supervisor') ? '/admin/dashboard' : '/agent'} replace />;
}

function SetupGate({ children }: { children: ReactNode }) {
  const needsSetup = useAuth((s) => s.publicSettings?.needsSetup);
  const loc = useLocation();
  if (needsSetup && loc.pathname !== '/setup') return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function App() {
  const booted = useAuth((s) => s.booted);
  useEffect(() => {
    setUnauthorizedHandler(() => useAuth.getState().expire());
    void useAuth.getState().boot();
  }, []);
  if (!booted) return <Loading label="Starting OpenDialer…" />;
  return (
    <BrowserRouter>
      <SetupGate>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/agent"
              element={
                <RequireAuth>
                  <AgentConsole />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/*"
              element={
                <RequireAuth role="supervisor">
                  <AdminApp />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </SetupGate>
      <Toasts />
      <DialogHost />
    </BrowserRouter>
  );
}
