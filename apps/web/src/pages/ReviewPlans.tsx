import { INSTALLMENT_FREQUENCIES } from '@reb/schema/enums';
import { Button, Input, Select } from '../ui.tsx';
import { editRow, emptyRow, plansChanged, type PlanRow } from './plans.ts';

/** Plans a unit can have at most (the same limit the server enforces). */
const MAX_PLANS = 12;

const COLUMNS = [
  'Label',
  'Down payment %',
  'Down payment amount',
  'Installment',
  'How often',
  'Years',
  'Plan price',
  'Cash',
  'Notes',
] as const;

/**
 * The "Payment plans" table of the Review page: one row per plan the unit
 * offers (0% down, 10% down, cash...). Amounts are whole pounds / dollars.
 * Saving writes the table as the unit's newest plans; the older ones from
 * the messages are kept in the background.
 */
export function ReviewPlans({
  rows,
  initial,
  currency,
  onChange,
}: {
  rows: PlanRow[];
  initial: PlanRow[];
  /** The unit's own currency, used for plans added here. */
  currency: PlanRow['currency'];
  onChange: (rows: PlanRow[]) => void;
}) {
  const ring = plansChanged(initial, rows) ? 'border-graphite ring-2 ring-lime/60' : '';
  const set = (index: number, patch: Partial<PlanRow>) =>
    onChange(rows.map((row, i) => (i === index ? editRow(row, patch) : row)));
  const box = (
    index: number,
    key:
      | 'label'
      | 'notes'
      | 'downPaymentPercent'
      | 'downPaymentAmount'
      | 'installmentAmount'
      | 'installmentYears'
      | 'planPrice',
    label: string,
    numeric = true,
  ) => (
    <Input
      aria-label={`Plan ${index + 1} ${label}`}
      className={ring}
      dir="auto"
      inputMode={numeric ? 'decimal' : 'text'}
      value={rows[index]?.[key] ?? ''}
      onChange={(e) => set(index, { [key]: e.target.value })}
    />
  );

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold text-graphite">Payment plans</legend>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No payment plans stated.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-paper">
          <table className="w-full min-w-[56rem] text-start text-sm">
            <thead className="bg-bone text-xs text-muted">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} className="px-1.5 py-2 text-start font-bold">
                    {c}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="px-1.5 py-1.5">{box(i, 'label', 'label', false)}</td>
                  <td className="px-1.5 py-1.5">
                    {box(i, 'downPaymentPercent', 'down payment %')}
                  </td>
                  <td className="px-1.5 py-1.5">
                    {box(i, 'downPaymentAmount', 'down payment amount')}
                  </td>
                  <td className="px-1.5 py-1.5">{box(i, 'installmentAmount', 'installment')}</td>
                  <td className="px-1.5 py-1.5">
                    <Select
                      aria-label={`Plan ${i + 1} how often`}
                      className={ring}
                      value={row.installmentFrequency}
                      onChange={(e) => set(i, { installmentFrequency: e.target.value })}
                    >
                      <option value="">—</option>
                      {INSTALLMENT_FREQUENCIES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-1.5 py-1.5">{box(i, 'installmentYears', 'years')}</td>
                  <td className="px-1.5 py-1.5">{box(i, 'planPrice', 'plan price')}</td>
                  <td className="px-1.5 py-1.5 text-center">
                    <input
                      type="checkbox"
                      className="accent-graphite"
                      aria-label={`Plan ${i + 1} cash`}
                      checked={row.cash}
                      onChange={(e) => set(i, { cash: e.target.checked })}
                    />
                  </td>
                  <td className="px-1.5 py-1.5">{box(i, 'notes', 'notes', false)}</td>
                  <td className="px-1.5 py-1.5">
                    <Button
                      variant="dangerQuiet"
                      size="sm"
                      aria-label={`Remove plan ${i + 1}`}
                      onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button
        variant="secondary"
        className="mt-2"
        disabled={rows.length >= MAX_PLANS}
        onClick={() => onChange([...rows, emptyRow(currency)])}
      >
        + Add plan
      </Button>
    </fieldset>
  );
}
