import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Group } from '../api.ts';
import {
  Badge,
  Card,
  ErrorNote,
  formatDate,
  Input,
  Loading,
  PageTitle,
  Select,
  Table,
  td,
} from '../ui.tsx';

export function Groups() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [onlyWatched, setOnlyWatched] = useState(false);
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<Group[]>('/api/admin/groups'),
  });
  const update = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      watched?: boolean;
      sourceType?: Group['sourceType'];
    }) => api<Group>(`/api/admin/groups/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['groups'] }),
  });

  const rows = (groups.data ?? []).filter(
    (g) =>
      (!onlyWatched || g.watched) &&
      (g.name ?? '').toLowerCase().includes(search.trim().toLowerCase()),
  );
  const watchedCount = groups.data?.filter((g) => g.watched).length ?? 0;

  return (
    <>
      <PageTitle
        title="Groups"
        subtitle="Only watched groups are read. New groups start unwatched. Changes apply within 30 seconds."
      />
      <Card
        title={`${watchedCount} of ${groups.data?.length ?? 0} watched`}
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={onlyWatched}
                onChange={(e) => setOnlyWatched(e.target.checked)}
              />
              Watched only
            </label>
            <Input
              placeholder="Search groups"
              className="w-48"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      >
        <ErrorNote error={groups.error ?? update.error} />
        {groups.isPending && <Loading />}
        <Table head={['Watch', 'Group', 'Posted by', 'Messages saved', 'Last message']}>
          {rows.map((g) => (
            <tr key={g.id} className={g.watched ? '' : 'text-slate-500'}>
              <td className={td}>
                <input
                  type="checkbox"
                  aria-label={`Watch ${g.name ?? 'group'}`}
                  className="h-4 w-4"
                  checked={g.watched}
                  disabled={update.isPending}
                  onChange={(e) => update.mutate({ id: g.id, watched: e.target.checked })}
                />
              </td>
              <td className={td} dir="auto">
                {g.name ?? <span className="italic">Unnamed group</span>}{' '}
                {!g.isMember && <Badge tone="red">left</Badge>}
              </td>
              <td className={td}>
                <Select
                  className="w-32"
                  value={g.sourceType ?? ''}
                  onChange={(e) =>
                    update.mutate({
                      id: g.id,
                      sourceType: (e.target.value || null) as Group['sourceType'],
                    })
                  }
                >
                  <option value="">Not set</option>
                  <option value="developer">Developer</option>
                  <option value="broker">Brokers</option>
                </Select>
              </td>
              <td className={td}>{g.messages.toLocaleString()}</td>
              <td className={td}>{formatDate(g.lastMessageAt)}</td>
            </tr>
          ))}
        </Table>
        {groups.data?.length === 0 && (
          <p className="py-4 text-sm text-slate-500">
            No groups yet. They appear once the scraper number is paired.
          </p>
        )}
      </Card>
    </>
  );
}
