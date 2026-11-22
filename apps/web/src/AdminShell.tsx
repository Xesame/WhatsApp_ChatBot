import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api, ApiError, type FailedJob, type Stats } from './api.ts';
import { useMe } from './firm/Shell.tsx';
import { useDocumentLanguage } from './i18n.tsx';
import { Button, cx, ErrorNote, Loading, Wordmark } from './ui.tsx';

const NAV = [
  { to: '/', label: 'Overview', count: 'none' },
  { to: '/review', label: 'Review', count: 'review' },
  { to: '/names', label: 'Places & names', count: 'none' },
  { to: '/groups', label: 'Groups', count: 'none' },
  { to: '/whatsapp', label: 'WhatsApp', count: 'none' },
  { to: '/firms', label: 'Firms', count: 'none' },
  { to: '/app', label: 'Listings', count: 'none' },
  { to: '/jobs', label: 'Failed jobs', count: 'jobs' },
  { to: '/settings', label: 'Settings', count: 'none' },
] as const;

/** The admin console layout: owner only (firm users go to their dashboard), always in English. */
export function AdminShell() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useDocumentLanguage('en');

  // The two counts reuse the queries the Overview and Failed jobs pages already run
  // (same keys), so there is no extra request when those pages are open.
  const isOwner = me.data?.role === 'owner';
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/api/admin/stats?days=14'),
    refetchInterval: 60_000,
    enabled: isOwner,
  });
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api<FailedJob[]>('/api/admin/jobs/failed'),
    refetchInterval: 30_000,
    enabled: isOwner,
  });

  // Close the phone menu after choosing a page.
  useEffect(() => setOpen(false), [location.pathname]);

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

  const counts = {
    none: 0,
    review: stats.data?.needsReview ?? 0,
    jobs: jobs.data?.length ?? 0,
  };

  return (
    <div className="min-h-screen md:flex">
      <header className="on-graphite flex items-center justify-between bg-graphite px-4 py-3 md:hidden">
        <Wordmark name="Real Estate Bot" className="text-base" />
        <Button
          variant="inverse"
          aria-expanded={open}
          aria-controls="console-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Close' : 'Menu'}
        </Button>
      </header>
      <aside
        className={cx(
          'on-graphite flex-col bg-graphite text-bone md:sticky md:top-0 md:flex md:h-screen md:w-58 md:shrink-0',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="hidden px-5 pt-6 pb-5 md:block">
          <Wordmark name="Real Estate Bot" className="text-base" />
        </div>
        <nav id="console-nav" aria-label="Console" className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="space-y-0.5">
            {NAV.map((item) => {
              const count = counts[item.count];
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cx(
                        'flex min-h-9 items-center justify-between rounded-control px-3 text-sm',
                        isActive
                          ? 'bg-graphite-2 font-bold shadow-[inset_3px_0_0_var(--color-lime)] rtl:shadow-[inset_-3px_0_0_var(--color-lime)]'
                          : 'text-bone/80 hover:bg-graphite-2/60 hover:text-bone',
                      )
                    }
                  >
                    {item.label}
                    {count > 0 && (
                      <span className="rounded-full bg-lime px-2 text-xs font-extrabold text-ink">
                        {count}
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-bone/15 px-5 py-4">
          <p className="truncate text-xs text-bone/70">{me.data.email}</p>
          <Button variant="inverse" size="sm" className="mt-2 -ms-3" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="max-w-[1200px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
