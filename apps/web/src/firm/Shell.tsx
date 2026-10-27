import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { api, ApiError, type Me } from '../api.ts';
import { useDocumentLanguage, useI18n } from '../i18n.tsx';
import { Button, cx, ErrorNote, Loading } from '../ui.tsx';

/** The signed-in person (any role). Shared by the dashboard and the admin console. */
export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/app/me') });
}

/** Layout of the firm dashboard: top bar, language switch, and the page. */
export function DashboardShell() {
  const me = useMe();
  const i18n = useI18n();
  const { t, locale, setLocale } = i18n;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useDocumentLanguage(locale);

  // Use the language saved on the account once it is known.
  const synced = useRef(false);
  useEffect(() => {
    if (me.data && !synced.current) {
      synced.current = true;
      if (me.data.locale !== locale) setLocale(me.data.locale);
    }
  }, [me.data, locale, setLocale]);

  const switchLanguage = useMutation({
    mutationFn: (next: 'en' | 'ar') =>
      api('/api/app/me/locale', { method: 'PUT', body: { locale: next } }),
    onMutate: (next) => setLocale(next),
  });

  if (me.isPending)
    return (
      <div className="p-8">
        <Loading />
      </div>
    );
  if (me.error instanceof ApiError && me.error.status === 401)
    return <Navigate to="/login" replace />;
  if (me.error) {
    return (
      <div className="p-8">
        <ErrorNote
          error={
            me.error instanceof ApiError && me.error.status === 403 ? t('login.blocked') : me.error
          }
        />
      </div>
    );
  }

  const signOut = async () => {
    await api('/api/auth/sign-out', { method: 'POST', body: {} }).catch(() => undefined);
    queryClient.clear();
    await navigate('/login');
  };
  const links: [string, string][] = [
    ['/app', t('nav.search')],
    ['/app/saved', t('nav.saved')],
  ];
  if (me.data.role === 'firm_admin') links.push(['/app/team', t('nav.team')]);
  if (me.data.role === 'owner') links.push(['/', t('nav.admin')]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('app.name')}</p>
            <p className="truncate text-xs text-slate-500">
              {me.data.firm?.name ?? t('role.owner')}
            </p>
          </div>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1">
            {links.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end
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
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              onClick={() => switchLanguage.mutate(locale === 'ar' ? 'en' : 'ar')}
            >
              {t('lang.switch')}
            </Button>
            <Button variant="ghost" onClick={() => void signOut()}>
              {t('nav.signOut')}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6">
        <Outlet context={me.data} />
      </main>
    </div>
  );
}
