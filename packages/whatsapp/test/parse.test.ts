import { proto, type WAMessage } from 'baileys';
import { describe, expect, it } from 'vitest';
import { hashSender, parseMessage, senderIdentity } from '../src/index.ts';

const SALT = 'test-salt-test-salt-test-salt-123';
const GROUP = '120363000000000001@g.us';
const LID = '111111111111111@lid';
const PN = '201001234567@s.whatsapp.net';

function message(content: proto.IMessage, keyOverrides: Partial<WAMessage['key']> = {}): WAMessage {
  return {
    key: { remoteJid: GROUP, id: 'MSG1', fromMe: false, participant: LID, ...keyOverrides },
    messageTimestamp: 1_792_000_000,
    message: content,
  };
}

describe('parseMessage: plain messages', () => {
  it('parses a text message', () => {
    const parsed = parseMessage(message({ conversation: '  شقة 3 غرف التجمع  ' }), SALT);
    expect(parsed).toEqual({
      kind: 'message',
      groupJid: GROUP,
      waMessageId: 'MSG1',
      senderHash: hashSender(SALT, LID),
      sentAt: new Date(1_792_000_000_000),
      text: 'شقة 3 غرف التجمع',
      quotedWaMessageId: null,
      isForwarded: false,
      media: null,
    });
  });

  it('records the quoted message ID and the forwarded flag of a reply', () => {
    const parsed = parseMessage(
      message({
        extendedTextMessage: {
          text: 'السعر الجديد 7.5 مليون',
          contextInfo: { stanzaId: 'ORIGINAL', isForwarded: true },
        },
      }),
      SALT,
    );
    expect(parsed).toMatchObject({
      kind: 'message',
      text: 'السعر الجديد 7.5 مليون',
      quotedWaMessageId: 'ORIGINAL',
      isForwarded: true,
    });
  });

  it('reads 64-bit (Long-like) timestamps', () => {
    const msg = message({ conversation: 'hi' });
    msg.messageTimestamp = { toString: () => '1792000000' } as unknown as number;
    expect(parseMessage(msg, SALT)).toMatchObject({ sentAt: new Date(1_792_000_000_000) });
  });
});

describe('parseMessage: media', () => {
  it('parses an image with a caption', () => {
    const parsed = parseMessage(
      message({
        imageMessage: {
          caption: 'Mivida price list',
          mimetype: 'image/jpeg',
          fileLength: 204800,
          url: 'https://mmg.whatsapp.net/x',
          directPath: '/v/t62/x',
          mediaKey: new Uint8Array([1, 2, 3]),
        },
      }),
      SALT,
    );
    expect(parsed).toMatchObject({
      kind: 'message',
      text: 'Mivida price list',
      media: {
        kind: 'image',
        mimeType: 'image/jpeg',
        fileName: null,
        sizeBytes: 204800,
        ref: {
          kind: 'image',
          url: 'https://mmg.whatsapp.net/x',
          directPath: '/v/t62/x',
          mediaKey: 'AQID',
        },
      },
    });
  });

  it('keeps an image without a caption', () => {
    const parsed = parseMessage(message({ imageMessage: { mimetype: 'image/png' } }), SALT);
    expect(parsed).toMatchObject({ kind: 'message', text: null, media: { kind: 'image' } });
  });

  it('parses a PDF sent with a caption (documentWithCaptionMessage wrapper)', () => {
    const parsed = parseMessage(
      message({
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              caption: 'Payment plans',
              fileName: 'ZED-East-prices.pdf',
              mimetype: 'application/pdf',
              fileLength: 1_000_000,
            },
          },
        },
      }),
      SALT,
    );
    expect(parsed).toMatchObject({
      kind: 'message',
      text: 'Payment plans',
      media: { kind: 'document', fileName: 'ZED-East-prices.pdf', mimeType: 'application/pdf' },
    });
  });

  it('parses a voice note as audio', () => {
    const parsed = parseMessage(
      message({ audioMessage: { ptt: true, mimetype: 'audio/ogg; codecs=opus', seconds: 12 } }),
      SALT,
    );
    expect(parsed).toMatchObject({ kind: 'message', text: null, media: { kind: 'audio' } });
  });

  it('unwraps disappearing and view-once messages', () => {
    const ephemeral = parseMessage(
      message({ ephemeralMessage: { message: { conversation: 'disappearing' } } }),
      SALT,
    );
    expect(ephemeral).toMatchObject({ kind: 'message', text: 'disappearing' });
    const viewOnce = parseMessage(
      message({ viewOnceMessageV2: { message: { imageMessage: { caption: 'once' } } } }),
      SALT,
    );
    expect(viewOnce).toMatchObject({ kind: 'message', text: 'once', media: { kind: 'image' } });
  });
});

