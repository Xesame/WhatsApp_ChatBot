import { describe, expect, it } from 'vitest';
import { testGroupName, testMessageSchema, testMessageWaId } from '../src/test-messages.ts';

describe('test messages (pasted in the admin console)', () => {
  it('trims the text and accepts 1 to 20,000 characters', () => {
    expect(testMessageSchema.parse({ text: '  شقة 3 غرف  ' })).toEqual({
      text: 'شقة 3 غرف',
      posterType: null,
    });
    expect(testMessageSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(testMessageSchema.safeParse({ text: 'x'.repeat(20_000) }).success).toBe(true);
    expect(testMessageSchema.safeParse({ text: 'x'.repeat(20_001) }).success).toBe(false);
  });

  it('accepts developer, broker or no poster type, nothing else', () => {
    expect(testMessageSchema.parse({ text: 'a', posterType: 'broker' }).posterType).toBe('broker');
    expect(testMessageSchema.safeParse({ text: 'a', posterType: 'agent' }).success).toBe(false);
  });

  it('gives each poster type its own group', () => {
    expect(testGroupName(null)).toBe('Test messages');
    expect(testGroupName('developer')).toBe('Test messages (developer)');
    expect(testGroupName('broker')).toBe('Test messages (broker)');
  });

  it('gives the same text the same message ID, and different text a different one', () => {
    expect(testMessageWaId('abc')).toBe(testMessageWaId('abc'));
    expect(testMessageWaId('abc')).not.toBe(testMessageWaId('abd'));
  });
});
