import { useEffect, useRef, useState } from 'react';
import type { ListingDetail } from '../api.ts';
import { useI18n, type I18n } from '../i18n.tsx';
import { Button, Card } from '../ui.tsx';
import { areaLine, deliveryLine, paymentLine, priceLine } from './Listing.tsx';

/**
 * A summary of a listing for an agent to forward to a client: the facts a
 * buyer cares about, in the agent's language, with no source groups, dates
 * or anything that points back to where it was found.
 */
function shareLines(detail: ListingDetail, i18n: I18n): { title: string; lines: string[] } {
  const { unit: u, names } = detail;
  const kind = [i18n.value(typeof u.unitType === 'string' ? u.unitType : null)];
  if (typeof u.bedrooms === 'number') kind.push(i18n.rooms(u.bedrooms));
  const title = [i18n.name(names.project), names.developer ? i18n.name(names.developer) : null]
    .filter(Boolean)
    .join(' – ');
  return {
    title,
    lines: [
      names.city ? `📍 ${i18n.name(names.city)}` : null,
      `🏠 ${kind.join(' – ')}`,
      `📐 ${areaLine(u, i18n)}`,
      `💰 ${priceLine(detail, i18n)}`,
      `💳 ${paymentLine(u, i18n)}`,
      `🔑 ${i18n.t('field.delivery')}: ${deliveryLine(u, i18n)}`,
      typeof u.finishingSpecs === 'string' ? `✨ ${i18n.value(u.finishingSpecs)}` : null,
    ].filter((l): l is string => l !== null),
  };
}

function drawCard(canvas: HTMLCanvasElement, title: string, lines: string[], rtl: boolean) {
  const W = 1080;
  const H = 1350;
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c) return;
  c.fillStyle = '#23271f'; // graphite
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#b8e04a'; // lime
  c.fillRect(0, 0, W, 16);
  c.direction = rtl ? 'rtl' : 'ltr';
  c.textAlign = rtl ? 'right' : 'left';
  const x = rtl ? W - 90 : 90;
  const font = (size: number, weight = 700) =>
    `${weight} ${size}px "Manrope Variable", "Noto Kufi Arabic", system-ui, "Segoe UI", Tahoma, sans-serif`;

  // title, wrapped
  c.fillStyle = '#f4f5f0'; // bone
  c.font = font(76, 700);
  let y = 210;
  const words = title.split(' ');
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width > W - 180 && line) {
      c.fillText(line, x, y);
      y += 92;
      line = word;
    } else line = next;
  }
  c.fillText(line, x, y);
  y += 70;
  c.fillStyle = '#b8e04a';
  c.fillRect(rtl ? W - 90 - 160 : 90, y, 160, 8);
  y += 110;

  for (const text of lines) {
    c.fillStyle = text.startsWith('💰') ? '#b8e04a' : '#f4f5f0';
    c.font = font(text.startsWith('💰') ? 60 : 48, text.startsWith('💰') ? 700 : 400);
    c.fillText(text, x, y, W - 180);
    y += text.startsWith('💰') ? 104 : 86;
  }
}

export function ShareCard({ detail, onClose }: { detail: ListingDetail; onClose: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { title, lines } = shareLines(detail, i18n);
  const text = [title, ...lines].join('\n');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  // `text` changes whenever the title or lines do
  useEffect(() => {
    const draw = () => {
      if (canvas.current)
        drawCard(canvas.current, title, text.split('\n').slice(1), i18n.dir === 'rtl');
    };
    draw();
    // Draw again once the web fonts have loaded, or the first draw uses a fallback.
    let live = true;
    void document.fonts.ready.then(() => live && draw());
    return () => {
      live = false;
    };
  }, [title, text, i18n.dir]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const download = () => {
    canvas.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `listing-${detail.unit.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, 'image/png');
  };

  return (
    <Card
      title={t('share.title')}
      actions={
        <Button variant="quiet" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted">{t('share.hint')}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted">{t('share.text')}</p>
          <pre dir="auto" className="rounded-control bg-bone p-3 text-sm whitespace-pre-wrap">
            {text}
          </pre>
          <Button variant="secondary" onClick={() => void copy()}>
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted">{t('share.image')}</p>
          <canvas ref={canvas} className="w-full max-w-xs rounded-control border border-line" />
          <Button variant="secondary" onClick={download}>
            {t('share.download')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
