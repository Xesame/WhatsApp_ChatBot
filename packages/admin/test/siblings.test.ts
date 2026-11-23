import { describe, expect, it } from 'vitest';
import { writtenProjectKey } from '../src/review.ts';

const written = (project: string[]) => ({ written: { developer: [], project, city: [] } });

describe('writtenProjectKey (which listings of a message are siblings)', () => {
  it('treats spellings that differ only in case and spaces as the same name', () => {
    expect(writtenProjectKey(written(['Villatique']))).toBe(
      writtenProjectKey(written(['  villatique '])),
    );
  });

  it('keeps different projects apart', () => {
    expect(writtenProjectKey(written(['Villatique']))).not.toBe(
      writtenProjectKey(written(['Taj City'])),
    );
  });

  it('counts two units without a written project name as the same', () => {
    expect(writtenProjectKey({})).toBe(writtenProjectKey(written([])));
    expect(writtenProjectKey(null)).toBe('');
  });
});
