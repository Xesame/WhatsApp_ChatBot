import { upsertOwner } from '@reb/auth';
import { loadConfigOrExit } from '@reb/config';
import { createDatabase } from '@reb/db';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

// Creates the owner's admin login, or resets its password if it exists.
// The password is read from the OWNER_PASSWORD variable or typed at a hidden
// prompt, never passed as an argument (arguments end up in shell history).
const usage =
  'Usage: create-owner --email <email> [--name <name>]   (password: typed, or OWNER_PASSWORD)';
const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
if (!values.email) {
  console.log(usage);
  process.exit(1);
}

async function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error('No terminal to type the password in; set OWNER_PASSWORD instead');
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
  let prompting = true;
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
    write(prompting ? (s.startsWith(question) ? question : '') : s);
  };
  const answer = await rl.question(question);
  prompting = false;
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const config = loadConfigOrExit();
const database = createDatabase(config.DATABASE_URL, { max: 1 });
try {
  let password = process.env.OWNER_PASSWORD;
  if (!password) {
    password = await askHidden('Password (at least 10 characters): ');
    if ((await askHidden('Same password again: ')) !== password)
      throw new Error('The passwords differ');
  }
  const { created } = await upsertOwner(database.db, {
    name: values.name ?? 'Owner',
    email: values.email,
    password,
  });
  console.log(created ? `Owner ${values.email} created.` : `Password for ${values.email} reset.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}
