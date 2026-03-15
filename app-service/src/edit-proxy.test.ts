import { handleEvent, prisma, setAsToken, initCommandHandler, cryptoManager } from './bot';
import { proxyCache } from './services/cache';
import { OlmMachine } from '@matrix-org/matrix-sdk-crypto-nodejs';
import { Bridge, Request, WeakEvent } from 'matrix-appservice-bridge';
import { PluralMatrixEventContent } from './types';

// Mock dependencies
const mockBotClient = {
  redactEvent: jest.fn().mockResolvedValue({}),
  getEvent: jest.fn(),
  getRoomStateEvent: jest.fn().mockResolvedValue({}),
  getJoinedRoomMembers: jest.fn().mockResolvedValue([]),
  sendStateEvent: jest.fn().mockResolvedValue({}),
  getUserProfile: jest.fn().mockResolvedValue({ displayname: 'Mock User' }),
  homeserverUrl: 'http://localhost:8008',
  doRequest: jest.fn(),
};

const mockIntent = {
  userId: '@_plural_test_lily:localhost',
  sendText: jest.fn(),
  sendEvent: jest.fn(),
  join: jest.fn().mockResolvedValue({}),
  ensureRegistered: jest.fn(),
  setDisplayName: jest.fn(),
  setAvatarUrl: jest.fn(),
  matrixClient: mockBotClient,
};

const mockBridge = {
  getBot: () => ({
    getUserId: () => '@plural_bot:localhost',
    getClient: () => mockBotClient,
  }),
  getIntent: () => mockIntent,
};

jest.mock('./services/cache', () => ({
  proxyCache: {
    getSystemRules: jest.fn(),
  },
}));

// Mock crypto
jest.mock('./crypto/crypto-utils', () => {
  const actual = jest.requireActual<typeof import('./crypto/crypto-utils')>('./crypto/crypto-utils');
  return {
    ...actual,
    processCryptoRequests: jest.fn(),
    registerDevice: jest.fn().mockResolvedValue(true),
  };
});

jest.spyOn(cryptoManager, 'getMachine').mockResolvedValue({
  deviceId: { toString: () => 'MOCK_DEVICE' },
} as unknown as OlmMachine);

jest.mock('./services/queue/MessageQueue', () => ({
  messageQueue: {
    enqueue: jest.fn(),
  },
}));

import { messageQueue } from './services/queue/MessageQueue';

describe('Proxy on Edit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setAsToken('test_token');
    initCommandHandler(mockBridge as unknown as Bridge, prisma, cryptoManager, 'test_token', 'localhost');
  });

  const mockSystem = {
    slug: 'test',
    members: [
      {
        id: 'm1',
        slug: 'lily',
        name: 'Lily',
        proxyTags: [{ prefix: 'lily:', suffix: '' }],
      },
    ],
  };

  it('should proxy when a message is edited to include a valid prefix', async () => {
    const roomId = '!room:localhost';
    const sender = '@alice:localhost';
    const eventId = '$edit_event';
    const originalId = '$original_event';

    // 1. Mock cache to return our system
    (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);

    // 2. Create an edit event
    const editEvent = {
      event_id: eventId,
      room_id: roomId,
      sender: sender,
      type: 'm.room.message',
      content: {
        body: '* lily: New message after edit',
        msgtype: 'm.text',
        'm.new_content': {
          body: 'lily: New message after edit',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: originalId,
        },
      },
    };

    const req = { getData: () => editEvent } as unknown as Request<WeakEvent>;

    // Mock original event
    mockBotClient.getEvent.mockResolvedValueOnce({
      event_id: originalId,
      sender: sender,
      content: {
        body: 'Old unproxied message',
        msgtype: 'm.text',
      },
    });

    // 3. Handle the event
    await handleEvent(req, mockBridge as unknown as Bridge, prisma);

    // 4. Verify original event was redacted (Matrix server cascades to edit)
    expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, originalId, 'PluralProxy');

    // 5. Verify the message was enqueued for the ghost
    const calls = (messageQueue.enqueue as jest.Mock).mock.calls as unknown[][];
    expect(calls[0][0]).toBe(roomId);
    expect(calls[0][1]).toBe(sender);
    expect(calls[0][2]).toEqual(expect.objectContaining({ userId: '@_plural_test_lily:localhost' }));
    expect(calls[0][3]).toBe('New message after edit');
  });

  it('should properly decrypt original encrypted events during edit to preserve attachments', async () => {
    const roomId = '!room:localhost';
    const sender = '@alice:localhost';
    const eventId = '$edit_event';
    const originalId = '$original_event';

    // 1. Mock cache to return our system
    (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);

    // 2. Create an edit event for an encrypted message
    const editEvent = {
      event_id: eventId,
      room_id: roomId,
      sender: sender,
      type: 'm.room.encrypted',
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'EDIT_CIPHERTEXT',
        body: '* lily: Edited message text',
        'm.new_content': {
          body: 'lily: Edited message text',
          msgtype: 'm.text',
        },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: originalId,
        },
      },
    };

    const req = { getData: () => editEvent } as unknown as Request<WeakEvent>;

    // Mock original event (it is encrypted, so it doesn't have a plaintext body)
    mockBotClient.getEvent.mockResolvedValueOnce({
      event_id: originalId,
      sender: sender,
      type: 'm.room.encrypted',
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'ORIGINAL_CIPHERTEXT',
      },
    });

    // Mock crypto decryption for the original event
    const mockMachine = {
      deviceId: 'TEST_DEVICE',
      decryptRoomEvent: jest.fn().mockResolvedValue({
        event: JSON.stringify({
          type: 'm.room.message',
          content: {
            body: 'Original unproxied message',
            msgtype: 'm.image',
            url: 'mxc://example.com/image',
          },
        }),
      }),
    };
    (cryptoManager.getMachine as jest.Mock).mockResolvedValue(mockMachine);

    // 3. Handle the event
    // Note: isDecrypted = true to bypass the early return for encrypted events
    await handleEvent(req, mockBridge as unknown as Bridge, prisma, true);

    // 4. Verify original event was redacted
    expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, originalId, 'PluralProxy');

    // 5. Verify the message was enqueued with the DECRYPTED base content, NOT the encrypted ciphertext
    const calls = (messageQueue.enqueue as jest.Mock).mock.calls as unknown[][];
    // Ensure we're checking the latest call
    const lastCall = calls[calls.length - 1];

    expect(lastCall[0]).toBe(roomId);
    expect(lastCall[1]).toBe(sender);
    expect(lastCall[3]).toBe('Edited message text'); // The cleanBody

    // The crucial part: fullContent should contain the msgtype and url from the decrypted original event
    const fullContent = lastCall[9] as PluralMatrixEventContent & {
      ciphertext?: string;
      algorithm?: string;
      url?: string;
    };
    expect(fullContent).toBeDefined();
    expect(fullContent.msgtype).toBe('m.image');
    expect(fullContent.url).toBe('mxc://example.com/image');
    expect(fullContent.ciphertext).toBeUndefined(); // Should not have leaked the raw ciphertext
  });
});
