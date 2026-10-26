import { lazy, Suspense } from 'react';
import { Loading } from '../../components/ui';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import type { Role } from '@opendialer/shared';
import { TopBar } from '../../components/Chrome';
import { hasRole, useAuth } from '../../store/auth';
import Dashboard from './Dashboard';
import Campaigns from './Campaigns';
import CampaignDetail from './CampaignDetail';

const Leads = lazy(() => import('./Leads'));
const Dnc = lazy(() => import('./Dnc'));
const Dispositions = lazy(() => import('./Dispositions'));
const Scripts = lazy(() => import('./Scripts'));
const Users = lazy(() => import('./Users'));
const SettingsPage = lazy(() => import('./Settings'));
const Reports = lazy(() => import('./Reports'));
const Calls = lazy(() => import('./Calls'));
const Callbacks = lazy(() => import('./Callbacks'));
const Integrations = lazy(() => import('./Integrations'));
const Audit = lazy(() => import('./Audit'));
const System = lazy(() => import('./System'));

const NAV: { section?: string; to: string; label: string; role: Role }[] = [
  { section: 'Live', to: 'dashboard', label: 'Dashboard', role: 'supervisor' },
  { to: 'campaigns', label: 'Campaigns', role: 'supervisor' },
  { to: 'leads', label: 'Leads', role: 'supervisor' },
  { to: 'callbacks', label: 'Callbacks', role: 'supervisor' },
  { to: 'calls', label: 'Calls & recordings', role: 'supervisor' },
  { to: 'reports', label: 'Reports', role: 'supervisor' },
  { section: 'Setup', to: 'scripts', label: 'Scripts', role: 'supervisor' },
  { to: 'dispositions', label: 'Dispositions', role: 'supervisor' },
  { to: 'dnc', label: 'Do-not-call', role: 'supervisor' },
  { to: 'users', label: 'Users', role: 'supervisor' },
  { to: 'settings', label: 'Settings', role: 'supervisor' },
  { section: 'System', to: 'integrations', label: 'Integrations', role: 'admin' },
  { to: 'audit', label: 'Audit log', role: 'supervisor' },
  { to: 'system', label: 'System & backup', role: 'admin' },
];

export default function AdminApp() {
  const user = useAuth((s) => s.user);
  const items = NAV.filter((n) => hasRole(user, n.role));
  return (
    <>
      <TopBar />
      <div className="admin">
        <nav className="sidebar" aria-label="Admin">
          {items.map((n) => (
            <div key={n.to} style={{ display: 'contents' }}>
              {n.section && <div className="section">{n.section}</div>}
              <NavLink to={`/admin/${n.to}`} className={({ isActive }) => (isActive ? 'active' : '')}>
                {n.label}
              </NavLink>
            </div>
          ))}
        </nav>
        <main className="admin-main">
          <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="campaigns/:id" element={<CampaignDetail />} />
            <Route path="leads" element={<Leads />} />
            <Route path="dnc" element={<Dnc />} />
            <Route path="dispositions" element={<Dispositions />} />
            <Route path="scripts" element={<Scripts />} />
            <Route path="users" element={<Users />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="reports" element={<Reports />} />
            <Route path="calls" element={<Calls />} />
            <Route path="callbacks" element={<Callbacks />} />
            {hasRole(user, 'admin') && <Route path="integrations" element={<Integrations />} />}
            <Route path="audit" element={<Audit />} />
            {hasRole(user, 'admin') && <Route path="system" element={<System />} />}
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </>
  );
}
