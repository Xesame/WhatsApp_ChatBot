import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, type TestMessage } from '../api.ts';
import {
  Badge,
  Button,
  buttonClass,
  Card,
  ErrorNote,
  formatDate,
  Label,
  Loading,
  Note,
  PageTitle,
  Select,
  Table,
  td,
  type BadgeTone,
} from '../ui.tsx';

// "Test a message": paste a sample WhatsApp message and watch the normal
// pipeline read it. The logic is in @reb/admin (test-messages.ts); this page
// only sends the text and shows the status, asking again every 3 seconds
// until the message has been read.

const MAX_LENGTH = 20_000;
const POLL_MS = 3_000;

const POSTER: Record<string, string> = {
  developer: 'Developer',
  broker: 'Broker',
};

const isDone = (m: TestMessage | undefined) =>
  m !== undefined && (m.status === 'processed' || m.status === 'skipped' || m.status === 'failed');

/** The status in plain words, with a badge colour. */
function outcome(m: TestMessage): { text: string; tone: BadgeTone } {
  switch (m.status) {
    case 'pending':
      return { text: 'Waiting to be read', tone: 'neutral' };
    case 'processing':
      return { text: 'Being read…', tone: 'outline' };
    case 'processed':
      return {
        text: `Read: ${m.units.length} ${m.units.length === 1 ? 'listing' : 'listings'} made`,
        tone: 'lime',
      };
    case 'skipped':
      return { text: 'Skipped: no listing found', tone: 'warn' };
    case 'failed':
      return { text: `Failed: ${m.error ?? 'unknown reason'}`, tone: 'danger' };
  }
}

/** Links to each listing the message made, opened in Review. */
function UnitLinks({ message }: { message: TestMessage }) {
  if (message.units.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {message.units.map((unit) => (
        <li key={unit.id}>
          <Link to={`/review?unit=${unit.id}`} className={buttonClass('secondary', 'sm')}>
            #{unit.id} {unit.unitType ?? 'Listing'}
            {unit.needsReview && <Badge tone="warn">Needs review</Badge>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TestMessagePage() {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [posterType, setPosterType] = useState<'' | 'developer' | 'broker'>('');
  const [current, setCurrent] = useState<{ id: number; again: boolean } | null>(null);

  const recent = useQuery({
    queryKey: ['test-messages'],
    queryFn: () => api<TestMessage[]>('/api/admin/test-messages'),
    refetchInterval: (query) => (query.state.data?.some((m) => !isDone(m)) ? POLL_MS : false),
  });

  const shown = useQuery({
    queryKey: ['test-message', current?.id],
    queryFn: () => api<TestMessage>(`/api/admin/test-messages/${current?.id}`),
    enabled: current !== null,
    refetchInterval: (query) => (isDone(query.state.data) ? false : POLL_MS),
  });

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['test-messages'] });

  const read = useMutation({
    mutationFn: () =>
      api<{ messageId: number; again: boolean }>('/api/admin/test-messages', {
        method: 'POST',
        body: { text, posterType: posterType || null },
      }),
    onSuccess: async (result) => {
      setCurrent({ id: result.messageId, again: result.again });
      await queryClient.invalidateQueries({ queryKey: ['test-message', result.messageId] });
      await refreshList();
    },
  });

  const again = useMutation({
    mutationFn: (id: number) =>
      api(`/api/admin/test-messages/${id}/read-again`, { method: 'POST' }),
    onSuccess: async (_result, id) => {
      setCurrent({ id, again: true });
      await queryClient.invalidateQueries({ queryKey: ['test-message', id] });
      await refreshList();
    },
  });

  const message = shown.data;
  const status = message ? outcome(message) : null;

  return (
    <>
      <PageTitle
        title="Test a message"
        subtitle="Paste a WhatsApp message to see how the bot reads it. It goes through the same steps as a message from a watched group, in a group called “Test messages”. The listings it makes are real: reject them in Review if you don't want to keep them."
      />
      <div className="space-y-6">
        <Card>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) read.mutate();
            }}
          >
            <Label text="Message" hint="Arabic or English, up to 20,000 characters.">
              <textarea
                dir="auto"
                rows={10}
                maxLength={MAX_LENGTH}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the message here"
                className="w-full rounded-control border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted hover:border-muted/50 focus:border-graphite"
              />
            </Label>
            <div className="max-w-xs">
              <Label
                text="Who posted it"
                hint="Optional. Firms see it next to the listing's source messages."
              >
                <Select
                  value={posterType}
                  onChange={(e) => setPosterType(e.target.value as '' | 'developer' | 'broker')}
                >
                  <option value="">Not set</option>
                  <option value="developer">Developer</option>
                  <option value="broker">Broker</option>
                </Select>
              </Label>
            </div>
            <Button type="submit" disabled={read.isPending || !text.trim()}>
              {read.isPending ? 'Sending…' : 'Read this message'}
            </Button>
            <ErrorNote error={read.error} />
          </form>
        </Card>

        {current && (
          <Card title={`Message #${current.id}`}>
            {shown.isPending && <Loading />}
            <ErrorNote error={shown.error} />
            {message && status && (
              <div className="space-y-3">
                {current.again && (
                  <Note>This message was tested before, so it is being read again.</Note>
                )}
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={status.tone}>{status.text}</Badge>
                  {!isDone(message) && (
                    <span className="text-muted">Checking every 3 seconds…</span>
                  )}
                </p>
                <UnitLinks message={message} />
              </div>
            )}
          </Card>
        )}

        <Card title="Last 10 test messages">
          {recent.isPending && <Loading />}
          <ErrorNote error={recent.error ?? again.error} />
          {recent.data?.length === 0 && <p className="text-sm text-muted">No test messages yet.</p>}
          {recent.data && recent.data.length > 0 && (
            <Table head={['Message', 'Posted by', 'Status', 'Pasted', '']}>
              {recent.data.map((m) => {
                const o = outcome(m);
                return (
                  <tr key={m.id}>
                    <td className={`${td} max-w-md`}>
                      <p dir="auto" className="line-clamp-2 break-words">
                        {m.text}
                      </p>
                    </td>
                    <td className={td}>{m.posterType ? POSTER[m.posterType] : '—'}</td>
                    <td className={`${td} space-y-2`}>
                      <Badge tone={o.tone}>{o.text}</Badge>
                      <UnitLinks message={m} />
                    </td>
                    <td className={td}>{formatDate(m.pastedAt)}</td>
                    <td className={td}>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={again.isPending || !isDone(m)}
                        onClick={() => again.mutate(m.id)}
                      >
                        Read again
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
