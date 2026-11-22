import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

// Small hand-written building blocks (Tailwind classes, no component library),
// in the Bone, Graphite & Lime look. The colours and radii come from the
// tokens in index.css; see the design spec in docs/superpowers/specs.
//
// Rules these follow: lime is only for what needs action (primary buttons,
// counts that need Hassan); cards have a border and no shadow; labels are
// sentence case, never ALL CAPS.

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

/**
 * Button looks. `ghost` is the old name for `quiet` and stays so existing
 * pages keep working.
 * - primary: lime fill, ink text. The one main action on a screen.
 * - secondary: graphite outline on light backgrounds.
 * - quiet: no box until hovered; small, frequent actions.
 * - danger: soft red fill for actions that remove or reject.
 * - dangerQuiet: red text, no box until hovered ("Not a listing").
 * - inverse: for buttons sitting on graphite (sidebar, top bar).
 */
export type ButtonVariant =
  'primary' | 'secondary' | 'quiet' | 'danger' | 'dangerQuiet' | 'inverse' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-lime text-ink hover:brightness-95',
  secondary:
    'border border-graphite bg-transparent text-graphite hover:bg-graphite hover:text-bone',
  quiet: 'text-graphite hover:bg-line',
  ghost: 'text-graphite hover:bg-line',
  danger: 'bg-danger text-danger-ink hover:brightness-95',
  dangerQuiet: 'text-danger-ink hover:bg-danger',
  inverse: 'text-bone hover:bg-graphite-2',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-2.5 py-1 text-xs',
  md: 'min-h-9 px-3.5 py-1.5 text-sm',
  lg: 'min-h-11 px-5 py-2.5 text-base',
};

/** The classes of a Button, for links (`<Link>`) that should look like one. */
export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md') =>
  cx(
    'inline-flex items-center justify-center gap-1.5 rounded-control font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    buttonSizes[size],
    buttonVariants[variant],
  );

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type="button" {...props} className={cx(buttonClass(variant, size), className)} />;
}

const field =
  'w-full min-h-9 rounded-control border border-line bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-muted hover:border-muted/50 focus:border-graphite disabled:cursor-not-allowed disabled:bg-bone disabled:text-muted';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(field, className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(field, 'pe-8', className)} />;
}

/** A form field with its label above (sentence case, medium weight) and an optional hint below. */
export function Label({
  text,
  children,
  hint,
  tone = 'default',
}: {
  text: string;
  children: ReactNode;
  hint?: string;
  /** `inverse` for labels sitting on graphite (bone text). */
  tone?: 'default' | 'inverse';
}) {
  return (
    <label className="block space-y-1.5">
      <span
        className={cx('block text-sm font-medium', tone === 'inverse' ? 'text-bone' : 'text-ink')}
      >
        {text}
      </span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** A white panel on the bone page: 12 px corners, a thin border, no shadow. */
export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-card border border-line bg-paper p-5', className)}>
      {(title ?? actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Small tags. New names: neutral, lime, warn, danger, outline, graphite.
 * The old names still work: gray = neutral, green = lime, amber = warn,
 * red = danger, blue = outline.
 */
const tones = {
  neutral: 'bg-bone text-graphite border border-line',
  lime: 'bg-lime-soft text-lime-ink',
  warn: 'bg-warn text-warn-ink',
  danger: 'bg-danger text-danger-ink',
  outline: 'border border-graphite/30 bg-paper text-graphite',
  graphite: 'bg-graphite text-lime',
  gray: 'bg-bone text-graphite border border-line',
  green: 'bg-lime-soft text-lime-ink',
  amber: 'bg-warn text-warn-ink',
  red: 'bg-danger text-danger-ink',
  blue: 'border border-graphite/30 bg-paper text-graphite',
};
export type BadgeTone = keyof typeof tones;

export function Badge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: BadgeTone;
  /** A small lime dot before the text (payment-plan tags). */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-control px-2 py-0.5 text-xs font-bold',
        tones[tone],
      )}
    >
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-lime" />}
      {children}
    </span>
  );
}

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-prose text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const noteTones = {
  success: 'bg-lime-soft text-lime-ink',
  warn: 'bg-warn text-warn-ink',
  danger: 'bg-danger text-danger-ink',
  neutral: 'border border-line bg-paper text-ink',
};

/** A short coloured message: confirmations (success), "check this" (warn), problems (danger). */
export function Note({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: keyof typeof noteTones;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('rounded-control px-3 py-2 text-sm font-medium', noteTones[tone], className)}
    >
      {children}
    </p>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Note tone="danger">
      {error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Something went wrong'}
    </Note>
  );
}

export function Loading() {
  return (
    <p role="status" className="text-sm text-muted">
      Loading…
    </p>
  );
}

/**
 * A big figure with a label under it: the numbers that matter (waiting for
 * review, active listings). `lime` is only for the number that needs action.
 */
export function Stat({
  value,
  label,
  tone = 'paper',
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: 'paper' | 'lime';
}) {
  return (
    <div
      className={cx(
        'rounded-banner border p-5',
        tone === 'lime' ? 'border-lime bg-lime text-ink' : 'border-line bg-paper',
      )}
    >
      <p className="figure text-2xl leading-none text-graphite">{value}</p>
      <p className={cx('mt-2 text-sm', tone === 'lime' ? 'text-ink' : 'text-muted')}>{label}</p>
    </div>
  );
}

/** A table with a bone header row and thin rules; scrolls sideways on its own on phones. */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-start text-sm">
        <thead className="bg-bone text-xs text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2.5 text-start font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const td = 'px-3 py-2.5 align-top';

/** The product name with "Bot" in lime; only for graphite backgrounds. */
export function Wordmark({ name, className }: { name: string; className?: string }) {
  const cut = name.lastIndexOf(' ');
  return (
    <span className={cx('font-extrabold tracking-tight text-bone', className)}>
      {cut > 0 ? (
        <>
          {name.slice(0, cut)} <span className="text-lime">{name.slice(cut + 1)}</span>
        </>
      ) : (
        name
      )}
    </span>
  );
}

/**
 * The sign-in and set-password pages: a graphite panel with the product name
 * (left in English, right in Arabic) and the form on bone. On phones the
 * panel shrinks to a band on top.
 */
export function AuthLayout({
  name,
  tagline,
  corner,
  children,
}: {
  name: string;
  tagline: string;
  /** Shown at the top of the form side, e.g. the language switch. */
  corner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-bone md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="on-graphite flex flex-col justify-between gap-6 bg-graphite px-6 py-6 md:px-12 md:py-12">
        <Wordmark name={name} className="text-lg" />
        <p className="max-w-md text-base font-bold text-bone md:text-2xl md:font-extrabold md:leading-[1.15]">
          {tagline}
        </p>
      </aside>
      <main className="flex flex-col px-4 py-6 md:px-12 md:py-12">
        {corner && <div className="flex justify-end">{corner}</div>}
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const formatMoney = (minor: number | null | undefined, currency: string) =>
  minor === null || minor === undefined
    ? '—'
    : `${currency} ${(minor / 100).toLocaleString('en-US')}`;

export { cx };
