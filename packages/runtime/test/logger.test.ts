import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/index.ts';

describe('createLogger', () => {
  it('tags every line with the service name', () => {
    const logger = createLogger('capture');
    expect(logger.bindings()).toEqual({ service: 'capture' });
  });

  it('redacts personal data at the top level and one level deep', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger('capture', 'info', sink);
    logger.info({ phone: '+201000000000', message: { pushName: 'Ahmed', text: 'hi' } });
    const line = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(line.phone).toBe('[redacted]');
    expect(line.message).toEqual({ pushName: '[redacted]', text: 'hi' });
  });
});
