import { toAsciiDigits } from '@reb/normalize';

/**
 * Reading sample messages from files, for testing without a live WhatsApp
 * number. Two formats:
 *
 * 1. WhatsApp's own "Export chat" text file, from Android or iPhone, in
 *    English or Arabic, with or without media:
 *      12/10/2026, 14:05 - Ahmed: text            (Android)
 *      [12/10/2026, 14:05:33] Ahmed: text         (iPhone)
 *      ١٢/١٠/٢٠٢٦ ٢:٠٥ م - أحمد: text   (Arabic phone; direction marks are removed)
 *    Lines without a date belong to the message above. Attached files are
 *    named in the text ("IMG-....jpg (file attached)", "<attached: ...>").
 *
 * 2. A plain file: messages separated by a line with only `---`. A line
 *    `file: flyer.jpg` inside a message attaches that file.
 */
export interface SampleMessage {
  sentAt: Date;
  /** The sender's name as written in the export. Hashed before storing; never stored. */
  sender: string;
  text: string;
  /** File name of an attachment, if the message had one. */
  attachment: string | null;
  /** The export left the file out ("<Media omitted>"). */
  mediaOmitted: boolean;
}

// Invisible direction marks that Arabic exports put around dates and names.
const MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
// Digits may be Western or Arabic; only the date part is converted, never the message.
const D = '[0-9٠-٩۰-۹]';
const DATE = `(${D}{1,2})[/.-](${D}{1,2})[/.-](${D}{2,4}),?\\s+(${D}{1,2}):(${D}{2})(?::(${D}{2}))?\\s*([AaPp]\\.?\\s?[Mm]\\.?|ص|م)?`;
const HEADER = {
  ios: new RegExp(`^\\[${DATE}\\]\\s?(.*)$`),
  android: new RegExp(`^${DATE}\\s+-\\s+(.*)$`),
};
const ATTACHED = [
  /^(.+?\.[A-Za-z0-9]{2,5})\s*\((?:file attached|الملف مرفق|ملف مرفق)\)\s*$/i, // Android
  /^<(?:attached|مرفق):\s*(.+?)>\s*$/i, // iPhone
];
const OMITTED =
  /^<(?:Media omitted|الوسائط غير مضمنة|تم استبعاد الوسائط|image omitted|document omitted)>$|^(?:image|video|document|sticker|GIF) omitted$/i;
const EDITED = /\s*<(?:This message was edited|تم تعديل هذه الرسالة)>\s*$/i;
const DELETED = /^(?:This message was deleted|You deleted this message|تم حذف هذه الرسالة)\.?$/i;

const clean = (line: string) => line.replace(MARKS, '').replace(/،/g, ',').trimEnd();
const num = (digits: string | undefined) => Number(toAsciiDigits(digits ?? '0'));

interface Header {
  a: number;
  b: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  ampm: string | undefined;
  rest: string;
}

function readHeader(line: string): Header | null {
  const m = HEADER.ios.exec(line) ?? HEADER.android.exec(line);
  if (!m) return null;
  const year = num(m[3]);
  return {
    a: num(m[1]),
    b: num(m[2]),
    year: year < 100 ? 2000 + year : year,
    hour: num(m[4]),
    minute: num(m[5]),
    second: num(m[6]),
    ampm: m[7],
    rest: m[8] ?? '',
  };
}

/** Cairo local time → a real instant (Egypt uses daylight saving in summer). */
export function cairoTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const shown = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return new Date(guess - (shown - guess));
}

function hour24(hour: number, ampm: string | undefined): number {
  if (!ampm) return hour;
  const pm = /^[Pp]|م/.test(ampm);
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

/** True when the text looks like a WhatsApp chat export. */
export function isChatExport(text: string): boolean {
  return text
    .split(/\r?\n/)
    .slice(0, 50)
    .some((line) => readHeader(clean(line)) !== null);
}

/** Reads a WhatsApp chat export. System lines (joins, encryption notice) and deleted messages are left out. */
export function parseChatExport(text: string): SampleMessage[] {
  const lines = text.split(/\r?\n/).map(clean);
  const headers = lines.map(readHeader);
  // Day or month first? Egyptian phones write the day first; a value over 12 decides.
  const dayFirst =
    !headers.some((h) => h && h.b > 12 && h.a <= 12) || headers.some((h) => h && h.a > 12);

  const out: SampleMessage[] = [];
  let current: { header: Header; sender: string; body: string[] } | null = null;
  const finish = () => {
    if (!current) return;
    const { header: h, sender } = current;
    const day = dayFirst ? h.a : h.b;
    const month = dayFirst ? h.b : h.a;
    let attachment: string | null = null;
    let mediaOmitted = false;
    const body: string[] = [];
    for (const raw of current.body) {
      const line = raw.replace(EDITED, '');
      const file = ATTACHED.map((p) => p.exec(line.trim())).find(Boolean);
      if (file?.[1] && !attachment) attachment = file[1].trim();
      else if (OMITTED.test(line.trim())) mediaOmitted = true;
      else body.push(line);
    }
    const message = body.join('\n').trim();
    if (!DELETED.test(message) && (message || attachment || mediaOmitted)) {
      out.push({
        sentAt: cairoTime(h.year, month, day, hour24(h.hour, h.ampm), h.minute, h.second),
        sender,
        text: message,
        attachment,
        mediaOmitted,
      });
    }
    current = null;
  };

  lines.forEach((line, i) => {
    const header = headers.at(i);
    if (header) {
      finish();
      const colon = header.rest.indexOf(': ');
      // no "Name: " → a system line (someone joined, the encryption notice)
      if (colon > 0)
        current = {
          header,
          sender: header.rest.slice(0, colon).trim(),
          body: [header.rest.slice(colon + 2)],
        };
    } else if (current) {
      current.body.push(line);
    }
  });
  finish();
  return out;
}

/**
 * Reads a plain sample file: messages separated by `---` lines, optional
 * `file: name` line per message. They get times one minute apart, ending now.
 */
export function parsePlainSamples(text: string, now: Date = new Date()): SampleMessage[] {
  const blocks = text
    .split(/\r?\n/)
    .map((l) => l.replace(MARKS, '').trimEnd())
    .join('\n')
    .split(/^\s*-{3,}\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((block, i) => {
    let attachment: string | null = null;
    const body = block
      .split('\n')
      .filter((line) => {
        const m = /^\s*\[?file:\s*(.+?)\]?\s*$/i.exec(line);
        if (m?.[1] && !attachment) {
          attachment = m[1].trim();
          return false;
        }
        return true;
      })
      .join('\n')
      .trim();
    return {
      sentAt: new Date(now.getTime() - (blocks.length - 1 - i) * 60_000),
      sender: 'sample sender',
      text: body,
      attachment,
      mediaOmitted: false,
    };
  });
}

/** Either format, decided by the content. */
export function parseSamples(text: string, now: Date = new Date()): SampleMessage[] {
  return isChatExport(text) ? parseChatExport(text) : parsePlainSamples(text, now);
}
