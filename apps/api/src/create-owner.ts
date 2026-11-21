import { upsertOwner } from '@reb/auth';
import { loadConfigOrExit } from '@reb/config';
import { createDatabase } from '@reb/db';
import { parseArgs } from 'node:util';
import { askHidden } from './hidden-input.ts';

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
