/**
 * Turns the owner's review corrections into eval cases (Phase 5).
 *
 * Every message whose units were corrected, approved or rejected in the
 * admin console becomes a folder under eval/cases/review-message-<id>/ with
 * message.txt, quoted.txt (if it replied to something), the media file (if
 * any) and expected.json (the units as the owner left them).
 *
 * Usage:
 *   pnpm eval:from-review            write new cases (existing folders are kept)
 *   pnpm eval:from-review --force    overwrite existing review cases too
 *
 * Phone numbers and e-mails are removed from the texts before they are
 * written, because cases are committed. Read each new case once before
 * committing it (see eval/README.md).
 */
import { reviewCases } from '@reb/admin';
import { loadConfigOrExit } from '@reb/config';
import { createDatabase } from '@reb/db';
import { scrubPersonalData } from '@reb/llm';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const casesDir = fileURLToPath(new URL('./cases', import.meta.url));
const { values } = parseArgs({ options: { force: { type: 'boolean' } } });

const config = loadConfigOrExit();
const database = createDatabase(config.DATABASE_URL, { max: 1 });
let written = 0;
let kept = 0;
try {
  for (const c of await reviewCases(database.db)) {
    const dir = join(casesDir, c.id);
    if (existsSync(dir) && !values.force) {
      kept++;
      continue;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'message.txt'), `${scrubPersonalData(c.messageText)}\n`);
    if (c.quotedText)
      await writeFile(join(dir, 'quoted.txt'), `${scrubPersonalData(c.quotedText)}\n`);
    if (c.media) {
      const base = c.media.kind === 'image' ? 'image' : 'document';
      const extension = extname(c.media.path).toLowerCase() || '.bin';
      await copyFile(join(config.MEDIA_DIR, c.media.path), join(dir, `${base}${extension}`));
    }
    await writeFile(join(dir, 'expected.json'), `${JSON.stringify(c.expected, null, 2)}\n`);
    written++;
  }
  console.log(
    `Wrote ${written} case(s) to eval/cases${kept ? `; kept ${kept} existing (use --force to overwrite)` : ''}.`,
  );
  if (written > 0)
    console.log('Check each new case, then run `pnpm eval` to score the pipeline on them.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}
