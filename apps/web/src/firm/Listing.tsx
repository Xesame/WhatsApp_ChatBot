import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import { api, type ListingDetail, type Me } from '../api.ts';
import { useI18n, type I18n } from '../i18n.tsx';
import { Badge, Button, Card, ErrorNote, Loading, Table, td } from '../ui.tsx';
import { pounds } from './format.ts';
import { ShareCard } from './ShareCard.tsx';

type U = ListingDetail['unit'];
const n = (u: U, key: string) => {
  const v = u[key];
  return typeof v === 'number' ? v : null;
};
const s = (u: U, key: string) => {
  const v = u[key];
  return typeof v === 'string' ? v : null;
};

/** The listing in EGP whole pounds (USD converted at the owner's rate), for display. */
export function egpPrices(detail: ListingDetail) {
  const { unit, usdEgpRate } = detail;
  const convert = (minor: number | null) =>
    minor === null
      ? null
      : unit.priceCurrency === 'USD'
        ? usdEgpRate
          ? Math.round((minor / 100) * usdEgpRate)
          : null
        : pounds(minor);
  return { low: convert(n(unit, 'minPrice')), high: convert(n(unit, 'maxPrice')) };
}

export function priceLine(detail: ListingDetail, i18n: I18n): string {
  const { low, high } = egpPrices(detail);
  if (low === null && high === null) return i18n.t('common.unknown');
  if (low !== null && high !== null && high > low)
    return `${i18n.moneyFull(low)} – ${i18n.moneyFull(high)}`;
  return i18n.moneyFull(low ?? high);
}

export function areaLine(u: U, i18n: I18n): string {
  const a = n(u, 'minArea');
  const b = n(u, 'maxArea');
  if (a === null && b === null) return i18n.t('common.unknown');
  return a !== null && b !== null && b > a
    ? `${i18n.number(a)} – ${i18n.number(b)} ${i18n.t('common.m2')}`
    : `${i18n.number(a ?? b ?? 0)} ${i18n.t('common.m2')}`;
}

export function paymentLine(u: U, i18n: I18n): string {
  const parts: string[] = [];
  const dp = n(u, 'downPayment');
  if (dp !== null) parts.push(i18n.t('unit.down', { p: i18n.number(dp, 1) }));
  const years = n(u, 'installmentYears');
  if (years !== null) parts.push(i18n.t('unit.overYears', { n: i18n.number(years, 1) }));
  const freq = s(u, 'installmentFrequency');
  if (freq) parts.push(i18n.value(freq));
  return parts.join(' – ') || i18n.t('common.unknown');
}

export function deliveryLine(u: U, i18n: I18n): string {
  if (u.readyToMove === true) return i18n.t('unit.readyToMove');
  const year = n(u, 'deliveryYear');
  return year ? String(year) : i18n.t('common.unknown');
}

/** Separate lines: the first normal, the rest muted. */
function Lines({ parts }: { parts: (string | null | false)[] }) {
  const shown = parts.filter((x): x is string => typeof x === 'string' && x !== '');
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((x, i) => (
        <span key={i} className={i === 0 ? 'block' : 'block text-xs font-normal text-muted'}>
          {x}
        </span>
      ))}
    </>
  );
}

const lines = (parts: (string | null)[]) => (parts.some(Boolean) ? <Lines parts={parts} /> : null);

