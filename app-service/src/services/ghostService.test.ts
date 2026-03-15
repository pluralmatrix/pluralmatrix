import { sendGhostMessage } from './ghostService';
import { getBridge, cryptoManager } from '../bot';
import { messageQueue } from './queue/MessageQueue';
import { registerDevice } from '../crypto/crypto-utils';

jest.mock('../bot', () => ({
  getBridge: jest.fn(),
  cryptoManager: {
    getMachine: jest.fn(),
  },
  prisma: {},
}));

jest.mock('./queue/MessageQueue', () => ({
  messageQueue: {
    enqueue: jest.fn(),
  },
}));

jest.mock('../crypto/crypto-utils', () => ({
  registerDevice: jest.fn(),
}));

jest.mock('../config', () => ({
  config: {
    synapseDomain: 'localhost',
  },
}));

describe('ghostService', () => {
  let mockIntent: Record<string, jest.Mock>;
  let mockBotIntent: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockIntent = {
      ensureRegistered: jest.fn().mockResolvedValue(undefined),
      join: jest.fn().mockResolvedValue(undefined),
      setDisplayName: jest.fn().mockResolvedValue(undefined),
      setAvatarUrl: jest.fn().mockResolvedValue(undefined),
    };

    mockBotIntent = {
      invite: jest.fn().mockResolvedValue(undefined),
    };

    (getBridge as jest.Mock).mockReturnValue({
      getIntent: (userId?: string) => {
        if (userId) return mockIntent;
        return mockBotIntent;
      },
    });

    (cryptoManager.getMachine as jest.Mock).mockResolvedValue({
      deviceId: 'TEST_DEVICE_ID',
    });
  });

  const defaultOptions = {
    roomId: '!room:localhost',
    cleanContent: 'Hello world',
    system: { slug: 'sys1', systemTag: 'TAG' },
    member: { slug: 'mem1', name: 'Member One', displayName: 'Display Name', avatarUrl: 'mxc://avatar' },
    asToken: 'token',
    senderId: '@sender:localhost',
  };

  it('should successfully prepare and enqueue a message', async () => {
    await sendGhostMessage(defaultOptions);

    expect(getBridge).toHaveBeenCalled();
    expect(mockIntent.ensureRegistered).toHaveBeenCalled();
    expect(mockIntent.join).toHaveBeenCalledWith('!room:localhost');
    expect(jest.spyOn(cryptoManager, 'getMachine')).toHaveBeenCalledWith('@_plural_sys1_mem1:localhost');
    expect(registerDevice).toHaveBeenCalledWith(mockIntent, 'TEST_DEVICE_ID', expect.anything(), 'mem1');

    expect(mockIntent.setDisplayName).toHaveBeenCalledWith('Display Name TAG');
    expect(mockIntent.setAvatarUrl).toHaveBeenCalledWith('mxc://avatar');

    expect(jest.spyOn(messageQueue, 'enqueue')).toHaveBeenCalledWith(
      '!room:localhost',
      '@sender:localhost',
      mockIntent,
      'Hello world',
      undefined,
      expect.anything(),
      'sys1',
      undefined,
      undefined,
      undefined,
    );
  });

  it('should handle bridge not being initialized', async () => {
    (getBridge as jest.Mock).mockReturnValue(null);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await sendGhostMessage(defaultOptions);

    expect(mockIntent.ensureRegistered).not.toHaveBeenCalled();
    expect(jest.spyOn(messageQueue, 'enqueue')).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should invite ghost if first join fails', async () => {
    mockIntent.join.mockRejectedValueOnce(new Error('M_FORBIDDEN')).mockResolvedValueOnce(undefined);

    await sendGhostMessage(defaultOptions);

    expect(mockIntent.join).toHaveBeenCalledTimes(2);
    expect(mockBotIntent.invite).toHaveBeenCalledWith('!room:localhost', '@_plural_sys1_mem1:localhost');
    expect(jest.spyOn(messageQueue, 'enqueue')).toHaveBeenCalled();
  });

  it('should ignore invite/join failures and still queue message', async () => {
    mockIntent.join.mockRejectedValue(new Error('M_FORBIDDEN'));
    mockBotIntent.invite.mockRejectedValue(new Error('Failed invite'));

    await sendGhostMessage(defaultOptions);

    expect(mockIntent.join).toHaveBeenCalledTimes(1);
    expect(jest.spyOn(messageQueue, 'enqueue')).toHaveBeenCalled(); // Should still try to queue it
  });

  it('should use member name if displayName is not provided', async () => {
    const noDisplayOptions = {
      ...defaultOptions,
      member: { slug: 'mem1', name: 'Member Name Only' },
    };

    await sendGhostMessage(noDisplayOptions);

    expect(mockIntent.setDisplayName).toHaveBeenCalledWith('Member Name Only TAG');
  });

  it('should not set avatar if not provided', async () => {
    const noAvatarOptions = {
      ...defaultOptions,
      member: { slug: 'mem1', name: 'Member', displayName: 'Display' },
    };

    await sendGhostMessage(noAvatarOptions);

    expect(mockIntent.setDisplayName).toHaveBeenCalled();
    expect(mockIntent.setAvatarUrl).not.toHaveBeenCalled();
  });

  it('should ignore profile update failures', async () => {
    mockIntent.setDisplayName.mockRejectedValue(new Error('M_RATELIMIT'));

    await sendGhostMessage(defaultOptions);

    // Should not throw, should continue to enqueue
    expect(jest.spyOn(messageQueue, 'enqueue')).toHaveBeenCalled();
  });

  it('should catch and log unexpected top-level errors', async () => {
    mockIntent.ensureRegistered.mockRejectedValue(new Error('Critical failure'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await sendGhostMessage(defaultOptions);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GhostService] Failed to queue message'),
      'Critical failure',
    );
    expect(jest.spyOn(messageQueue, 'enqueue')).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
