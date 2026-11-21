// Reads a password at the terminal without showing it.
//
// The terminal is put in raw mode and the keys are handled here, using only
// Node's public API. An earlier version patched readline's private
// `_writeToOutput` method to hide the echo; Node 24.22 removed that method and
// the prompt crashed ("Cannot read properties of undefined (reading 'bind')")
// before asking anything.

export interface HiddenTyping {
  /** What has been typed so far. */
  answer: string;
  /** Enter was pressed: `answer` is final. */
  done: boolean;
  /** Ctrl-C was pressed. */
  cancelled: boolean;
}

/**
 * Applies one chunk of raw keyboard input to what has been typed. Pure, so the
 * key handling is tested without a terminal. Enter (or the end of a pasted
 * line) finishes, Backspace removes the last character, Ctrl-C cancels, and
 * arrow keys and other control keys are ignored. Anything after Enter in the
 * same chunk is dropped.
 */
export function typeHidden(state: HiddenTyping, chunk: string): HiddenTyping {
  let answer = state.answer;
  const chars = Array.from(chunk);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] ?? '';
    if (char === '\r' || char === '\n') return { answer, done: true, cancelled: false };
    if (char === '\u0003') return { answer: '', done: false, cancelled: true };
    if (char === '\u007f' || char === '\b') {
      answer = Array.from(answer).slice(0, -1).join('');
    } else if (char === '\u001b') {
      // Escape sequence (arrow keys, Delete, ...): skip `[` and the bytes up
      // to its final letter or `~`.
      if (chars[i + 1] === '[' || chars[i + 1] === 'O') {
        i += 2;
        while (i < chars.length && !/[A-Za-z~]/.test(chars[i] ?? '')) i++;
      }
    } else if (char >= ' ') {
      answer += char;
    }
  }
  return { answer, done: false, cancelled: false };
}

/** Asks `question` and resolves with the hidden answer once Enter is pressed. */
export async function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY)
    throw new Error('No terminal to type the password in; set OWNER_PASSWORD instead');
  stdout.write(question);
  return new Promise((resolve, reject) => {
    let state: HiddenTyping = { answer: '', done: false, cancelled: false };
    const onData = (chunk: string) => {
      state = typeHidden(state, chunk);
      if (!state.done && !state.cancelled) return;
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (state.cancelled) reject(new Error('Cancelled'));
      else resolve(state.answer);
    };
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.on('data', onData);
    stdin.resume();
  });
}
