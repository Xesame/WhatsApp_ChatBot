import { usdToEgpRate } from '@reb/admin';
import { loadConfigOrExit } from '@reb/config';
import { createDatabase, MESSAGE_STATUSES } from '@reb/db';
import { exportUnits, reprocess, type ReprocessFilter } from '@reb/pipeline';
import { startQueue } from '@reb/queue';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

// Command-line tools for the pipeline. Logic lives in packages/pipeline.
const usage = `Usage:
  reprocess [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--group <id>] [--status skipped,failed] [--message <id,...>]
      Send stored messages through the pipeline again (after a prompt or model change).
  export --out <file.xlsx> [--usd-egp-rate <n>] [--message <id,...>] [--all]
      Write units in the Primary Units template layout. Active units only unless --all.`;

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    group: { type: 'string' },
    status: { type: 'string' },
    message: { type: 'string' },
    out: { type: 'string' },
    'usd-egp-rate': { type: 'string' },
    all: { type: 'boolean' },
  },
});
if (command !== 'reprocess' && command !== 'export') {
  console.log(usage);
  process.exit(command ? 1 : 0);
}

const ids = (list: string | undefined) => list?.split(',').map((s) => Number(s.trim()));
const date = (text: string | undefined) => {
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Not a date: ${text}`);
  return parsed;
};

const config = loadConfigOrExit();
const database = createDatabase(config.DATABASE_URL, { max: 2 });
try {
  if (command === 'reprocess') {
    const statuses = values.status?.split(',').map((s) => s.trim());
    for (const s of statuses ?? []) {
      if (!(MESSAGE_STATUSES as readonly string[]).includes(s))
        throw new Error(`Unknown status: ${s}`);
    }
    const filter: ReprocessFilter = {
      from: date(values.from),
      to: date(values.to),
      groupId: values.group ? Number(values.group) : undefined,
      status: statuses as ReprocessFilter['status'],
      messageIds: ids(values.message),
    };
    const boss = await startQueue(config.DATABASE_URL, {
      supervise: false,
      onError: () => undefined,
    });
    const count = await reprocess(database, boss, filter);
    await boss.stop({ graceful: true });
    console.log(`Queued ${count} message(s) for processing.`);
  } else {
    if (!values.out) throw new Error('export needs --out <file.xlsx>');
    // --usd-egp-rate, else the rate the owner set in the admin console, else USD_EGP_RATE
    const rate = values['usd-egp-rate']
      ? Number(values['usd-egp-rate'])
      : await usdToEgpRate(database.db, config.USD_EGP_RATE);
    const { file, count } = await exportUnits(database, {
      usdToEgp: rate,
      messageIds: ids(values.message),
      includeInactive: values.all,
    });
    await writeFile(values.out, file);
    console.log(`Wrote ${count} unit(s) to ${values.out}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}
