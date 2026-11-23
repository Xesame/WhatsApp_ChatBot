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

  it('asks for a web search and answers only from its results, as JSON', () => {
    expect(lookupPrompt.VERSION).toBe('lookup-2026-11-23.1');
    expect(lookupPrompt.SYSTEM).toMatch(/Search the web for this project/);
    expect(lookupPrompt.SYSTEM).toMatch(/Answer only from what the search results say/);
    expect(lookupPrompt.SYSTEM).not.toMatch(/what you (actually )?know|remember/i);
    expect(lookupPrompt.SYSTEM).toMatch(/"known"/);
  });

  it('gives no real names as examples the model could repeat', () => {
    expect(lookupPrompt.SYSTEM).not.toMatch(/Dubai Misr|Mostakbal/);
  });
});
