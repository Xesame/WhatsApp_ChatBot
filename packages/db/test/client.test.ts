import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/index.ts';

describe('createDatabase', () => {
  it('reports a lost idle connection instead of crashing the process', async () => {
    const errors: Error[] = [];
    // No connection is opened until the first query, so any URL works here.
    const database = createDatabase('postgres://reb:x@127.0.0.1:1/reb', {
      onError: (error) => errors.push(error),
    });
    expect(() => database.pool.emit('error', new Error('terminating connection'))).not.toThrow();
    expect(errors.map((e) => e.message)).toEqual(['terminating connection']);
    await database.close();
  });
});
