import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type FailedJob } from '../api.ts';
import { Button, Card, ErrorNote, formatDate, Loading, PageTitle, Table, td } from '../ui.tsx';

const STEP: Record<string, string> = {
  preprocess: 'Prepare message',
  transcribe: 'Read image / PDF',
  classify: 'Is it a listing?',
  extract: 'Read listing details',
  lifecycle: 'Mark stale units',
};

export function Jobs() {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api<FailedJob[]>('/api/admin/jobs/failed'),
    refetchInterval: 30_000,
  });
  const retry = useMutation({
    mutationFn: (job: FailedJob) =>
      api(`/api/admin/jobs/${job.queue}/${job.id}/retry`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  return (
    <>
      <PageTitle
        title="Failed jobs"
        subtitle="Steps that failed after all automatic retries (for example, every AI provider was down). Fix the cause, then retry."
      />
      <Card>
        {jobs.isPending && <Loading />}
        <ErrorNote error={jobs.error ?? retry.error} />
        {jobs.data?.length === 0 && (
          <p className="text-sm text-slate-500">No failed jobs. Everything is flowing.</p>
        )}
        {jobs.data && jobs.data.length > 0 && (
          <Table head={['Step', 'Message', 'Error', 'Failed', 'Tries', '']}>
            {jobs.data.map((job) => (
              <tr key={job.id}>
                <td className={td}>{STEP[job.queue] ?? job.queue}</td>
                <td className={td}>
                  {(job.data as { messageId?: number } | null)?.messageId ?? '—'}
                </td>
                <td className={`${td} max-w-md break-words text-red-700 dark:text-red-400`}>
                  {job.error ?? '—'}
                </td>
                <td className={td}>{formatDate(job.failedAt)}</td>
                <td className={td}>{job.retries + 1}</td>
                <td className={td}>
                  <Button
                    variant="secondary"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(job)}
                  >
                    Retry
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
