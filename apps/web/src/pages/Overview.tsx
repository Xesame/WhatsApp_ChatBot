import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, type Stats } from '../api.ts';
import { Card, ErrorNote, Loading, PageTitle, Table, td } from '../ui.tsx';

const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

export function Overview() {
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/api/admin/stats?days=14'),
    refetchInterval: 60_000,
  });
  if (stats.isPending) return <Loading />;
  if (stats.error) return <ErrorNote error={stats.error} />;
  const s = stats.data;
  const totals = s.days.reduce(
    (t, d) => ({
      messages: t.messages + d.messages,
      calls: t.calls + d.modelCalls,
      cost: t.cost + d.costUsd,
      failed: t.failed + d.failed,
    }),
    { messages: 0, calls: 0, cost: 0, failed: 0 },
  );
  const peak = Math.max(1, ...s.days.map((d) => d.messages));

  return (
    <>
      <PageTitle title="Overview" subtitle="The last 14 days" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Messages saved" value={totals.messages.toLocaleString()} />
        <Tile
          label="Read successfully"
          value={percent(s.extractionSuccessRate)}
          hint={`${totals.failed} failed`}
        />
        <Tile
          label="Waiting for review"
          value={s.needsReview.toLocaleString()}
          hint={`${percent(s.needsReviewRate)} of active units`}
          link={s.needsReview > 0 ? '/review' : undefined}
        />
        <Tile
          label="AI cost"
          value={`$${totals.cost.toFixed(2)}`}
          hint={`${totals.calls.toLocaleString()} model calls`}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Per day" className="lg:col-span-2">
          <Table
            head={['Day', 'Messages', '', 'Processed', 'Skipped', 'Failed', 'Model calls', 'Cost']}
          >
            {[...s.days].reverse().map((d) => (
              <tr key={d.day}>
                <td className={td}>{d.day}</td>
                <td className={td}>{d.messages}</td>
                <td className={`${td} w-32`}>
                  <div className="h-2 rounded bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-2 rounded bg-sky-500"
                      style={{ width: `${(d.messages / peak) * 100}%` }}
                    />
                  </div>
                </td>
                <td className={td}>{d.processed}</td>
                <td className={td}>{d.skipped}</td>
                <td className={td}>
                  {d.failed > 0 ? <span className="text-red-600">{d.failed}</span> : 0}
                </td>
                <td className={td}>{d.modelCalls}</td>
                <td className={td}>${d.costUsd.toFixed(3)}</td>
              </tr>
            ))}
          </Table>
          {s.days.length === 0 && (
            <p className="py-4 text-sm text-slate-500">
              No messages yet. Pair the number and choose groups to watch.
            </p>
          )}
        </Card>
        <Card title="Units by status">
          <dl className="space-y-2 text-sm">
            {['active', 'stale', 'sold', 'withdrawn'].map((status) => (
              <div key={status} className="flex justify-between">
                <dt className="capitalize text-slate-600 dark:text-slate-400">{status}</dt>
                <dd className="font-medium">{(s.units[status] ?? 0).toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  link,
}: {
  label: string;
  value: string;
  hint?: string;
  link?: string | undefined;
}) {
  const body = (
    <Card className={link ? 'transition hover:border-slate-400' : ''}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
  return link ? <Link to={link}>{body}</Link> : body;
}
