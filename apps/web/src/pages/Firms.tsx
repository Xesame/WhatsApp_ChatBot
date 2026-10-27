import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type CreatedLink, type FirmSummary, type TeamMember, type UsageRow } from '../api.ts';
import { LinkBox } from '../firm/Team.tsx';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  formatDate,
  Input,
  Label,
  Loading,
  PageTitle,
  Select,
  Table,
  td,
} from '../ui.tsx';

/**
 * The owner's view of paying firms: create them, set plan, user limit and
 * contract dates, suspend, add their admins and agents, see their usage.
 */
export function Firms() {
  const queryClient = useQueryClient();
  const firms = useQuery({
    queryKey: ['firms'],
    queryFn: () => api<FirmSummary[]>('/api/admin/firms'),
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api<{ id: number }>('/api/admin/firms', { method: 'POST', body: { name } }),
    onSuccess: async ({ id }) => {
      setName('');
      await queryClient.invalidateQueries({ queryKey: ['firms'] });
      setSelected(id);
    },
  });
  const firm = firms.data?.find((f) => f.id === selected);

  return (
    <>
      <PageTitle
        title="Firms"
        subtitle="Brokerage firms with access to the listings. Only you can create them."
      />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <Card className="p-0">
            {firms.isPending && (
              <div className="p-4">
                <Loading />
              </div>
            )}
            <ErrorNote error={firms.error} />
            <Table
              head={['Firm', 'Plan', 'Users', 'Contract ends', 'Searches (30 d)', 'Exports (30 d)']}
            >
              {firms.data?.map((f) => (
                <tr
                  key={f.id}
                  className={
                    f.id === selected
                      ? 'bg-sky-50 dark:bg-sky-950/40'
                      : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }
                  onClick={() => setSelected(f.id)}
                >
                  <td className={td}>
                    <span className="font-medium">{f.name}</span>{' '}
                    {f.status === 'suspended' && <Badge tone="red">suspended</Badge>}
                  </td>
                  <td className={td}>{f.plan}</td>
                  <td className={`${td} tabular-nums`}>
                    {f.activeUsers} / {f.maxUsers}
                  </td>
                  <td className={td}>{f.contractEnd ?? '—'}</td>
                  <td className={`${td} tabular-nums`}>{f.searches30d}</td>
                  <td className={`${td} tabular-nums`}>{f.exports30d}</td>
                </tr>
              ))}
            </Table>
            {firms.data?.length === 0 && (
              <p className="p-4 text-sm text-slate-500">No firms yet. Add the first one.</p>
            )}
          </Card>
          <Card title="Add a firm">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Input
                required
                placeholder="Firm name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" disabled={create.isPending}>
                Create
              </Button>
            </form>
            <div className="mt-2">
              <ErrorNote error={create.error} />
            </div>
          </Card>
        </div>
        <div className="xl:col-span-2">
          {firm ? (
            <FirmPanel key={firm.id} firm={firm} />
          ) : (
            <Card>
              <p className="text-sm text-slate-500">Choose a firm to manage it.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function FirmPanel({ firm }: { firm: FirmSummary }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    plan: firm.plan,
    maxUsers: String(firm.maxUsers),
    contractStart: firm.contractStart ?? '',
    contractEnd: firm.contractEnd ?? '',
    notes: firm.notes ?? '',
  });
  const [invite, setInvite] = useState({ name: '', email: '', role: 'firm_admin', locale: 'ar' });
  const [shown, setShown] = useState<{ name: string; link: CreatedLink } | null>(null);
  const team = useQuery({
    queryKey: ['firm-team', firm.id],
    queryFn: () => api<TeamMember[]>(`/api/admin/firms/${firm.id}/team`),
  });
  const usage = useQuery({
    queryKey: ['firm-usage', firm.id],
    queryFn: () => api<UsageRow[]>(`/api/admin/firms/${firm.id}/usage?days=30`),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['firms'] });
    await queryClient.invalidateQueries({ queryKey: ['firm-team', firm.id] });
  };
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/admin/firms/${firm.id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  });
  const add = useMutation({
    mutationFn: () =>
      api<CreatedLink>(`/api/admin/firms/${firm.id}/invitations`, { method: 'POST', body: invite }),
    onSuccess: async (link) => {
      setShown({ name: invite.name, link });
      setInvite({ ...invite, name: '', email: '' });
      await refresh();
    },
  });
  const newLink = useMutation({
    mutationFn: (m: TeamMember) =>
      api<CreatedLink>(`/api/admin/users/${m.id}/link`, { method: 'POST' }),
    onSuccess: (link, m) => setShown({ name: m.name, link }),
  });
  const setRemoved = useMutation({
    mutationFn: ({ id, removed }: { id: string; removed: boolean }) =>
      api(`/api/admin/users/${id}`, { method: 'PATCH', body: { removed } }),
    onSuccess: refresh,
  });
  const totals = (usage.data ?? []).reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + r.count }),
    {},
  );

  return (
    <div className="space-y-4">
      <Card
        title={firm.name}
        actions={
          firm.status === 'active' ? (
            <Button variant="danger" onClick={() => save.mutate({ status: 'suspended' })}>
              Suspend
            </Button>
          ) : (
            <Button onClick={() => save.mutate({ status: 'active' })}>Reactivate</Button>
          )
        }
      >
        {firm.status === 'suspended' && (
          <p className="mb-3 text-sm text-red-700 dark:text-red-400">
            Suspended: its users can't sign in.
          </p>
        )}
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              plan: form.plan,
              maxUsers: Number(form.maxUsers),
              contractStart: form.contractStart || null,
              contractEnd: form.contractEnd || null,
              notes: form.notes || null,
            });
          }}
        >
          <Label text="Plan">
            <Input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
          </Label>
          <Label text="User limit">
            <Input
              type="number"
              min={1}
              max={1000}
              value={form.maxUsers}
              onChange={(e) => setForm({ ...form, maxUsers: e.target.value })}
            />
          </Label>
          <Label text="Contract start">
            <Input
              type="date"
              value={form.contractStart}
              onChange={(e) => setForm({ ...form, contractStart: e.target.value })}
            />
          </Label>
          <Label text="Contract end" hint="After this date its users can't sign in.">
            <Input
              type="date"
              value={form.contractEnd}
              onChange={(e) => setForm({ ...form, contractEnd: e.target.value })}
            />
          </Label>
          <div className="col-span-2">
            <Label text="Notes (only you see these)">
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Label>
          </div>
          <div className="col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isSuccess ? 'Saved' : 'Save'}
            </Button>
            <span className="text-xs text-slate-500">Created {formatDate(firm.createdAt)}</span>
          </div>
        </form>
        <div className="mt-2">
          <ErrorNote error={save.error} />
        </div>
      </Card>

      {shown && <LinkBox name={shown.name} link={shown.link} onDone={() => setShown(null)} />}

      <Card title={`People (${firm.activeUsers} of ${firm.maxUsers})`}>
        <ErrorNote error={team.error ?? newLink.error ?? setRemoved.error} />
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {team.data?.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className={m.status === 'removed' ? 'text-slate-400' : ''}>
                  {m.name}{' '}
                  <span className="text-xs text-slate-500">
                    {m.role === 'firm_admin' ? 'firm admin' : 'agent'}
                  </span>
                </p>
                <p className="truncate text-xs text-slate-500">{m.email}</p>
              </div>
              <Badge
                tone={m.status === 'active' ? 'green' : m.status === 'invited' ? 'amber' : 'gray'}
              >
                {m.status}
              </Badge>
              {m.status !== 'removed' && (
                <Button variant="ghost" onClick={() => newLink.mutate(m)}>
                  New link
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => setRemoved.mutate({ id: m.id, removed: m.status !== 'removed' })}
              >
                {m.status === 'removed' ? 'Restore' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input
            required
            placeholder="Name"
            value={invite.name}
            onChange={(e) => setInvite({ ...invite, name: e.target.value })}
          />
          <Input
            required
            type="email"
            placeholder="E-mail"
            value={invite.email}
            onChange={(e) => setInvite({ ...invite, email: e.target.value })}
          />
          <Select
            value={invite.role}
            onChange={(e) => setInvite({ ...invite, role: e.target.value })}
          >
            <option value="firm_admin">Firm admin</option>
            <option value="agent">Agent</option>
          </Select>
          <Select
            value={invite.locale}
            onChange={(e) => setInvite({ ...invite, locale: e.target.value })}
          >
            <option value="ar">Arabic</option>
            <option value="en">English</option>
          </Select>
          <Button
            type="submit"
            className="col-span-2"
            disabled={add.isPending || firm.status !== 'active'}
          >
            Add and get invitation link
          </Button>
        </form>
        <div className="mt-2">
          <ErrorNote error={add.error} />
        </div>
      </Card>

      <Card title="Usage, last 30 days">
        <dl className="grid grid-cols-3 gap-2 text-center text-sm">
          {(['search', 'export', 'listing_view'] as const).map((kind) => (
            <div key={kind}>
              <dt className="text-xs text-slate-500">
                {kind === 'listing_view'
                  ? 'Listings opened'
                  : kind === 'search'
                    ? 'Searches'
                    : 'Exports'}
              </dt>
              <dd className="text-lg font-semibold tabular-nums">{totals[kind] ?? 0}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
