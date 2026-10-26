import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, type Connection } from '../api.ts';
import { Badge, Card, ErrorNote, formatDate, Loading, PageTitle } from '../ui.tsx';

const STATES: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  open: { label: 'Connected', tone: 'green' },
  awaiting_pairing: { label: 'Waiting for pairing', tone: 'amber' },
  starting: { label: 'Starting', tone: 'gray' },
  reconnecting: { label: 'Reconnecting', tone: 'amber' },
  logged_out: { label: 'Logged out', tone: 'red' },
  stopped: { label: 'Stopped', tone: 'gray' },
};

export function WhatsApp() {
  // A QR code expires in about 20 seconds; poll often while one is shown.
  const connections = useQuery({
    queryKey: ['whatsapp'],
    queryFn: () => api<Connection[]>('/api/admin/whatsapp'),
    refetchInterval: (query) =>
      query.state.data?.some((c) => c.state !== 'open') ? 3_000 : 30_000,
  });

  return (
    <>
      <PageTitle
        title="WhatsApp"
        subtitle="The numbers this system uses. Pair the scraper number here."
      />
      {connections.isPending && <Loading />}
      <ErrorNote error={connections.error} />
      {connections.data?.length === 0 && (
        <Card>
          <p className="text-sm">
            No WhatsApp connection yet. Start the <code>capture</code> service; this page then shows
            the QR code to scan.
          </p>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {connections.data?.map((c) => {
          const state = STATES[c.state] ?? { label: c.state, tone: 'gray' as const };
          return (
            <Card
              key={c.account}
              title={<span className="capitalize">{c.account} number</span>}
              actions={<Badge tone={state.tone}>{state.label}</Badge>}
            >
              {c.qrSvg && (
                <div className="mb-4 space-y-3">
                  <img
                    alt="WhatsApp pairing QR code"
                    className="mx-auto w-64 rounded bg-white p-2"
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.qrSvg)}`}
                  />
                  <ol className="list-decimal space-y-1 pl-5 text-sm">
                    <li>On the scraper phone, open WhatsApp → Settings → Linked devices.</li>
                    <li>Tap “Link a device” and scan this code.</li>
                    <li>The code refreshes by itself; this page updates every few seconds.</li>
                  </ol>
                </div>
              )}
              {c.pairingCode && (
                <p className="mb-4 text-sm">
                  Pairing code:{' '}
                  <span className="font-mono text-lg font-semibold tracking-widest">
                    {c.pairingCode}
                  </span>
                  <br />
                  <span className="text-slate-500">
                    Enter it in WhatsApp → Linked devices → Link with phone number instead.
                  </span>
                </p>
              )}
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-slate-500">Last connected</dt>
                <dd>{formatDate(c.lastConnectedAt)}</dd>
                <dt className="text-slate-500">Last message</dt>
                <dd>{formatDate(c.lastMessageAt)}</dd>
                {c.lastDisconnectReason && (
                  <>
                    <dt className="text-slate-500">Last disconnect</dt>
                    <dd>
                      {formatDate(c.lastDisconnectedAt)} ({c.lastDisconnectReason})
                    </dd>
                  </>
                )}
              </dl>
              {c.state === 'open' && c.account === 'scraper' && (
                <p className="mt-3 text-sm">
                  Next:{' '}
                  <Link className="underline" to="/groups">
                    choose which groups to watch
                  </Link>
                  .
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
