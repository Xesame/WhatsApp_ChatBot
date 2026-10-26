import { useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api.ts';
import { Button, Card, ErrorNote, Input, Label } from '../ui.tsx';

export function Login() {
  const [email, setEmail] = useState('');
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
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await navigate('/');
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : e instanceof ApiError && e.status === 401
            ? 'Wrong e-mail or password.'
            : e instanceof Error
              ? e.message
              : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold">Real Estate Bot</h1>
        <p className="mb-4 text-sm text-slate-500">Sign in to the admin console</p>
        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          <Label text="E-mail">
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Label>
          <Label text="Password">
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
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
