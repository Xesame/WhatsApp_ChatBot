import { createServer, type Server } from 'node:http';

/** A named check. It resolves when healthy and throws when not. */
export type HealthCheck = () => Promise<void>;

export interface HealthReport {
  status: 'ok' | 'error';
  service: string;
  /** "ok" for a passing check, otherwise the error message. */
  checks: Record<string, string>;
}

const CHECK_TIMEOUT_MS = 3000;

function withTimeout(check: HealthCheck): Promise<void> {
  return Promise.race([
    check(),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`timed out after ${CHECK_TIMEOUT_MS} ms`));
      }, CHECK_TIMEOUT_MS).unref(),
    ),
  ]);
}

/** Runs every check and reports which ones failed. */
export async function runHealthChecks(
  service: string,
  checks: Record<string, HealthCheck>,
): Promise<HealthReport> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      try {
        await withTimeout(check);
        return [name, 'ok'] as const;
      } catch (error) {
        return [name, error instanceof Error ? error.message : String(error)] as const;
      }
    }),
  );
  const results = Object.fromEntries(entries);
  const status = entries.every(([, result]) => result === 'ok') ? 'ok' : 'error';
  return { status, service, checks: results };
}

/**
 * Serves GET /health for services that have no HTTP server of their own
 * (capture, worker, chatbot). Returns 200 when every check passes and 503
 * otherwise; Docker uses the status code to restart unhealthy containers.
 */
export function startHealthServer(options: {
  service: string;
  port: number;
  checks: Record<string, HealthCheck>;
}): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    void runHealthChecks(options.service, options.checks).then((report) => {
      res
        .writeHead(report.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify(report));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      resolve(server);
    });
  });
}
