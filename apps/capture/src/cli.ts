import { loadConfigOrExit } from '@reb/config';
import { createDatabase } from '@reb/db';
import { listGroups, setSourceType, setWatched, type GroupSourceType } from '@reb/ingest';

// Command-line tool for choosing which groups capture stores. The owner admin
// page (Phase 5) replaces it. Changes reach a running capture within 30 s.
const usage = `Usage:
  groups list                                   show every group the scraper number is in
  groups watch <id|jid> [...]                    start storing messages from these groups
  groups unwatch <id|jid> [...]                  stop storing messages from these groups
  groups source <developer|broker|none> <id|jid> [...]   set who posts in the group`;

const [command, action, ...args] = process.argv.slice(2);
if (command !== 'groups' || !action) {
  console.log(usage);
  process.exit(command ? 1 : 0);
}

const config = loadConfigOrExit();
const database = createDatabase(config.DATABASE_URL, { max: 1 });
try {
  switch (action) {
    case 'list': {
      const groups = await listGroups(database.db);
      if (groups.length === 0) {
        console.log('No groups yet. Groups appear after the scraper number connects.');
        break;
      }
      console.table(
        groups.map((g) => ({
          id: g.id,
          name: g.name ?? '(unknown)',
          watched: g.watched ? 'yes' : '',
          source: g.sourceType ?? '',
          member: g.isMember ? 'yes' : 'left',
          'last message': g.lastMessageAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '',
          jid: g.jid,
        })),
      );
      break;
    }
    case 'watch':
    case 'unwatch': {
      if (args.length === 0) throw new Error(`groups ${action} needs at least one group id`);
      const count = await setWatched(database.db, args, action === 'watch');
      console.log(`${action === 'watch' ? 'Watching' : 'Stopped watching'} ${count} group(s).`);
      if (count < args.length) console.log('Some ids did not match a group; see `groups list`.');
      break;
    }
    case 'source': {
      const [type, ...refs] = args;
      if (type !== 'developer' && type !== 'broker' && type !== 'none') {
        throw new Error('source type must be developer, broker or none');
      }
      if (refs.length === 0) throw new Error('groups source needs at least one group id');
      const value: GroupSourceType | null = type === 'none' ? null : type;
      const count = await setSourceType(database.db, refs, value);
      console.log(`Set source type of ${count} group(s) to ${type}.`);
      break;
    }
    default:
      console.log(usage);
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}
