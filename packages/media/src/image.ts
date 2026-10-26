import { createCanvas, loadImage } from '@napi-rs/canvas';
import { transcribePrompt, type Attempt, type LlmClient, type ModelRef } from '@reb/llm';

export interface Transcription {
  /** The text found in the image; '' when the model says there is none; null when every model failed. */
  text: string | null;
  attempts: Attempt[];
}

/** Longest side sent to the model. Larger photos are scaled down: smaller, cheaper, just as readable. */
const MAX_SIDE = 2000;
const MAX_BYTES = 4 * 1024 * 1024;
const SENDABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Makes an image safe to send: a supported format and a reasonable size.
 * Anything else (HEIC, huge photos) is decoded and re-encoded as JPEG.
 */
export async function prepareImage(
  data: Buffer,
  mimeType: string | null,
): Promise<{ data: Buffer; mimeType: string }> {
  const type = mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (SENDABLE.has(type) && data.length <= MAX_BYTES) {
    const image = await loadImage(data);
    if (Math.max(image.width, image.height) <= MAX_SIDE) return { data, mimeType: type };
  }
  const image = await loadImage(data);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toBuffer('image/jpeg', 90), mimeType: 'image/jpeg' };
}

/**
 * Asks the vision model to copy out all text in an image (build plan,
 * step 2). Images are sent as they are: Hassan approved this, since the
 * groups are semi-public (decision log).
 */
export async function transcribeImage(
  llm: LlmClient,
  models: ModelRef[],
  image: { data: Buffer; mimeType: string | null },
): Promise<Transcription> {
  const prepared = await prepareImage(image.data, image.mimeType);
  const result = await llm.callText(models, {
    promptVersion: transcribePrompt.VERSION,
    messages: [
      { role: 'system', content: transcribePrompt.SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: transcribePrompt.USER },
          {
            type: 'image_url',
            image_url: {
              url: `data:${prepared.mimeType};base64,${prepared.data.toString('base64')}`,
            },
          },
        ],
      },
    ],
  });
  if (result.text === null) return { text: null, attempts: result.attempts };
  return {
    text: result.text.trim() === '[no text]' ? '' : result.text.trim(),
    attempts: result.attempts,
  };
}
