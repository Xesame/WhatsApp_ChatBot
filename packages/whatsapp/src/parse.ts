import {
  getContentType,
  isJidGroup,
  normalizeMessageContent,
  proto,
  type WAMessage,
} from 'baileys';
import { hashSender, senderIdentity } from './sender.ts';

/** The media kinds we keep. Stickers, locations, polls etc. are ignored. */
export type MediaKind = 'image' | 'video' | 'audio' | 'document';

/** Enough information to download a media file again, with no sender data. */
export interface MediaRef {
  kind: MediaKind;
  url: string | null;
  directPath: string | null;
  /** base64 */
  mediaKey: string | null;
}

export interface ParsedMedia {
  kind: MediaKind;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  ref: MediaRef;
}

interface ParsedBase {
  groupJid: string;
  waMessageId: string;
  senderHash: string;
  sentAt: Date;
}

/** What capture should do with an incoming WhatsApp message. */
export type ParsedMessage =
  | (ParsedBase & {
      kind: 'message';
      text: string | null;
      quotedWaMessageId: string | null;
      isForwarded: boolean;
      media: ParsedMedia | null;
    })
  | (ParsedBase & { kind: 'edit'; editOfWaMessageId: string; text: string | null })
  | { kind: 'revoke'; groupJid: string; targetWaMessageId: string }
  | { kind: 'ignore'; reason: string };

const MEDIA_FIELDS = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
} as const satisfies Partial<Record<keyof proto.IMessage, MediaKind>>;

type MediaField = keyof typeof MEDIA_FIELDS;

/** WhatsApp sends sizes and timestamps as numbers or 64-bit `Long` objects. */
const toNumber = (value: number | { toString(): string } | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value.toString());

const base64 = (bytes: Uint8Array | null | undefined): string | null =>
  bytes && bytes.length > 0 ? Buffer.from(bytes).toString('base64') : null;

/** Text of a message, or the caption of its media. Empty text becomes null. */
function textOf(content: proto.IMessage): string | null {
  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    null;
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

function mediaOf(content: proto.IMessage): ParsedMedia | null {
  for (const field of Object.keys(MEDIA_FIELDS) as MediaField[]) {
    const media = content[field];
    if (!media) continue;
    const kind = MEDIA_FIELDS[field];
    return {
      kind,
      mimeType: media.mimetype ?? null,
      fileName: field === 'documentMessage' ? (content.documentMessage?.fileName ?? null) : null,
      sizeBytes: toNumber(media.fileLength),
      ref: {
        kind,
        url: media.url ?? null,
        directPath: media.directPath ?? null,
        mediaKey: base64(media.mediaKey),
      },
    };
  }
  return null;
}

function contextInfoOf(content: proto.IMessage): proto.IContextInfo | null {
  const type = getContentType(content);
  if (!type) return null;
  const inner = content[type];
  if (inner && typeof inner === 'object' && 'contextInfo' in inner) {
    return inner.contextInfo ?? null;
  }
  return null;
}

/**
 * Turns a raw Baileys message into what capture stores, or explains why it
 * is ignored. Pure function: no I/O, so it is fully unit-tested.
 *
 * Only group messages from other people are kept. The scraper never posts,
 * and private chats are never stored.
 */
export function parseMessage(message: WAMessage, salt: string): ParsedMessage {
  const { key } = message;
  const groupJid = key.remoteJid ?? '';
  if (!isJidGroup(groupJid)) return { kind: 'ignore', reason: 'not a group message' };
  if (key.fromMe) return { kind: 'ignore', reason: 'sent by this account' };
  if (!key.id) return { kind: 'ignore', reason: 'no message id' };
  if (message.messageStubType) return { kind: 'ignore', reason: 'system notice' };

  const content = normalizeMessageContent(message.message);
  if (!content) return { kind: 'ignore', reason: 'empty message' };

  const protocol = content.protocolMessage;
  if (protocol) {
    const target = protocol.key?.id;
    if (protocol.type === proto.Message.ProtocolMessage.Type.REVOKE && target) {
      return { kind: 'revoke', groupJid, targetWaMessageId: target };
    }
    if (protocol.type !== proto.Message.ProtocolMessage.Type.MESSAGE_EDIT || !target) {
      return { kind: 'ignore', reason: 'protocol message' };
    }
  }

  const identity = senderIdentity(key);
  if (!identity) return { kind: 'ignore', reason: 'unknown sender' };

  const base: ParsedBase = {
    groupJid,
    waMessageId: key.id,
    senderHash: hashSender(salt, identity),
    sentAt: new Date((toNumber(message.messageTimestamp) ?? Date.now() / 1000) * 1000),
  };

  if (protocol?.key?.id) {
    const edited = normalizeMessageContent(protocol.editedMessage);
    return {
      ...base,
      kind: 'edit',
      editOfWaMessageId: protocol.key.id,
      text: edited ? textOf(edited) : null,
    };
  }

  const text = textOf(content);
  const media = mediaOf(content);
  if (!text && !media) return { kind: 'ignore', reason: 'no text or supported media' };

  const context = contextInfoOf(content);
  return {
    ...base,
    kind: 'message',
    text,
    quotedWaMessageId: context?.stanzaId ?? null,
    isForwarded: context?.isForwarded ?? false,
    media,
  };
}
