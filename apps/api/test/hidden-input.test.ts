import { describe, expect, it } from 'vitest';
import { type HiddenTyping, typeHidden } from '../src/hidden-input.ts';

const start: HiddenTyping = { answer: '', done: false, cancelled: false };
const type = (...chunks: string[]) => chunks.reduce(typeHidden, start);

describe('typeHidden', () => {
  it('collects keys until Enter', () => {
    expect(type('s', 'e', 'cret', '\r')).toEqual({
      answer: 'secret',
      done: true,
      cancelled: false,
    });
  });

  it('finishes a pasted line and drops what follows Enter', () => {
    expect(type('pasted-pass\r\nextra')).toEqual({
      answer: 'pasted-pass',
      done: true,
      cancelled: false,
    });
  });

  it('keeps going until Enter', () => {
    expect(type('abc')).toEqual({ answer: 'abc', done: false, cancelled: false });
  });

  it('removes the last character on Backspace', () => {
    expect(type('abcd', '\u007f', '\b', 'x\r').answer).toBe('abx');
    expect(type('\u007f', 'a\r').answer).toBe('a');
  });

  it('cancels on Ctrl-C and forgets what was typed', () => {
    expect(type('abc', '\u0003')).toEqual({ answer: '', done: false, cancelled: true });
  });

  it('ignores arrow keys and other escape sequences', () => {
    expect(type('ab', '\u001b[D', '\u001b[3~', 'c\r').answer).toBe('abc');
  });

  it('keeps Arabic letters and spaces', () => {
    expect(type('كلمة سر', '\u007f', '\r').answer).toBe('كلمة س');
  });
});
