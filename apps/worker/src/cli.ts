import { usdToEgpRate } from '@reb/admin';
import { loadConfigOrExit } from '@reb/config';
import { createDatabase, MESSAGE_STATUSES } from '@reb/db';
import { importSamples, parseSamples } from '@reb/ingest';
import { exportUnits, reprocess, type ReprocessFilter } from '@reb/pipeline';
import { startQueue } from '@reb/queue';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { parseArgs } from 'node:util';

// Command-line tools for the pipeline. Logic lives in packages/pipeline.
const usage = `Usage:
  reprocess [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--group <id>] [--status skipped,failed] [--message <id,...>]
      Send stored messages through the pipeline again (after a prompt or model change).
  export --out <file.xlsx> [--usd-egp-rate <n>] [--message <id,...>] [--all]
      Write units in the Primary Units template layout. Active units only unless --all.
  import <file.txt> [--group <name>] [--type developer|broker] [--keep-dates]
      Feed sample messages through the pipeline without WhatsApp: a WhatsApp "Export chat"
      file (attached files in the same folder) or a plain file with messages separated by ---.
      Times move forward so the newest message is now, unless --keep-dates.`;

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
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
    type: { type: 'string' },
    'keep-dates': { type: 'boolean' },
  },
  allowPositionals: true,
});
if (command !== 'reprocess' && command !== 'export' && command !== 'import') {
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
  } else if (command === 'import') {
    const file = positionals.at(0);
    if (!file) throw new Error('import needs a file: import <file.txt>');
    if (!config.SENDER_HASH_SALT)
      throw new Error('Set SENDER_HASH_SALT in .env first (senders are stored only as a hash)');
    const type = values.type ?? null;
    if (type !== null && type !== 'developer' && type !== 'broker')
      throw new Error('--type is developer or broker');
    const samples = parseSamples(await readFile(file, 'utf8'));
    if (samples.length === 0) throw new Error(`No messages found in ${file}`);
    const boss = await startQueue(config.DATABASE_URL, {
      supervise: false,
      onError: () => undefined,
    });
    const result = await importSamples(database, boss, samples, {
      groupName: values.group ?? `Samples: ${basename(file)}`,
      sourceType: type,
      salt: config.SENDER_HASH_SALT,
      mediaDir: config.MEDIA_DIR,
      maxMediaBytes: config.MEDIA_MAX_BYTES,
      filesDir: dirname(file),
      shiftToNow: !values['keep-dates'],
    });
    await boss.stop({ graceful: true });
    console.log(
      `Imported ${result.saved} message(s) (${result.withFiles} with files); ${result.alreadyImported} already imported.`,
    );
    if (result.mediaOmitted > 0) {
      console.log(
        `${result.mediaOmitted} message(s) had their media left out of the export ("Media omitted"): export again "with media" to include flyers.`,
      );
    }
    if (result.missingFiles.length > 0) {
      console.log(
        `Files not found next to the export, imported without them: ${result.missingFiles.join(', ')}`,
      );
    }
    console.log(
      'The worker is processing them now: watch Overview and Review in the admin console.',
    );
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