describe('parseMessage: edits and deletions', () => {
  it('turns an edit into an edit record pointing at the original', () => {
    const parsed = parseMessage(
      message(
        {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            key: { id: 'ORIGINAL', remoteJid: GROUP },
            editedMessage: { conversation: 'Updated: 6.9M' },
          },
        },
        { id: 'EDIT1' },
      ),
      SALT,
    );
    expect(parsed).toMatchObject({
      kind: 'edit',
      waMessageId: 'EDIT1',
      editOfWaMessageId: 'ORIGINAL',
      text: 'Updated: 6.9M',
    });
  });

  it('turns "delete for everyone" into a revoke', () => {
    const parsed = parseMessage(
      message({
        protocolMessage: {
          type: proto.Message.ProtocolMessage.Type.REVOKE,
          key: { id: 'ORIGINAL', remoteJid: GROUP },
        },
      }),
      SALT,
    );
    expect(parsed).toEqual({ kind: 'revoke', groupJid: GROUP, targetWaMessageId: 'ORIGINAL' });
  });
});

describe('parseMessage: ignored messages', () => {
  it.each<[string, WAMessage, string]>([
    ['private chat', message({ conversation: 'hi' }, { remoteJid: PN }), 'not a group message'],
    [
      'status update',
      message({ conversation: 'hi' }, { remoteJid: 'status@broadcast' }),
      'not a group message',
    ],
    ['own message', message({ conversation: 'hi' }, { fromMe: true }), 'sent by this account'],
    [
      'sticker',
      message({ stickerMessage: { mimetype: 'image/webp' } }),
      'no text or supported media',
    ],
    [
      'reaction',
      message({ reactionMessage: { text: '👍', key: { id: 'X' } } }),
      'no text or supported media',
    ],
    ['whitespace only', message({ conversation: '   ' }), 'no text or supported media'],
    [
      'other protocol message',
      message({ protocolMessage: { type: proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING } }),
      'protocol message',
    ],
    ['no sender', message({ conversation: 'hi' }, { participant: undefined }), 'unknown sender'],
  ])('ignores a %s', (_label, msg, reason) => {
    expect(parseMessage(msg, SALT)).toEqual({ kind: 'ignore', reason });
  });

  it('ignores group system notices (member added, name changed...)', () => {
    const msg = message({});
    msg.messageStubType = proto.WebMessageInfo.StubType.GROUP_PARTICIPANT_ADD;
    expect(parseMessage(msg, SALT)).toEqual({ kind: 'ignore', reason: 'system notice' });
  });
});

describe('sender identity and hashing', () => {
  it('prefers the LID whether it is the main or the alternate ID', () => {
    expect(senderIdentity({ participant: LID, participantAlt: PN })).toBe(LID);
    expect(senderIdentity({ participant: PN, participantAlt: LID })).toBe(LID);
  });

  it('falls back to the phone-number ID when there is no LID', () => {
    expect(senderIdentity({ participant: PN })).toBe(PN);
  });

  it("strips the device suffix so all of a sender's devices hash the same", () => {
    expect(senderIdentity({ participant: '201001234567:12@s.whatsapp.net' })).toBe(PN);
  });

  it('never stores the phone number: the hash is salted and one-way', () => {
    const hash = hashSender(SALT, PN);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('201001234567');
    expect(hashSender('another-salt-another-salt-another', PN)).not.toBe(hash);
  });

  it('gives one sender the same hash on the main and alternate ID', () => {
    const a = parseMessage(
      message({ conversation: 'a' }, { participant: LID, participantAlt: PN }),
      SALT,
    );
    const b = parseMessage(
      message({ conversation: 'b' }, { participant: PN, participantAlt: LID }),
      SALT,
    );
    expect(a.kind === 'message' && b.kind === 'message' && a.senderHash === b.senderHash).toBe(
      true,
    );
  });
});
