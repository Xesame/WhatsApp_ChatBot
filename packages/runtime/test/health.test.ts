import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { runHealthChecks, startHealthServer } from '../src/index.ts';

describe('runHealthChecks', () => {
  it('is ok when every check passes', async () => {
    const report = await runHealthChecks('test', { database: () => Promise.resolve() });
    expect(report).toEqual({ status: 'ok', service: 'test', checks: { database: 'ok' } });
  });

  it('reports the failing check and its message', async () => {
    const report = await runHealthChecks('test', {
      database: () => Promise.resolve(),
      whatsapp: () => Promise.reject(new Error('not connected')),
    });
    expect(report.status).toBe('error');
    expect(report.checks).toEqual({ database: 'ok', whatsapp: 'not connected' });
  });
});

describe('startHealthServer', () => {
  it('answers 200 when healthy and 503 when not', async () => {
    let healthy = true;
    const server = await startHealthServer({
      service: 'test',
      port: 0,
      checks: { flag: () => (healthy ? Promise.resolve() : Promise.reject(new Error('down'))) },
    });
    const { port } = server.address() as AddressInfo;
    try {
      const ok = await fetch(`http://127.0.0.1:${port}/health`);
      expect(ok.status).toBe(200);
      healthy = false;
      const bad = await fetch(`http://127.0.0.1:${port}/health`);
      expect(bad.status).toBe(503);
      expect(await bad.json()).toMatchObject({ checks: { flag: 'down' } });
      const missing = await fetch(`http://127.0.0.1:${port}/other`);
      expect(missing.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
