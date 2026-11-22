import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { filtersFromQuery, filtersToQuery, SORTS, type SearchFilters } from '@reb/search/filters';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type FilterOptions, type SearchItem, type SearchPage } from '../api.ts';
import { useI18n, type I18n } from '../i18n.tsx';
import {
  Badge,
  buttonClass,
  Button,
  Card,
  cx,
  ErrorNote,
  Input,
  Label,
  Loading,
  Select,
  Table,
  td,
} from '../ui.tsx';
import { Filters } from './Filters.tsx';
import { areaText, deliveryText, paymentText, priceText } from './format.ts';

const PAGE_SIZE = 25;

function readFilters(params: URLSearchParams): SearchFilters {
  try {
    return filtersFromQuery(Object.fromEntries(params));
  } catch {
    return {}; // a hand-edited address with a bad value starts over
  }
}

/** The firm dashboard's main page: filters, results as a table or cards, export, save. */
export function Search() {
  const i18n = useI18n();
  const { t } = i18n;
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const query = filtersToQuery(filters);
  const [view, setView] = useState<'table' | 'cards'>(() =>
    window.innerWidth < 768 ? 'cards' : 'table',
  );
  const [showFilters, setShowFilters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState(filters.q ?? '');
  useEffect(() => setText(filters.q ?? ''), [filters.q]);

  const options = useQuery({
    queryKey: ['options'],
    queryFn: () => api<FilterOptions>('/api/app/options'),
    staleTime: 5 * 60_000,
  });
  const results = useQuery({
    queryKey: ['listings', query, page],
    queryFn: () =>
      api<SearchPage>(
        `/api/app/listings?${query}${query ? '&' : ''}page=${page}&pageSize=${PAGE_SIZE}`,
      ),
    placeholderData: keepPreviousData,
  });

  const apply = (next: SearchFilters) => setParams(new URLSearchParams(filtersToQuery(next)));
  const setPage = (p: number) => {
    const next = new URLSearchParams(query);
    if (p > 1) next.set('page', String(p));
    setParams(next);
    window.scrollTo({ top: 0 });
  };
  const submitText = () => {
    const q = text.trim();
    const next = { ...filters };
    if (q) next.q = q;
    else delete next.q;
    apply(next);
  };
  const total = results.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const closeDrawer = () => setShowFilters(false);
  useEffect(() => {
    if (!showFilters) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowFilters(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showFilters]);
  const activeCount = Object.keys(filters).filter((k) => k !== 'sort' && k !== 'q').length;
  const setQuick = (key: 'cityIds' | 'bedroomsMin', value: string) => {
    const rest = Object.fromEntries(
      Object.entries(filters).filter(([k]) => k !== key),
    ) as SearchFilters;
    if (value === '') {
      apply(rest);
      return;
    }
    apply(
      key === 'cityIds'
        ? { ...rest, cityIds: [Number(value)] }
        : { ...rest, bedroomsMin: Number(value) },
    );
  };
  const filterPanel = <Filters filters={filters} options={options.data} onChange={apply} />;

  return (
    <div className="space-y-6">
      <section className="on-graphite rounded-banner bg-graphite px-5 py-6 text-bone md:px-8 md:py-8">
        <h1 className="max-w-2xl text-xl font-extrabold text-bone md:text-2xl">
          {t('search.headline')}
        </h1>
        <form
          className="mt-5 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            submitText();
          }}
        >
          <Label text={t('search.title')}>
            <Input
              type="search"
              dir="auto"
              placeholder={t('search.placeholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={submitText}
            />
          </Label>
          <Label text={t('filter.city')}>
            <Select
              value={filters.cityIds?.length === 1 ? String(filters.cityIds[0]) : ''}
              onChange={(e) => setQuick('cityIds', e.target.value)}
            >
              <option value="">{t('common.any')}</option>
              {(options.data?.cities ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {i18n.name(c)}
                </option>
              ))}
            </Select>
          </Label>
          <Label text={t('filter.bedrooms')}>
            <Select
              value={filters.bedroomsMin ?? ''}
              onChange={(e) => setQuick('bedroomsMin', e.target.value)}
            >
              <option value="">{t('common.any')}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </Select>
          </Label>
          <Button type="submit" size="lg" className="w-full md:w-auto">
            {t('nav.search')}
          </Button>
        </form>
      </section>

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <Card>{filterPanel}</Card>
        </aside>

        {showFilters && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label={t('common.close')}
              className="absolute inset-0 bg-graphite/60"
              onClick={closeDrawer}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t('search.filters')}
              className="absolute inset-y-0 start-0 flex w-[min(22rem,92vw)] flex-col bg-paper shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-base font-bold">{t('search.filters')}</h2>
                <Button variant="quiet" size="sm" onClick={closeDrawer}>
                  {t('common.close')}
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">{filterPanel}</div>
              <div className="border-t border-line p-4">
                <Button size="lg" className="w-full" onClick={closeDrawer}>
                  {t('search.showResults', { n: i18n.number(total) })}
                </Button>
              </div>
            </div>
          </div>
        )}

        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="lg:hidden" onClick={() => setShowFilters(true)}>
              {t('search.filters')}
              {activeCount > 0 && ` (${i18n.number(activeCount)})`}
            </Button>
            <p className="text-sm font-bold">
              {results.data
                ? total === 1
                  ? t('search.oneResult')
                  : t('search.results', { n: i18n.number(total) })
                : ''}
            </p>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Select
                aria-label={t('search.sort')}
                className="w-auto"
                value={filters.sort ?? 'newest'}
                onChange={(e) =>
                  apply({ ...filters, sort: e.target.value as SearchFilters['sort'] })
                }
              >
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`sort.${s}`)}
                  </option>
                ))}
              </Select>
              <div className="flex overflow-hidden rounded-control border border-line bg-paper">
                {(['cards', 'table'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cx(
                      'min-h-9 px-3 text-sm font-bold',
                      view === v ? 'bg-graphite text-bone' : 'text-graphite hover:bg-line',
                    )}
                  >
                    {t(v === 'table' ? 'search.table' : 'search.cards')}
                  </button>
                ))}
              </div>
              <Button variant="secondary" onClick={() => setSaving(true)}>
                {t('search.save')}
              </Button>
              <a className={buttonClass('quiet')} href={`/api/app/export?${query}`}>
                {t('search.export')}
              </a>
              <a
                className={buttonClass('quiet')}
                href={`/api/app/export?${query}${query ? '&' : ''}format=csv`}
              >
                {t('search.exportCsv')}
              </a>
            </div>
          </div>

          {saving && <SaveSearch filters={filters} onClose={() => setSaving(false)} />}
          {results.isPending && <Loading />}
          <ErrorNote error={results.error} />
          {results.data?.items.length === 0 && (
            <Card>
              <p className="text-sm">{t('search.none')}</p>
            </Card>
          )}
          {results.data && results.data.items.length > 0 && (
            <div className={cx(results.isPlaceholderData && 'opacity-60')}>
              {view === 'table' ? (
                <ResultsTable items={results.data.items} />
              ) : (
                <ResultCards items={results.data.items} />
              )}
            </div>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('search.prev')}
              </Button>
              <span>{t('search.page', { page, pages })}</span>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                {t('search.next')}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Flags({ item, i18n }: { item: SearchItem; i18n: I18n }) {
  return (
    <span className="flex flex-wrap gap-1">
      {item.previousMinPrice !== null &&
        item.minPrice !== null &&
        item.minPrice < item.previousMinPrice && (
          <Badge tone="lime">{i18n.t('unit.priceDropped')}</Badge>
        )}
      {item.status !== 'active' && (
        <Badge tone={item.status === 'sold' ? 'danger' : 'warn'}>
          {i18n.t(`status.${item.status as 'sold'}`)}
        </Badge>
      )}
      {item.priceCurrency === 'USD' && <Badge tone="outline">{i18n.t('unit.usd')}</Badge>}
      {item.sourceCount > 1 && <Badge>{i18n.t('unit.reposted', { n: item.sourceCount })}</Badge>}
    </span>
  );
}

/** The payment plan as one tag. The search rows carry no monthly amount, so none is shown here. */
function planTag(item: SearchItem, i18n: I18n): string | null {
  const down = item.downPayment === null ? null : i18n.number(item.downPayment, 1);
  const years = item.installmentYears === null ? null : i18n.number(item.installmentYears, 1);
  if (down !== null && years !== null) return i18n.t('search.planTag', { p: down, n: years });
  if (down !== null) return i18n.t('search.planDown', { p: down });
  if (years !== null) return i18n.t('search.planYears', { n: years });
  return null;
}

function ResultsTable({ items }: { items: SearchItem[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <Card className="p-0">
      <Table
        head={[
          t('col.listing'),
          t('col.type'),
          t('col.area'),
          t('col.price'),
          t('col.ppsqm'),
          t('col.delivery'),
          t('col.payment'),
          t('col.seen'),
        ]}
      >
        {items.map((item) => (
          <tr key={item.id} className="hover:bg-bone">
            <td className={td}>
              <Link to={`/app/listings/${item.id}`} className="font-bold hover:underline">
                {i18n.name(item.project)}
              </Link>
              <div className="text-xs text-muted">
                {[item.developer, item.city]
                  .filter(Boolean)
                  .map((n) => i18n.name(n))
                  .join('، ')}
              </div>
              <div className="mt-1">
                <Flags item={item} i18n={i18n} />
              </div>
            </td>
            <td className={td}>
              <div>{i18n.value(item.unitType)}</div>
              {item.bedrooms !== null && (
                <div className="text-xs text-muted">{i18n.rooms(item.bedrooms)}</div>
              )}
            </td>
            <td className={`${td} whitespace-nowrap`}>{areaText(item, i18n)}</td>
            <td className={`${td} figure whitespace-nowrap`}>{priceText(item, i18n)}</td>
            <td className={`${td} whitespace-nowrap tabular-nums`}>
              {item.pricePerSqm === null ? '—' : i18n.number(item.pricePerSqm)}
            </td>
            <td className={td}>{deliveryText(item, i18n)}</td>
            <td className={td}>{paymentText(item, i18n)}</td>
            <td className={`${td} whitespace-nowrap text-muted`}>{i18n.date(item.lastSeenAt)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

/**
 * A listing card leads with what a broker scans for: where (location tag),
 * how big, and the price (big, tabular numerals). Then project and bedrooms,
 * then the payment plan as a lime tag.
 */
function ResultCards({ items }: { items: SearchItem[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const plan = planTag(item, i18n);
        return (
          <Link
            key={item.id}
            to={`/app/listings/${item.id}`}
            className="flex flex-col gap-3 rounded-card border border-line bg-paper p-5 transition-colors hover:border-graphite"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone="graphite">
                {item.city ? i18n.name(item.city) : t('common.unknown')}
              </Badge>
              <Flags item={item} i18n={i18n} />
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-base font-bold">{areaText(item, i18n)}</p>
              <p className="figure whitespace-nowrap text-xl leading-none text-graphite">
                {priceText(item, i18n)}{' '}
                <span className="text-xs font-bold text-muted">{t('common.egp')}</span>
              </p>
            </div>
            <div className="min-w-0">
              <p className="truncate font-bold">{i18n.name(item.project)}</p>
              <p className="truncate text-sm text-muted">{i18n.name(item.developer)}</p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>{i18n.value(item.unitType)}</span>
              {item.bedrooms !== null && <span>{i18n.rooms(item.bedrooms)}</span>}
              <span className="text-muted">{deliveryText(item, i18n)}</span>
            </div>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
              {plan ? (
                <Badge tone="lime" dot>
                  {plan}
                </Badge>
              ) : (
                <span />
              )}
              {item.pricePerSqm !== null && (
                <span className="text-xs whitespace-nowrap text-muted tabular-nums">
                  {t('search.pricePerSqm', { n: i18n.number(item.pricePerSqm) })}
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function SaveSearch({ filters, onClose }: { filters: SearchFilters; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<'none' | 'whatsapp' | 'telegram'>('whatsapp');
  const save = useMutation({
    mutationFn: () =>
      api('/api/app/saved-searches', {
        method: 'POST',
        body: { name, filters, alertChannel: channel, active: true },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['saved'] });
      onClose();
    },
  });
  return (
    <Card title={t('search.save')}>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Label text={t('saved.name')}>
          <Input
            required
            autoFocus
            dir="auto"
            placeholder={t('saved.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Label>
        <Label text={t('saved.alerts')}>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            {(['whatsapp', 'telegram', 'none'] as const).map((c) => (
              <option key={c} value={c}>
                {t(`channel.${c}`)}
              </option>
            ))}
          </Select>
        </Label>
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
      <p className="mt-2 text-xs text-muted">{t('saved.alertsSoon')}</p>
      <ErrorNote error={save.error} />
    </Card>
  );
}
