import { describe, expect, it } from 'vitest';
import {
  cairoTime,
  isChatExport,
  parseChatExport,
  parsePlainSamples,
  parseSamples,
} from '../src/chat-export.ts';

const android = [
  '13/01/2026, 9:58 am - Messages and calls are end-to-end encrypted. Tap to learn more.',
  "13/01/2026, 10:02 am - Ahmed Broker joined using this group's invite link",
  '13/01/2026, 10:05 am - Ahmed Broker: متاح شقة في ميفيدا',
  '3 غرف 165 متر',
  'السعر 9.8 مليون',
  '13/01/2026, 10:07 am - Ahmed Broker: IMG-20260113-WA0003.jpg (file attached)',
  'قائمة أسعار المرحلة الجديدة',
  '13/01/2026, 10:09 am - Sara: <Media omitted>',
  '13/01/2026, 10:10 am - Sara: This message was deleted',
  '13/01/2026, 1:15 pm - Sara: الشقة بقت 9.5 مليون <This message was edited>',
].join('\n');

const iphone = [
  '[13/01/2026, 09:15:02] Mona: <attached: 00000012-PHOTO-2026-01-13-09-15-02.jpg>',
  '[13/01/2026, 09:15:40] Mona: Townhouse 210 m² ready to move, 18M cash',
].join('\r\n');

const arabic = `١٣\u200f/١\u200f/٢٠٢٦ ٢:٠٥ م - أحمد: للبيع فيلا ٤ غرف`;

describe('WhatsApp chat exports', () => {
  it('reads Android exports: joined lines, attachments with captions, omitted media, edits; skips system lines and deletions', () => {
    const messages = parseChatExport(android);
    expect(messages.map((m) => [m.sender, m.text, m.attachment, m.mediaOmitted])).toEqual([
      ['Ahmed Broker', 'متاح شقة في ميفيدا\n3 غرف 165 متر\nالسعر 9.8 مليون', null, false],
      ['Ahmed Broker', 'قائمة أسعار المرحلة الجديدة', 'IMG-20260113-WA0003.jpg', false],
      ['Sara', '', null, true],
      ['Sara', 'الشقة بقت 9.5 مليون', null, false],
    ]);
    // Cairo is UTC+2 in January
    expect(messages[0]?.sentAt.toISOString()).toBe('2026-01-13T08:05:00.000Z');
    expect(messages[3]?.sentAt.toISOString()).toBe('2026-01-13T11:15:00.000Z');
  });

  it('reads iPhone exports', () => {
    const messages = parseChatExport(iphone);
    expect(messages.map((m) => [m.sender, m.text, m.attachment])).toEqual([
      ['Mona', '', '00000012-PHOTO-2026-01-13-09-15-02.jpg'],
      ['Mona', 'Townhouse 210 m² ready to move, 18M cash', null],
    ]);
    expect(messages[1]?.sentAt.toISOString()).toBe('2026-01-13T07:15:40.000Z');
  });

  it('reads Arabic phone exports: Arabic digits, direction marks and ص/م', () => {
    const [m] = parseChatExport(arabic);
    expect(m).toMatchObject({ sender: 'أحمد', text: 'للبيع فيلا ٤ غرف' });
    expect(m?.sentAt.toISOString()).toBe('2026-01-13T12:05:00.000Z'); // 2:05 pm Cairo
  });

  it('works out month-first dates from a day over 12', () => {
    const [m] = parseChatExport('1/13/26, 2:05 PM - X: hello');
    expect(m?.sentAt.toISOString()).toBe('2026-01-13T12:05:00.000Z');
  });

  it('follows daylight saving in Egypt', () => {
    expect(cairoTime(2026, 1, 13, 14, 0, 0).toISOString()).toBe('2026-01-13T12:00:00.000Z');
    expect(cairoTime(2026, 7, 13, 14, 0, 0).toISOString()).toBe('2026-07-13T11:00:00.000Z');
  });

  it('tells an export from a plain file', () => {
    expect(isChatExport(android)).toBe(true);
    expect(isChatExport('شقة 3 غرف\n---\nفيلا')).toBe(false);
  });
});

describe('plain sample files', () => {
  it('splits on --- lines, attaches files, spaces times a minute apart ending now', () => {
    const now = new Date('2026-11-08T10:00:00Z');
    const messages = parsePlainSamples(
      'شقة 3 غرف ميفيدا 9.8 مليون\n---\nfile: flyer.jpg\nقائمة الأسعار\n---\n\n',
      now,
    );
    expect(messages.map((m) => [m.text, m.attachment])).toEqual([
      ['شقة 3 غرف ميفيدا 9.8 مليون', null],
      ['قائمة الأسعار', 'flyer.jpg'],
    ]);
    expect(messages.map((m) => m.sentAt.toISOString())).toEqual([
      '2026-11-08T09:59:00.000Z',
      '2026-11-08T10:00:00.000Z',
    ]);
    expect(parseSamples('a\n---\nb', now)).toHaveLength(2);
  });
});