export function Listing() {
  const { id } = useParams();
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const me = useOutletContext<Me>();
  const [sharing, setSharing] = useState(false);
  const listing = useQuery({
    queryKey: ['listing', id],
    queryFn: () => api<ListingDetail>(`/api/app/listings/${id ?? ''}`),
  });

  if (listing.isPending) return <Loading />;
  if (listing.error) return <ErrorNote error={listing.error} />;
  const detail = listing.data;
  const { unit: u, names } = detail;
  const money = (key: string) => {
    const v = n(u, key);
    return v === null
      ? null
      : u.priceCurrency === 'USD'
        ? `USD ${i18n.number(v / 100)}`
        : i18n.moneyFull(pounds(v));
  };
  const withUnit = (value: number | null, currency: string | null) =>
    value === null
      ? null
      : currency === '%'
        ? `${i18n.number(value, 2)}%`
        : `${i18n.number(value)} ${currency === 'USD' ? 'USD' : t('common.egp')}`;

  const facts: [string, ReactNode][] = [
    [t('col.type'), i18n.value(s(u, 'unitType'))],
    [t('field.category'), i18n.value(s(u, 'category'))],
    [t('filter.bedrooms'), n(u, 'bedrooms') ?? t('common.unknown')],
    [t('field.bathrooms'), n(u, 'bathrooms') ?? t('common.unknown')],
    [t('col.area'), areaLine(u, i18n)],
    [
      t('field.land'),
      n(u, 'landArea') === null ? null : `${i18n.number(n(u, 'landArea') ?? 0)} ${t('common.m2')}`,
    ],
    [
      t('field.garden'),
      n(u, 'gardenArea') === null
        ? null
        : `${i18n.number(n(u, 'gardenArea') ?? 0)} ${t('common.m2')}`,
    ],
    [
      t('field.outdoor'),
      n(u, 'outdoorArea') === null
        ? null
        : `${i18n.number(n(u, 'outdoorArea') ?? 0)} ${t('common.m2')}`,
    ],
    [t('field.floor'), s(u, 'floor')],
    [t('field.unitCode'), s(u, 'unitCode')],
    [t('field.finishing'), s(u, 'finishingSpecs') ? i18n.value(s(u, 'finishingSpecs')) : null],
    [t('field.delivery'), deliveryLine(u, i18n)],
    [t('listing.firstSeen'), i18n.date(s(u, 'firstSeenAt'))],
    [t('listing.lastSeen'), i18n.date(s(u, 'lastSeenAt'))],
  ];
  const payment: [string, ReactNode][] = [
    [
      t('field.downPayment'),
      lines([
        n(u, 'downPayment') === null ? null : `${i18n.number(n(u, 'downPayment') ?? 0, 1)}%`,
        money('downPaymentAmount')
          ? t('listing.amount', { amount: money('downPaymentAmount') ?? '' })
          : null,
      ]),
    ],
    [
      t('field.installments'),
      lines([
        n(u, 'installmentYears') === null
          ? null
          : t('common.years', { n: i18n.number(n(u, 'installmentYears') ?? 0, 1) }),
        n(u, 'installmentsCount') === null
          ? null
          : t('listing.count', { n: n(u, 'installmentsCount') ?? 0 }),
      ]),
    ],
    [
      t('field.frequency'),
      s(u, 'installmentFrequency') ? i18n.value(s(u, 'installmentFrequency')) : null,
    ],
    [t('field.maintenance'), withUnit(n(u, 'maintenance'), s(u, 'maintenanceCurrency'))],
    [
      t('field.cashDiscount'),
      withUnit(
        n(u, 'cashDiscount'),
        s(u, 'cashDiscountType') === 'Percentage' ? '%' : s(u, 'cashDiscountCurrency'),
      ),
    ],
  ];
  const ppsqm = (() => {
    const { low } = egpPrices(detail);
    const area = n(u, 'minArea') ?? n(u, 'maxArea');
    return low !== null && area ? Math.round(low / area) : null;
  })();

  return (
    <div className="space-y-4">
      <Button variant="quiet" size="sm" onClick={() => void navigate(-1)}>
        {i18n.dir === 'rtl' ? '→' : '←'} {t('listing.back')}
      </Button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-balance md:text-2xl">
              {i18n.name(names.project)}
            </h1>
            <p className="text-sm text-muted">
              {names.developer && <span className="me-3">{i18n.name(names.developer)}</span>}
              {names.city && <span>{i18n.name(names.city)}</span>}
            </p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
              <span>{i18n.value(s(u, 'unitType'))}</span>
              {n(u, 'bedrooms') !== null && <span>{i18n.rooms(n(u, 'bedrooms') ?? 0)}</span>}
              <span>{areaLine(u, i18n)}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {u.status !== 'active' && (
                <Badge tone={u.status === 'sold' ? 'danger' : 'warn'}>
                  {t(`status.${u.status as 'sold'}`)}
                </Badge>
              )}
              {u.readyToMove === true && <Badge tone="lime">{t('unit.readyToMove')}</Badge>}
              {u.priceCurrency === 'USD' && <Badge tone="outline">{t('unit.usd')}</Badge>}
              {detail.sources.length > 1 && (
                <Badge>{t('unit.reposted', { n: detail.sources.length })}</Badge>
              )}
            </div>
          </div>
          <div className="text-start sm:text-end">
            <p className="figure text-2xl text-graphite md:text-3xl">{priceLine(detail, i18n)}</p>
            {ppsqm !== null && (
              <p className="text-sm text-muted tabular-nums">
                {i18n.number(ppsqm)} {t('common.egp')} / {t('common.m2')}
              </p>
            )}
            {u.priceCurrency === 'USD' && detail.usdEgpRate && (
              <p className="text-xs text-muted">
                {money('minPrice')}{' '}
                {t('listing.usdNote', { rate: i18n.number(detail.usdEgpRate, 2) })}
              </p>
            )}
            <Button className="mt-3" size="lg" onClick={() => setSharing(true)}>
              {t('listing.share')}
            </Button>
          </div>
        </div>
      </Card>

      {sharing && <ShareCard detail={detail} onClose={() => setSharing(false)} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <FactList title={t('listing.facts')} rows={facts} />
            <FactList title={t('listing.payment')} rows={payment} />
          </div>
          <PaymentPlans detail={detail} />
          <Card title={t('listing.sources')}>
            <div className="space-y-4">
              {detail.sources.map((src, i) => (
                <article
                  key={i}
                  className="space-y-2 border-b border-line pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge tone={src.role === 'listing' ? 'outline' : 'warn'}>
                      {t(`source.${src.role as 'listing'}`)}
                    </Badge>
                    <span>
                      {src.postedIn === 'developer'
                        ? t('listing.postedDeveloper')
                        : src.postedIn === 'broker'
                          ? t('listing.postedBroker')
                          : t('listing.postedGroup')}
                    </span>
                    <span>{i18n.date(src.sentAt)}</span>
                  </div>
                  {src.media && src.media.kind === 'image' && (
                    <a href={`/api/app/media/${src.media.id}`} target="_blank" rel="noreferrer">
                      <img
                        src={`/api/app/media/${src.media.id}`}
                        alt=""
                        className="max-h-96 rounded-control border border-line object-contain"
                      />
                    </a>
                  )}
                  {src.media && src.media.kind !== 'image' && (
                    <a
                      className="text-sm font-bold underline"
                      href={`/api/app/media/${src.media.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('listing.openFile')}
                    </a>
                  )}
                  {src.text && (
                    <p dir="auto" className="text-sm whitespace-pre-wrap">
                      {src.text}
                    </p>
                  )}
                  {src.media?.text && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted">
                        {t('listing.fileText')}
                      </summary>
                      <pre
                        dir="auto"
                        className="mt-2 max-h-72 overflow-auto rounded-control bg-bone p-2 text-xs whitespace-pre-wrap"
                      >
                        {src.media.text}
                      </pre>
                    </details>
                  )}
                </article>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <PriceHistory detail={detail} />
          {me.firm && <Notes detail={detail} />}
        </div>
      </div>
    </div>
  );
}

/** Every current payment plan, as the message wrote it (amounts shown in the plan's own currency). */
function PaymentPlans({ detail }: { detail: ListingDetail }) {
  const i18n = useI18n();
  const { t } = i18n;
  const plans = detail.paymentPlans;
  if (plans.length === 0) return null;
  const amount = (minor: number, currency: string) =>
    currency === 'USD' ? `USD ${i18n.number(minor / 100)}` : i18n.moneyFull(pounds(minor));
  const dash = <span className="text-muted">—</span>;
  return (
    <Card title={t('listing.plans')}>
      <Table
        head={[
          t('plan.colPlan'),
          t('field.downPayment'),
          t('field.installments'),
          t('plan.colMonthly'),
          t('plan.planPrice'),
        ]}
      >
        {plans.map((plan, i) => {
          const down = [
            plan.downPaymentPercent === null ? null : `${i18n.number(plan.downPaymentPercent, 1)}%`,
            plan.downPaymentAmount === null ? null : amount(plan.downPaymentAmount, plan.currency),
          ];
          const installments = [
            plan.installmentAmount !== null && plan.installmentFrequency !== null
              ? t('plan.every', {
                  amount: amount(plan.installmentAmount, plan.currency),
                  freq: i18n.value(plan.installmentFrequency),
                })
              : null,
            plan.installmentYears === null
              ? null
              : t('unit.overYears', { n: i18n.number(plan.installmentYears, 1) }),
            plan.installmentsCount === null
              ? null
              : t('listing.count', { n: plan.installmentsCount }),
          ];
          return (
            <tr key={i}>
              <td className={td}>
                <p className="font-bold">{plan.label ?? (plan.cash ? t('plan.cash') : '')}</p>
                {plan.label && plan.cash && <Badge tone="lime">{t('plan.cash')}</Badge>}
                {plan.notes && <p className="mt-1 text-xs text-muted">{plan.notes}</p>}
              </td>
              <td className={`${td} tabular-nums`}>
                {down.some(Boolean) ? <Lines parts={down} /> : dash}
              </td>
              <td className={`${td} tabular-nums`}>
                {installments.some(Boolean) ? <Lines parts={installments} /> : dash}
              </td>
              <td className={`${td} font-bold tabular-nums`}>
                {plan.monthlyEquivalent !== null
                  ? t('plan.perMonth', { amount: amount(plan.monthlyEquivalent, plan.currency) })
                  : dash}
              </td>
              <td className={`${td} tabular-nums`}>
                {plan.planPrice === null ? dash : amount(plan.planPrice, plan.currency)}
              </td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}

function FactList({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== '');
  return (
    <Card title={title}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {shown.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function PriceHistory({ detail }: { detail: ListingDetail }) {
  const i18n = useI18n();
  if (detail.prices.length === 0) return null;
  return (
    <Card title={i18n.t('listing.history')}>
      <ol className="space-y-1.5 text-sm">
        {detail.prices.map((p, i) => {
          const older = detail.prices[i + 1];
          const change =
            older && p.minPrice !== null && older.minPrice !== null
              ? p.minPrice - older.minPrice
              : 0;
          const shown =
            p.priceCurrency === 'USD'
              ? `USD ${i18n.number((p.minPrice ?? 0) / 100)}`
              : i18n.moneyFull(pounds(p.minPrice));
          return (
            <li key={i} className="flex justify-between gap-2">
              <span className="text-muted">{i18n.date(p.observedAt)}</span>
              <span className="font-bold tabular-nums">
                {change < 0 && <span className="font-bold text-lime-ink">↓ </span>}
                {change > 0 && <span className="font-bold text-danger-ink">↑ </span>}
                {shown}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Notes({ detail }: { detail: ListingDetail }) {
  const i18n = useI18n();
  const { t } = i18n;
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['listing', String(detail.unit.id)] });
  const add = useMutation({
    mutationFn: () =>
      api(`/api/app/listings/${detail.unit.id}/notes`, { method: 'POST', body: { body } }),
    onSuccess: async () => {
      setBody('');
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/app/notes/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return (
    <Card title={t('listing.notes')}>
      <p className="mb-3 text-xs text-muted">{t('listing.notesHint')}</p>
      <ul className="mb-3 space-y-2">
        {detail.notes.map((note) => (
          <li key={note.id} className="rounded-control bg-warn p-2 text-sm text-ink">
            <p dir="auto" className="whitespace-pre-wrap">
              {note.body}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-warn-ink">
              <span>
                {note.authorName ?? '—'} {i18n.date(note.createdAt)}
              </span>
              <Button variant="dangerQuiet" size="sm" onClick={() => remove.mutate(note.id)}>
                {t('common.delete')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <textarea
          dir="auto"
          rows={3}
          maxLength={2000}
          placeholder={t('listing.notePlaceholder')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-control border border-line bg-paper px-3 py-2 text-sm hover:border-muted/50 focus:border-graphite"
        />
        <Button type="submit" variant="secondary" disabled={add.isPending || !body.trim()}>
          {t('listing.addNote')}
        </Button>
        <ErrorNote error={add.error ?? remove.error} />
      </form>
    </Card>
  );
}
