import { useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, ApiError, type Me } from '../api.ts';
import { useDocumentLanguage, useI18n } from '../i18n.tsx';
import { Button, Card, ErrorNote, Input, Label } from '../ui.tsx';

/** One sign-in page for the owner and firm users, in English or Arabic. */
export function Login() {
  const i18n = useI18n();
  const { t, locale, setLocale } = i18n;
  useDocumentLanguage(locale);
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
      queryClient.clear();
      const me = await api<Me>('/api/app/me');
      await navigate(me.role === 'owner' ? '/' : '/app');
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? t('login.tooMany')
          : e instanceof ApiError && e.status === 401
            ? t('login.wrong')
            : e instanceof ApiError && e.status === 403
              ? t('login.blocked')
              : t('common.error'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">{t('app.name')}</h1>
            <p className="text-sm text-slate-500">{t('login.subtitle')}</p>
          </div>
          <Button variant="ghost" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
            {t('lang.switch')}
          </Button>
        </div>
        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          <Label text={t('login.email')}>
            <Input
              type="email"
              dir="ltr"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Label>
          <Label text={t('login.password')}>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Label>
          <ErrorNote error={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? t('login.busy') : t('login.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
