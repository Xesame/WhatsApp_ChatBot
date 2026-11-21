import { describe, expect, it } from 'vitest';
import { lookupPrompt } from '../src/index.ts';

describe('lookup prompt', () => {
  it('sends only the project name when no developer was written', () => {
    expect(lookupPrompt.userPrompt({ project: 'Lumia Lagoons', developer: null })).toBe(
      'PROJECT: Lumia Lagoons',
    );
  });

  it('adds the developer line when one was written, and nothing else', () => {
    const text = lookupPrompt.userPrompt({ project: 'Lumia Lagoons', developer: 'دبي مصر' });
    expect(text.split('\n')).toEqual(['PROJECT: Lumia Lagoons', 'DEVELOPER MENTIONED: دبي مصر']);
  });

  it('gives no real names as examples the model could repeat', () => {
    expect(lookupPrompt.SYSTEM).not.toMatch(/Dubai Misr|Mostakbal/);
  });
});
