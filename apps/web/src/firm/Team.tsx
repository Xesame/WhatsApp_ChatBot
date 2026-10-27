import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type CreatedLink, type TeamMember, type UsageRow } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Input,
  Label,
  Loading,
  Select,
  Table,
  td,
} from '../ui.tsx';

/** A link to hand over, with a copy button. */
export function LinkBox({
  name,
  link,
  onDone,
}: {
  name: string;
  link: CreatedLink;
  onDone: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
      <p>{t('team.linkReady', { name, date: i18n.date(link.expiresAt) })}</p>
      <div className="flex gap-2">
        <Input readOnly dir="ltr" value={link.link} onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(link.link).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.close')}
        </Button>
      </div>
    </div>
  );
}

/** Firm admins: the firm's people, adding agents, links, removing; usage. */
export function Team() {
  const i18n = useI18n();
  const { t } = i18n;
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: ['team'], queryFn: () => api<TeamMember[]>('/api/app/team') });
  const usage = useQuery({
    queryKey: ['usage'],
    queryFn: () => api<UsageRow[]>('/api/app/usage?days=30'),
  });
  const [form, setForm] = useState({ name: '', email: '', locale: i18n.locale });
  const [shown, setShown] = useState<{ name: string; link: CreatedLink } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['team'] });

  const invite = useMutation({
    mutationFn: () => api<CreatedLink>('/api/app/team', { method: 'POST', body: form }),
    onSuccess: async (link) => {
      setShown({ name: form.name, link });
      setForm({ name: '', email: '', locale: i18n.locale });
      await refresh();
    },
  });
  const newLink = useMutation({
    mutationFn: (m: TeamMember) =>
      api<CreatedLink>(`/api/app/team/${m.id}/link`, { method: 'POST' }),
    onSuccess: (link, m) => setShown({ name: m.name, link }),
  });
  const setRemoved = useMutation({
    mutationFn: ({ id, removed }: { id: string; removed: boolean }) =>
      api(`/api/app/team/${id}`, { method: 'PATCH', body: { removed } }),
    onSuccess: refresh,
  });
  const [confirming, setConfirming] = useState<string | null>(null);
  const totals = (usage.data ?? []).reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + r.count }),
    {},
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('team.title')}</h1>
      {shown && <LinkBox name={shown.name} link={shown.link} onDone={() => setShown(null)} />}
      <ErrorNote error={team.error ?? invite.error ?? newLink.error ?? setRemoved.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-0 lg:col-span-2">
          {team.isPending && (
            <div className="p-4">
              <Loading />
            </div>
          )}
          <Table head={[t('team.name'), t('team.email'), '', '', '']}>
            {team.data?.map((m) => (
              <tr key={m.id} className={m.status === 'removed' ? 'text-slate-400' : ''}>
                <td className={td}>
                  {m.name}
                  <div className="text-xs text-slate-500">{t(`role.${m.role as 'agent'}`)}</div>
                </td>
                <td className={td} dir="ltr">
                  {m.email}
                </td>
                <td className={td}>
                  <Badge
                    tone={
                      m.status === 'active' ? 'green' : m.status === 'invited' ? 'amber' : 'gray'
                    }
                  >
                    {t(`memberStatus.${m.status}`)}
                  </Badge>
                </td>
                <td className={td}>
                  {m.status !== 'removed' && (
                    <Button variant="ghost" onClick={() => newLink.mutate(m)}>
                      {t('team.newLink')}
                    </Button>
                  )}
                </td>
                <td className={td}>
                  {m.role === 'agent' &&
                    (m.status === 'removed' ? (
                      <Button
                        variant="ghost"
                        onClick={() => setRemoved.mutate({ id: m.id, removed: false })}
                      >
                        {t('team.restore')}
                      </Button>
                    ) : confirming === m.id ? (
                      <span className="flex gap-1">
                        <Button
                          variant="danger"
                          onClick={() => {
                            setRemoved.mutate({ id: m.id, removed: true });
                            setConfirming(null);
                          }}
                        >
                          {t('team.remove')}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirming(null)}>
                          {t('common.cancel')}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        className="text-red-600"
                        title={t('team.confirmRemove', { name: m.name })}
                        onClick={() => setConfirming(m.id)}
                      >
                        {t('team.remove')}
                      </Button>
                    ))}
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <div className="space-y-4">
          <Card title={t('team.invite')}>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                invite.mutate();
              }}
            >
              <Label text={t('team.name')}>
                <Input
                  required
                  dir="auto"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Label>
              <Label text={t('team.email')}>
                <Input
                  required
                  type="email"
                  dir="ltr"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Label>
              <Label text={t('team.language')}>
                <Select
                  value={form.locale}
                  onChange={(e) => setForm({ ...form, locale: e.target.value as 'en' | 'ar' })}
                >
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </Select>
              </Label>
              <Button type="submit" disabled={invite.isPending}>
                {t('team.add')}
              </Button>
            </form>
          </Card>
          <Card title={t('team.usage')}>
            <dl className="space-y-1.5 text-sm">
              {(['search', 'export', 'listing_view'] as const).map((kind) => (
                <div key={kind} className="flex justify-between">
                  <dt className="text-slate-500">{t(`usage.${kind}`)}</dt>
                  <dd className="font-medium tabular-nums">{i18n.number(totals[kind] ?? 0)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
