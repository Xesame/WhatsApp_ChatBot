import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { useDocumentLanguage, useI18n } from '../i18n.tsx';
import { AuthLayout, Button, buttonClass, ErrorNote, Input, Label, Loading, Note } from '../ui.tsx';

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
    <AuthLayout name={t('app.name')} tagline={t('login.subtitle')}>
      <h1 className="mb-6 text-xl font-extrabold">
        {info.data?.purpose === 'reset' ? t('password.reset') : t('password.title')}
      </h1>
      {info.isLoading && <Loading />}
      {(!token || info.isError) && (
        <div className="space-y-4">
          <ErrorNote error={t('password.invalid')} />
          <Link
            to="/login"
            className="text-sm font-bold text-graphite underline underline-offset-4"
          >
            {t('password.toLogin')}
          </Link>
        </div>
      )}
      {info.data && redeem.isSuccess && (
        <div className="space-y-4">
          <Note tone="success">{t('password.done')}</Note>
          <Link
            to={`/login?email=${encodeURIComponent(info.data.email)}`}
            className={buttonClass('primary', 'lg')}
          >
            {t('password.toLogin')}
          </Link>
        </div>
      )}
      {info.data && !redeem.isSuccess && (
        <form
          className="space-y-4"
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
          <p className="text-sm text-muted" dir="ltr">
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
          <Button type="submit" size="lg" className="w-full" disabled={redeem.isPending}>
            {t('password.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
