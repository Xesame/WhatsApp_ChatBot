import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Settings as SettingsData } from '../api.ts';
import { Button, buttonClass, Card, ErrorNote, Input, Label, Loading, PageTitle } from '../ui.tsx';

export function Settings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsData>('/api/admin/settings'),
  });
  const [rate, setRate] = useState('');
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (settings.data?.usdEgpRate) setRate(String(settings.data.usdEgpRate));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () =>
      api('/api/admin/settings/usd-egp-rate', { method: 'PUT', body: { value: Number(rate) } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
  const effective = settings.data?.usdEgpRate ?? settings.data?.usdEgpRateFallback;

  return (
    <>
      <PageTitle title="Settings & export" />
      {settings.isPending && <Loading />}
      <ErrorNote error={settings.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Dollar rate">
          <p className="mb-3 text-sm text-muted">
            EGP is the main currency. Units priced in dollars are converted at this rate in exports,
            and marked as converted.
          </p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Label text="EGP per 1 USD">
              <Input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-40"
              />
            </Label>
            <Button type="submit" disabled={save.isPending}>
              {save.isSuccess ? 'Saved' : 'Save rate'}
            </Button>
          </form>
          {!settings.data?.usdEgpRate && settings.data?.usdEgpRateFallback && (
            <p className="mt-2 text-xs text-muted">
              Using {settings.data.usdEgpRateFallback} from the server settings until you save one
              here.
            </p>
          )}
          <div className="mt-2">
            <ErrorNote error={save.error} />
          </div>
        </Card>
        <Card title="Export to Excel">
          <p className="mb-3 text-sm text-muted">
            Downloads units in the Primary Units template (26 columns), ready to use.
          </p>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-graphite"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            Include sold, stale and withdrawn units
          </label>
          <a href={`/api/admin/export.xlsx?all=${all}`} className={buttonClass()}>
            Download Excel file
          </a>
          {!effective && (
            <p className="mt-2 text-xs text-warn-ink">
              Set the dollar rate first if any unit is priced in USD.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
