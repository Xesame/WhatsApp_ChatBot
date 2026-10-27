import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { useDocumentLanguage, useI18n } from '../i18n.tsx';
import { Button, Card, ErrorNote, Input, Label, Loading } from '../ui.tsx';

interface LinkInfo {
  purpose: 'invite' | 'reset';
  name: string;
  email: string;
  firmName: string | null;
  locale: 'en' | 'ar';
}

/**
 * Opened from an invitation or reset link (`/set-password#<token>`). The
 * token is after `#`, so it never reaches a server log.
 */
export function SetPassword() {
  const i18n = useI18n();
  const { t, setLocale } = i18n;
  useDocumentLanguage(i18n.locale);
  const token = window.location.hash.slice(1);
  const info = useQuery({
    queryKey: ['link', token],
    queryFn: () => api<LinkInfo>('/api/links/info', { method: 'POST', body: { token } }),
    enabled: token.length > 0,
  });
  useEffect(() => {
    if (info.data) setLocale(info.data.locale);
  }, [info.data, setLocale]);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const redeem = useMutation({
    mutationFn: () => api('/api/links/redeem', { method: 'POST', body: { token, password } }),
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold">
          {info.data?.purpose === 'reset' ? t('password.reset') : t('password.title')}
        </h1>
        {info.isLoading && <Loading />}
        {(!token || info.isError) && (
          <div className="mt-3 space-y-3">
            <ErrorNote error={t('password.invalid')} />
            <Link to="/login" className="text-sm underline">
              {t('password.toLogin')}
            </Link>
          </div>
        )}
        {info.data && redeem.isSuccess && (
          <div className="mt-3 space-y-3">
            <p className="text-sm">{t('password.done')}</p>
            <Link
              to={`/login?email=${encodeURIComponent(info.data.email)}`}
              className="inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              {t('password.toLogin')}
            </Link>
          </div>
        )}
        {info.data && !redeem.isSuccess && (
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const issue =
                password.length < 10
                  ? t('password.short')
                  : password !== repeat
                    ? t('password.differ')
                    : null;
              setProblem(issue);
              if (!issue) redeem.mutate();
            }}
          >
            <p className="text-sm">
              {t('password.welcome', { name: info.data.name })}
              {info.data.firmName && <> {t('password.firm', { firm: info.data.firmName })}</>}
            </p>
            <p className="text-sm text-slate-500" dir="ltr">
              {info.data.email}
            </p>
            <input type="email" autoComplete="username" value={info.data.email} readOnly hidden />
            <Label text={t('password.new')}>
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Label>
            <Label text={t('password.repeat')}>
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </Label>
            <ErrorNote error={problem ?? (redeem.error ? t('password.invalid') : null)} />
            <Button type="submit" className="w-full" disabled={redeem.isPending}>
              {t('password.submit')}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
