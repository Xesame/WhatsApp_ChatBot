import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { cx, Input } from '../ui.tsx';

export interface PickOption {
  value: string;
  label: string;
}

/** A dropdown of checkboxes, with a search box when the list is long. */
export function MultiPick({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: PickOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const shown = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));
  const summary =
    selected.length === 0
      ? t('common.any')
      : options
          .filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join('، ');
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div ref={box} className="relative">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          'mt-1 flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-start text-sm dark:border-slate-700 dark:bg-slate-900',
          selected.length > 0 && 'border-sky-500',
        )}
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute inset-x-0 z-30 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {options.length > 8 && (
            <Input
              autoFocus
              className="mb-2"
              placeholder={t('filter.choose')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {shown.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
              <span dir="auto">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
