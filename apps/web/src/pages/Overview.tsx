import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, type Stats } from '../api.ts';
import { Card, ErrorNote, Loading, PageTitle, Stat, Table, td } from '../ui.tsx';

const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

/** A small horizontal bar with the number beside it. `muted` is for older weeks. */
function Bar({ rate, muted }: { rate: number | null; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 shrink-0 rounded-full bg-line">
        <div
          className={muted ? 'h-2 rounded-full bg-muted/50' : 'h-2 rounded-full bg-graphite'}
          style={{ width: `${Math.round((rate ?? 0) * 100)}%` }}
        />
      </div>
      <span className="figure w-10 text-sm">{percent(rate)}</span>
    </div>
  );
}

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
  const weeks = [...s.weeks].reverse();
  const thisWeek = weeks[0];
  const rightThisWeek =
    thisWeek && thisWeek.reviewed > 0 ? thisWeek.rightFirstTime / thisWeek.reviewed : null;

  return (
    <>
      <PageTitle title="Overview" subtitle="The last 14 days" />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {s.needsReview > 0 ? (
          <Link to="/review" className="block rounded-banner">
            <Stat value={s.needsReview.toLocaleString()} label="Waiting for review" tone="lime" />
          </Link>
        ) : (
          <Stat value="0" label="Waiting for review" />
        )}
        <Stat value={(s.units.active ?? 0).toLocaleString()} label="Active listings" />
        <Stat value={percent(rightThisWeek)} label="Right first time this week" />
      </div>

      <Card title="Is the bot learning?" className="mb-4 p-0">
        <div className="px-5 pb-1">
          <p className="text-sm text-muted">
            If the bot is learning, the share flagged on arrival and the fixes per listing go down
            over the weeks, and the share right first time goes up.
          </p>
        </div>
        <Table
          head={[
            'Week starting Monday',
            'New listings',
            'Flagged on arrival',
            'Reviewed',
            'Right first time',
            'Fixes per listing',
          ]}
        >
          {weeks.map((w, i) => (
            <tr key={w.week}>
              <td className={td}>{w.week}</td>
              <td className={`${td} figure`}>{w.newUnits}</td>
              <td className={td}>
                <Bar rate={w.newUnits > 0 ? w.flaggedOnArrival / w.newUnits : null} muted={i > 0} />
              </td>
              <td className={`${td} figure`}>{w.reviewed}</td>
              <td className={td}>
                <Bar rate={w.reviewed > 0 ? w.rightFirstTime / w.reviewed : null} muted={i > 0} />
              </td>
              <td className={`${td} figure`}>
                {w.correctionsPerReviewed === null ? '—' : w.correctionsPerReviewed.toFixed(1)}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Per day" className="p-0 lg:col-span-2">
          <p className="px-5 pb-3 text-sm text-muted">
            {totals.messages.toLocaleString()} messages saved, {totals.failed} failed, AI cost $
            {totals.cost.toFixed(2)} from {totals.calls.toLocaleString()} model calls. Read
            successfully: {percent(s.extractionSuccessRate)}.
          </p>
          <Table
            head={['Day', 'Messages', '', 'Processed', 'Skipped', 'Failed', 'Model calls', 'Cost']}
          >
            {[...s.days].reverse().map((d) => (
              <tr key={d.day}>
                <td className={td}>{d.day}</td>
                <td className={`${td} figure`}>{d.messages}</td>
                <td className={`${td} w-32`}>
                  <div className="h-2 rounded-full bg-line">
                    <div
                      className="h-2 rounded-full bg-graphite"
                      style={{ width: `${(d.messages / peak) * 100}%` }}
                    />
                  </div>
                </td>
                <td className={td}>{d.processed}</td>
                <td className={td}>{d.skipped}</td>
                <td className={td}>
                  {d.failed > 0 ? <span className="font-bold text-danger-ink">{d.failed}</span> : 0}
                </td>
                <td className={td}>{d.modelCalls}</td>
                <td className={td}>${d.costUsd.toFixed(3)}</td>
              </tr>
            ))}
          </Table>
          {s.days.length === 0 && (
            <p className="px-5 py-4 text-sm text-muted">
              No messages yet. Pair the number and choose groups to watch.
            </p>
          )}
        </Card>
        <Card title="Listings by status">
          <dl className="space-y-2 text-sm">
            {['active', 'stale', 'sold', 'withdrawn'].map((status) => (
              <div key={status} className="flex justify-between">
                <dt className="capitalize text-muted">{status}</dt>
                <dd className="figure">{(s.units[status] ?? 0).toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
