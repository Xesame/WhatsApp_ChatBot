import { useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router';
import { api, ApiError } from './api.ts';
import { Listing } from './firm/Listing.tsx';
import { Saved } from './firm/Saved.tsx';
import { Search } from './firm/Search.tsx';
import { DashboardShell, useMe } from './firm/Shell.tsx';
import { Team } from './firm/Team.tsx';
import { useDocumentLanguage } from './i18n.tsx';
import { Entities } from './pages/Entities.tsx';
import { Firms } from './pages/Firms.tsx';
import { Groups } from './pages/Groups.tsx';
import { Jobs } from './pages/Jobs.tsx';
import { Login } from './pages/Login.tsx';
import { Overview } from './pages/Overview.tsx';
import { Review } from './pages/Review.tsx';
import { SetPassword } from './pages/SetPassword.tsx';
import { Settings } from './pages/Settings.tsx';
import { WhatsApp } from './pages/WhatsApp.tsx';
import { Button, cx, ErrorNote, Loading } from './ui.tsx';

// Two apps in one: the firm dashboard under /app (Arabic or English) and the
// owner's admin console at / (English). Firm users never see the console.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/set-password" element={<SetPassword />} />
        <Route path="/app" element={<DashboardShell />}>
          <Route index element={<Search />} />
          <Route path="listings/:id" element={<Listing />} />
          <Route path="saved" element={<Saved />} />
          <Route path="team" element={<Team />} />
        </Route>
        <Route element={<Shell />}>
          <Route index element={<Overview />} />
          <Route path="firms" element={<Firms />} />
          <Route path="whatsapp" element={<WhatsApp />} />
          <Route path="groups" element={<Groups />} />
          <Route path="review" element={<Review />} />
          <Route path="names" element={<Entities />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

const NAV = [
  ['/', 'Overview'],
  ['/firms', 'Firms'],
  ['/app', 'Listings (firm view)'],
  ['/whatsapp', 'WhatsApp'],
  ['/groups', 'Groups'],
  ['/review', 'Review'],
  ['/names', 'Places & names'],
  ['/jobs', 'Failed jobs'],
  ['/settings', 'Settings & export'],
] as const;

/** The admin console layout: owner only (firm users go to their dashboard), always in English. */
function Shell() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useDocumentLanguage('en');

  if (me.isPending) {
    return (
      <div className="p-8">
        <Loading />
      </div>
    );
  }
  if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403)) {
    return <Navigate to="/login" replace />;
  }
  if (me.error) {
    return (
      <div className="p-8">
        <ErrorNote error={me.error} />
      </div>
    );
  }
  if (me.data.role !== 'owner') return <Navigate to="/app" replace />;

  const signOut = async () => {
    await api('/api/auth/sign-out', { method: 'POST', body: {} }).catch(() => undefined);
    queryClient.clear();
    await navigate('/login');
  };

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:min-h-screen md:w-56 md:border-r md:border-b-0 dark:border-slate-800 dark:bg-slate-900">
        <div className="px-4 py-4">
          <p className="text-sm font-semibold">Real Estate Bot</p>
          <p className="text-xs text-slate-500">Admin console</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm',
                  isActive
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-4 py-4 text-xs text-slate-500 md:block">
          <p className="truncate">{me.data.email}</p>
          <Button variant="ghost" className="mt-1 -ms-3" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">
        <Outlet />
        <Button variant="ghost" className="mt-8 md:hidden" onClick={() => void signOut()}>
          Sign out
        </Button>
      </main>
    </div>
  );
}
