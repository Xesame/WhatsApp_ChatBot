import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { api, ApiError, type Me } from '../api.ts';
import { useDocumentLanguage, useI18n } from '../i18n.tsx';
import { Button, cx, ErrorNote, Loading, Wordmark } from '../ui.tsx';

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
      <TopBar
        firmName={me.data.firm?.name ?? t('role.owner')}
        links={links}
        onLanguage={() => switchLanguage.mutate(locale === 'ar' ? 'en' : 'ar')}
        onSignOut={() => void signOut()}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6">
        <Outlet context={me.data} />
      </main>
    </div>
  );
}

/**
 * The graphite bar: product name, firm, the pages, the language switch and
 * sign out. On phones the pages, language and sign out fold into a menu.
 */
function TopBar({
  firmName,
  links,
  onLanguage,
  onSignOut,
}: {
  firmName: string;
  links: [string, string][];
  onLanguage: () => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cx(
      'whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-bold',
      isActive ? 'bg-graphite-2 text-lime' : 'text-bone hover:bg-graphite-2',
    );
  return (
    <header className="on-graphite sticky top-0 z-20 bg-graphite text-bone">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <Wordmark name={t('app.name')} className="shrink-0 text-base" />
          <span className="hidden truncate text-sm text-bone/70 sm:block">{firmName}</span>
        </div>
        <nav className="hidden flex-1 gap-1 md:flex" aria-label={t('nav.menu')}>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end className={linkClass}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ms-auto hidden items-center gap-1 md:flex">
          <Button variant="inverse" onClick={onLanguage}>
            {t('lang.switch')}
          </Button>
          <Button variant="inverse" onClick={onSignOut}>
            {t('nav.signOut')}
          </Button>
        </div>
        <Button
          variant="inverse"
          className="ms-auto md:hidden"
          aria-expanded={open}
          aria-controls="phone-menu"
          onClick={() => setOpen(!open)}
        >
          {t('nav.menu')}
        </Button>
      </div>
      {open && (
        <div id="phone-menu" className="border-t border-graphite-2 px-4 pb-3 md:hidden">
          <p className="py-2 text-sm text-bone/70">{firmName}</p>
          <nav className="flex flex-col gap-1">
            {links.map(([to, label]) => (
              <NavLink key={to} to={to} end className={linkClass} onClick={() => setOpen(false)}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-2 flex gap-1 border-t border-graphite-2 pt-2">
            <Button variant="inverse" onClick={onLanguage}>
              {t('lang.switch')}
            </Button>
            <Button variant="inverse" onClick={onSignOut}>
              {t('nav.signOut')}
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
