import { CommandHandler } from './services/commandHandler';
import { lastMessageCache } from './services/cache';
import { createMockSystem, createMockMember, createMockGroup } from './test/factories';
import { SystemWithRelations } from './types';

jest.mock('./services/cache', () => ({
  proxyCache: { invalidate: jest.fn(), getSystemRules: jest.fn() },
  lastMessageCache: {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('./import', () => ({
  syncGhostProfile: jest.fn().mockResolvedValue(undefined),
  decommissionGhost: jest.fn().mockResolvedValue(undefined),
  migrateAvatar: jest.fn().mockResolvedValue({ mxcUrl: 'mxc://mocked/avatar' }),
  generateSlug: jest.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '-')),
}));

jest.mock('./crypto/encryption', () => ({
  sendEncryptedEvent: jest.fn().mockResolvedValue({ event_id: '$mock_encrypted_event' }),
}));

jest.mock('./crypto/crypto-utils', () => ({
  registerDevice: jest.fn().mockResolvedValue(undefined),
  decryptHistoricalEvent: jest.fn((e: unknown) => e),
}));

describe('CommandHandler Tests', () => {
  let commandHandler: CommandHandler;
  let mockBridge: { getBot: jest.Mock; getIntent: jest.Mock };
  let mockPrisma: {
    system: Record<string, jest.Mock>;
    member: Record<string, jest.Mock>;
    group: Record<string, jest.Mock>;
    accountLink: Record<string, jest.Mock>;
    switch: Record<string, jest.Mock>;
    switchMember: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let mockCryptoManager: { getMachine: jest.Mock };
  let mockBotClient: {
    getUserId: jest.Mock;
    uploadContent: jest.Mock;
    redactEvent: jest.Mock;
    getEvent: jest.Mock;
    getUserProfile: jest.Mock;
    getRoomStateEvent: jest.Mock;
    getJoinedRoomMembers: jest.Mock;
    homeserverUrl: string;
    doRequest: jest.Mock;
    sendStateEvent?: jest.Mock;
  };
  const asToken = 'mock_token';
  const domain = 'localhost';

  beforeEach(() => {
    jest.clearAllMocks();

    mockBotClient = {
      getUserId: jest.fn().mockReturnValue('@plural_bot:localhost'),
      uploadContent: jest.fn().mockResolvedValue('mxc://mock/avatar'),
      redactEvent: jest.fn().mockResolvedValue({}),
      getEvent: jest.fn(),
      getUserProfile: jest.fn(),
      getRoomStateEvent: jest.fn().mockResolvedValue({ algorithm: 'm.megolm.v1.aes-sha2' }),
      getJoinedRoomMembers: jest.fn().mockResolvedValue(['@alice:localhost', '@_plural_seraphim_lily:localhost']),
      homeserverUrl: 'http://localhost:8008',
      doRequest: jest.fn(),
    };

    const createMockIntent = (userId: string) => ({
      userId: userId,
      sendEvent: jest.fn().mockResolvedValue({ event_id: '$new_event' }),
      sendText: jest.fn(),
      join: jest.fn(),
      ensureRegistered: jest.fn(),
      setDisplayName: jest.fn(),
      setAvatarUrl: jest.fn(),
      matrixClient: mockBotClient,
    });

    mockBridge = {
      getBot: jest.fn().mockReturnValue({
        getUserId: () => '@plural_bot:localhost',
        getClient: () => mockBotClient,
        getIntent: () => createMockIntent('@plural_bot:localhost'),
      }),
      getIntent: jest.fn().mockImplementation((userId?: string) => createMockIntent(userId || '@plural_bot:localhost')),
    };

    mockPrisma = {
      system: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        create: jest.fn(),
      },
      member: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        create: jest.fn(),
      },
      group: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      accountLink: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      switch: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      switchMember: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (prisma: unknown) => unknown)(mockPrisma as unknown);
        }
        return Promise.all(cb as Promise<unknown>[]);
      }),
    };

    mockCryptoManager = {
      getMachine: jest.fn().mockResolvedValue({
        deviceId: { toString: () => 'MOCK_DEVICE' },
        decryptRoomEvent: jest.fn().mockResolvedValue({
          event: JSON.stringify({ type: 'm.room.message', content: { body: 'Decrypted Text' } }),
        }),
        receiveSyncChanges: jest.fn().mockResolvedValue({ event_id: '$event' }),
        updateTrackedUsers: jest.fn().mockResolvedValue({ event_id: '$event' }),
        getMissingSessions: jest.fn().mockResolvedValue({ event_id: '$event' }),
        shareRoomKey: jest.fn().mockResolvedValue([]),
        encryptRoomEvent: jest.fn().mockResolvedValue(JSON.stringify({ content: { body: 'Encrypted' } })),
        outgoingRequests: jest.fn().mockResolvedValue([]),
      }),
    };

    commandHandler = new CommandHandler(
      mockBridge as unknown as ConstructorParameters<typeof CommandHandler>[0],
      mockPrisma as unknown as ConstructorParameters<typeof CommandHandler>[1],
      mockCryptoManager as unknown as ConstructorParameters<typeof CommandHandler>[2],
      asToken,
      domain,
    );
  });

  const mockSystem = createMockSystem({
    id: 'sys123',
    slug: 'seraphim',
    members: [
      createMockMember({
        id: 'mem1',
        slug: 'lily',
        name: 'Lily',
        matrixId: '@_plural_seraphim_lily:localhost',
        proxyTags: [{ prefix: 'lily:', suffix: '' }] as unknown as import('@prisma/client').Prisma.JsonValue,
      }),
    ],
  }) as SystemWithRelations & { accountLinks: { matrixId: string; isPrimary: boolean }[] };
  mockSystem.accountLinks = [{ matrixId: '@alice:localhost', isPrimary: true }];

  describe('executeTargetingCommand', () => {
    it('should find the ROOT ID even if the latest event is an edit', async () => {
      const rootId = '$root_event';
      const editId = '$edit_event';
      const roomId = '!room:localhost';

      // Mock scrollback: root followed by edit
      mockBotClient.doRequest.mockResolvedValue({
        chunk: [
          {
            event_id: editId,
            sender: '@_plural_seraphim_lily:localhost',
            type: 'm.room.message',
            content: {
              'm.new_content': { body: 'new text' },
              'm.relates_to': { rel_type: 'm.replace', event_id: rootId },
            },
          },
          {
            event_id: rootId,
            sender: '@_plural_seraphim_lily:localhost',
            type: 'm.room.message',
            content: { body: 'original text' },
          },
        ],
      });

      const event = { room_id: roomId, sender: '@alice:localhost', event_id: '$cmd_event' };
      await commandHandler.executeTargetingCommand(event, 'pk;message -delete', mockSystem);

      // Should redact the ROOT event
      expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, expect.anything());
    });

    it('should correctly resolve chained edits from history', async () => {
      const rootId = '$root';
      const edit2Id = '$edit2';
      const roomId = '!room:localhost';

      mockBotClient.doRequest.mockResolvedValue({
        chunk: [
          {
            event_id: edit2Id,
            sender: '@_plural_seraphim_lily:localhost',
            type: 'm.room.message',
            content: {
              'm.new_content': { body: 'final text' },
              'm.relates_to': { rel_type: 'm.replace', event_id: rootId },
            },
          },
          {
            event_id: rootId,
            sender: '@_plural_seraphim_lily:localhost',
            type: 'm.room.message',
            content: { body: 'start text' },
          },
        ],
      });

      const event = { room_id: roomId, sender: '@alice:localhost', event_id: '$cmd_event' };
      await commandHandler.executeTargetingCommand(event, 'pk;edit newer text', mockSystem);

      // Verify crypto getMachine was called for the ghost to send the edit
      expect(mockCryptoManager.getMachine).toHaveBeenCalledWith('@_plural_seraphim_lily:localhost');
    });

    it("should not allow editing another system's message", async () => {
      const roomId = '!room:localhost';
      const eventId = '$target_event';
      const foreignGhostId = '@_plural_othersys_member:localhost';

      mockBotClient.getEvent.mockResolvedValue({
        event_id: eventId,
        sender: foreignGhostId,
        type: 'm.room.message',
        content: { body: 'hello from other sys' },
      });

      const event = {
        room_id: roomId,
        sender: '@alice:localhost',
        content: { 'm.relates_to': { 'm.in_reply_to': { event_id: eventId } } },
      };

      const sendSpy = jest.spyOn(commandHandler, 'sendEncryptedText').mockResolvedValue({ event_id: '$event' });

      await commandHandler.executeTargetingCommand(event, 'pk;edit hack', mockSystem);

      expect(mockBotClient.redactEvent).not.toHaveBeenCalled();
      expect(sendSpy).toHaveBeenCalledWith(
        expect.anything(),
        roomId,
        expect.stringContaining('Could not find a proxied message to modify'),
      );

      sendSpy.mockRestore();
    });

    it("should not allow reproxying another system's message", async () => {
      const roomId = '!room:localhost';
      const eventId = '$target_event';
      const foreignGhostId = '@_plural_othersys_member:localhost';

      mockBotClient.getEvent.mockResolvedValue({
        event_id: eventId,
        sender: foreignGhostId,
        type: 'm.room.message',
        content: { body: 'hello from other sys' },
      });

      const event = {
        room_id: roomId,
        sender: '@alice:localhost',
        content: { 'm.relates_to': { 'm.in_reply_to': { event_id: eventId } } },
      };

      const sendSpy = jest.spyOn(commandHandler, 'sendEncryptedText').mockResolvedValue({ event_id: '$event' });

      await commandHandler.executeTargetingCommand(event, 'pk;rp lily', mockSystem);

      expect(mockBotClient.redactEvent).not.toHaveBeenCalled();
      expect(sendSpy).toHaveBeenCalledWith(
        expect.anything(),
        roomId,
        expect.stringContaining('Could not find a proxied message to modify'),
      );

      sendSpy.mockRestore();
    });

    it("should not allow deleting another system's message", async () => {
      const roomId = '!room:localhost';
      const eventId = '$target_event';
      const foreignGhostId = '@_plural_othersys_member:localhost';

      mockBotClient.getEvent.mockResolvedValue({
        event_id: eventId,
        sender: foreignGhostId,
        type: 'm.room.message',
        content: { body: 'hello from other sys' },
      });

      const event = {
        room_id: roomId,
        sender: '@alice:localhost',
        content: { 'm.relates_to': { 'm.in_reply_to': { event_id: eventId } } },
      };

      const sendSpy = jest.spyOn(commandHandler, 'sendEncryptedText').mockResolvedValue({ event_id: '$event' });

      await commandHandler.executeTargetingCommand(event, 'pk;message -delete', mockSystem);

      expect(mockBotClient.redactEvent).not.toHaveBeenCalled();
      // Since resolution is strictly scoped to the user's system for -delete, it fails to find it entirely
      expect(sendSpy).toHaveBeenCalledWith(
        expect.anything(),
        roomId,
        expect.stringContaining('Could not find that proxied message'),
      );

      sendSpy.mockRestore();
    });
  });

  describe('handleCommand', () => {
    it('pk;list should show member list', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;list'];

      await commandHandler.handleCommand(event, 'list', parts, mockSystem);

      // Should call resolveIdentity for the bot (to send encrypted response)
      expect(mockPrisma.system.findFirst).toHaveBeenCalled();
    });

    it('pk;link should create a new link', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;link', '@bob:localhost'];

      mockPrisma.accountLink.findUnique.mockResolvedValue(null);
      mockBotClient.getUserProfile.mockResolvedValue({ displayname: 'Bob' });

      await commandHandler.handleCommand(event, 'link', parts, mockSystem);

      expect(mockPrisma.accountLink.create).toHaveBeenCalledWith({
        data: { matrixId: '@bob:localhost', systemId: 'sys123' },
      });
    });

    it('pk;link should fail if profile does not exist', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;link', '@nonexistent:localhost'];

      mockBotClient.getUserProfile.mockRejectedValue({ errcode: 'M_NOT_FOUND' });

      await commandHandler.handleCommand(event, 'link', parts, mockSystem);

      expect(mockPrisma.accountLink.create).not.toHaveBeenCalled();
      // Should send an error message
      expect(mockCryptoManager.getMachine).toHaveBeenCalledWith('@plural_bot:localhost');
    });

    it('pk;unlink should remove a link', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;unlink', '@bob:localhost'];

      mockPrisma.accountLink.findUnique.mockResolvedValue({ matrixId: '@bob:localhost', systemId: 'sys123' });
      mockPrisma.accountLink.count.mockResolvedValue(2); // Must be > 1 to allow unlinking

      await commandHandler.handleCommand(event, 'unlink', parts, mockSystem);

      expect(mockPrisma.accountLink.delete).toHaveBeenCalledWith({
        where: { matrixId: '@bob:localhost' },
      });
    });

    it('pk;message -delete should invalidate cache if target is current last message', async () => {
      const roomId = '!room:localhost';
      const rootId = '$root';
      const ghostUserId = '@_plural_seraphim_lily:localhost';
      const event = { room_id: roomId, sender: '@alice:localhost' };

      // Mock identity resolution
      mockPrisma.member.findFirst.mockResolvedValue({ id: 'mem1', systemId: 'sys123' });

      // Mock cache hit for this exact message
      (lastMessageCache.get as jest.Mock).mockReturnValue({
        rootEventId: rootId,
        latestEventId: rootId,
        sender: ghostUserId,
        latestContent: { body: 'del me' },
        rootContent: { body: 'del me' },
      });

      jest.spyOn(commandHandler, 'getRoomMessages').mockResolvedValue({
        chunk: [
          {
            event_id: rootId,
            room_id: roomId,
            sender: ghostUserId,
            type: 'm.room.message',
            content: { body: 'del me' },
          },
        ],
      });

      await commandHandler.executeTargetingCommand(event, 'pk;message -delete', mockSystem);

      expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, expect.anything());
      // Should invalidate cache
      expect(jest.spyOn(lastMessageCache, 'delete')).toHaveBeenCalledWith(roomId, 'seraphim');
    });

    it('pk;reproxy should invalidate cache', async () => {
      const roomId = '!room:localhost';
      const rootId = '$root';
      const ghostUserId = '@_plural_seraphim_lily:localhost';
      const event = { room_id: roomId, sender: '@alice:localhost' };

      mockPrisma.member.findFirst.mockResolvedValue({ id: 'mem1', systemId: 'sys123' });

      // Mock cache hit
      (lastMessageCache.get as jest.Mock).mockReturnValue({
        rootEventId: rootId,
        latestEventId: rootId,
        sender: ghostUserId,
        latestContent: { body: 'reproxy me' },
      });

      // Reproxy to a hypothetical member 'bob'
      const systemWithBob = createMockSystem({
        ...mockSystem,
        members: [
          ...mockSystem.members,
          createMockMember({ id: 'mem2', slug: 'bob', name: 'Bob', matrixId: '@_plural_seraphim_bob:localhost' }),
        ],
      });

      await commandHandler.executeTargetingCommand(event, 'pk;rp bob', systemWithBob);

      expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, expect.anything());
      expect(jest.spyOn(lastMessageCache, 'delete')).toHaveBeenCalledWith(roomId, 'seraphim');
    }, 15000);

    it('pk;autoproxy should update autoproxyId', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;autoproxy', 'lily'];

      await commandHandler.handleCommand(event, 'autoproxy', parts, mockSystem);

      expect(mockPrisma.system.update).toHaveBeenCalledWith({
        where: { id: 'sys123' },
        data: { autoproxyId: 'mem1', autoproxyMode: 'member' },
      });
    });

    describe('pk;autoproxy edge cases', () => {
      let sendEncryptedTextSpy: jest.SpyInstance;
      beforeEach(() => {
        sendEncryptedTextSpy = jest
          .spyOn(commandHandler, 'sendEncryptedText')
          .mockResolvedValue({ event_id: '$event' });
      });

      it('pk;autoproxy off should disable autoproxy', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;autoproxy', 'off'];

        await commandHandler.handleCommand(event, 'autoproxy', parts, mockSystem);

        expect(mockPrisma.system.update).toHaveBeenCalledWith({
          where: { id: 'sys123' },
          data: { autoproxyId: null, autoproxyMode: 'off' },
        });
      });

      it('pk;autoproxy latch should enable latch mode', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;autoproxy', 'latch'];

        await commandHandler.handleCommand(event, 'autoproxy', parts, mockSystem);

        expect(mockPrisma.system.update).toHaveBeenCalledWith({
          where: { id: 'sys123' },
          data: { autoproxyMode: 'latch' },
        });
      });

      it('pk;autoproxy front should enable front mode', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;autoproxy', 'front'];

        await commandHandler.handleCommand(event, 'autoproxy', parts, mockSystem);

        expect(mockPrisma.system.update).toHaveBeenCalledWith({
          where: { id: 'sys123' },
          data: { autoproxyMode: 'front' },
        });
      });

      it('pk;autoproxy should error if member not found', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;autoproxy', 'notfound'];

        const handled = await commandHandler.handleCommand(event, 'autoproxy', parts, mockSystem);
        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('No member found with ID: notfound'),
        );
      });
    });

    describe('pk;member command', () => {
      let sendRichTextSpy: jest.SpyInstance;

      beforeEach(() => {
        sendRichTextSpy = jest.spyOn(commandHandler, 'sendRichText').mockResolvedValue({ event_id: '$event' });
      });

      it('should display own member details', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;member', 'lily'];

        const handled = await commandHandler.handleCommand(event, 'member', parts, mockSystem);

        expect(handled).toBe(true);
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Member Details: Lily'),
        );
      });

      it('should handle member not found error', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;member', 'nonexistent'];

        const sendEncryptedTextSpy = jest
          .spyOn(commandHandler, 'sendEncryptedText')
          .mockResolvedValue({ event_id: '$event' });
        const handled = await commandHandler.handleCommand(event, 'member', parts, mockSystem);

        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('No member found with ID or name: nonexistent'),
        );
      });

      it('should error if no member ID is provided', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;member'];

        const sendEncryptedTextSpy = jest
          .spyOn(commandHandler, 'sendEncryptedText')
          .mockResolvedValue({ event_id: '$event' });
        const handled = await commandHandler.handleCommand(event, 'member', parts, mockSystem);

        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Usage: `pk;member <id>`'),
        );
      });

      it('should log an error if avatar sending fails', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;member', 'lily'];

        const systemWithAvatar = createMockSystem({
          ...mockSystem,
          members: [createMockMember({ id: 'm1', slug: 'lily', name: 'Lily', avatarUrl: 'mxc://broken' })],
        });

        const sendEncryptedImageSpy = jest
          .spyOn(commandHandler, 'sendEncryptedImage')
          .mockRejectedValue(new Error('Avatar Upload Fail'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const handled = await commandHandler.handleCommand(event, 'member', parts, systemWithAvatar);

        expect(handled).toBe(true);
        expect(sendEncryptedImageSpy).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[Bot] Failed to send avatar for lily:'),
          'Avatar Upload Fail',
        );

        consoleSpy.mockRestore();
      });

      it('should respect privacy settings for external queries', async () => {
        const event = { room_id: '!room:localhost', sender: '@bob:localhost' }; // Bob querying Alice's member
        const parts = ['pk;member', 'abcde']; // Global pkId query

        // Mock global search finding Alice's member
        const privateMember = {
          id: 'mem1',
          slug: 'lily',
          name: 'Lily',
          pkId: 'abcde',
          system: mockSystem,
          privacy: { visibility: 'private' },
        };

        // Mock the getSenderSystem hit for bob (null) so he doesn't hit the "no system" global check before running the command
        mockPrisma.accountLink.findUnique.mockResolvedValueOnce(null);
        mockPrisma.member.findMany.mockResolvedValue([privateMember]);

        const sendEncryptedTextSpy = jest
          .spyOn(commandHandler, 'sendEncryptedText')
          .mockResolvedValue({ event_id: '$event' });
        const handled = await commandHandler.handleCommand(
          event,
          'member',
          parts,
          createMockSystem({ id: 'bobsys', members: [] }),
        );

        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('No member found with ID or name: abcde'),
        );
      });

      it('should fallback to displayName if name is private for external queries', async () => {
        const event = { room_id: '!room:localhost', sender: '@bob:localhost' };
        const parts = ['pk;member', 'abcde'];

        const namePrivateMember = {
          id: 'mem1',
          slug: 'lily',
          name: 'Secret Name',
          displayName: 'Public Face',
          pkId: 'abcde',
          system: mockSystem,
          privacy: { visibility: 'public', name_privacy: 'private' },
        };

        mockPrisma.accountLink.findUnique.mockResolvedValueOnce(null);
        mockPrisma.member.findMany.mockResolvedValue([namePrivateMember]);

        const handled = await commandHandler.handleCommand(
          event,
          'member',
          parts,
          createMockSystem({ id: 'bobsys', members: [] }),
        );

        expect(handled).toBe(true);
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Member Details: Public Face'),
        );
        expect(sendRichTextSpy).not.toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Secret Name'),
        );
      });

      it('should create a new member with pk;member new', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;member', 'new', 'New Member'];

        mockPrisma.member.create.mockResolvedValueOnce(
          createMockMember({ id: 'new1', slug: 'new-member', name: 'New Member' }),
        );

        const handled = await commandHandler.handleCommand(event, 'member', parts, mockSystem);

        expect(handled).toBe(true);
        expect(mockPrisma.member.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ name: 'New Member' }) as unknown }),
        );
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('✅ Created member **New Member**'),
        );
        const { syncGhostProfile } = await import('./import');
        expect(syncGhostProfile).toHaveBeenCalled();
      });

      it('should rename a member', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;member', 'lily', 'rename', 'Lilypad'];

        const handled = await commandHandler.handleCommand(event, 'member', parts, mockSystem);

        expect(handled).toBe(true);
        expect(mockPrisma.member.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'mem1' },
            data: { name: 'Lilypad' },
          }),
        );
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('✅ Member renamed to **Lilypad**.'),
        );
      });

      it('should add proxy tags', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;member', 'lily', 'proxy', 'add', '[text]'];

        const handled = await commandHandler.handleCommand(event, 'member', parts, mockSystem);

        expect(handled).toBe(true);
        expect(mockPrisma.member.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'mem1' },
            data: {
              proxyTags: [
                { prefix: 'lily:', suffix: '' },
                { prefix: '[', suffix: ']' },
              ],
            },
          }),
        );
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('✅ Proxy tags updated'),
        );
      });

      it('should ask for confirmation when deleting a member without flag', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;member', 'lily', 'delete'];

        const handled = await commandHandler.handleCommand(event, 'member', parts, mockSystem);

        expect(handled).toBe(true);
        expect(mockPrisma.member.delete).not.toHaveBeenCalled();
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('⚠️ Are you sure you want to delete **Lily**?'),
        );
      });

      it('should delete a member with -confirm flag', async () => {
        const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
        const parts = ['pk;member', 'lily', 'delete', '-confirm'];

        const handled = await commandHandler.handleCommand(event, 'member', parts, mockSystem);

        expect(handled).toBe(true);
        const { decommissionGhost } = await import('./import');
        expect(decommissionGhost).toHaveBeenCalled();
        expect(mockPrisma.member.delete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mem1' } }));
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('✅ Member **Lily** deleted.'),
        );
      });
    });

    describe('pk;group commands', () => {
      let sendRichTextSpy: jest.SpyInstance;
      let sendEncryptedTextSpy: jest.SpyInstance;

      beforeEach(() => {
        sendRichTextSpy = jest.spyOn(commandHandler, 'sendRichText').mockResolvedValue({ event_id: '$event' });
        sendEncryptedTextSpy = jest
          .spyOn(commandHandler, 'sendEncryptedText')
          .mockResolvedValue({ event_id: '$event' });
      });

      const mockSystemWithGroups = createMockSystem({
        id: 'sys1',
        name: 'Test System',
        members: [createMockMember({ id: 'm1', slug: 'lily', name: 'Lily' })],
        groups: [
          createMockGroup({
            id: 'g1',
            slug: 'testgroup',
            name: 'Test Group',
            members: [createMockMember({ id: 'm1', slug: 'lily', name: 'Lily' })],
          }),
          createMockGroup({ id: 'g2', slug: 'emptygroup', name: 'Empty Group', members: [] }),
        ],
      });
      const groupEvent = { room_id: '!room:localhost', sender: '@alice:localhost' };

      it('pk;group list should show groups', async () => {
        const parts = ['pk;group', 'list'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Test Group'),
        );
      });

      it('pk;group list should report empty if no groups', async () => {
        const parts = ['pk;group', 'list'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, {
          ...mockSystemWithGroups,
          groups: [],
        });
        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining("You don't have any groups"),
        );
      });

      it('pk;group <group> list should show members', async () => {
        const parts = ['pk;group', 'testgroup', 'list'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Lily'),
        );
      });

      it('pk;group <group> list should report empty if no members', async () => {
        const parts = ['pk;group', 'emptygroup', 'list'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('has no members'),
        );
      });

      it('pk;group new should create a group', async () => {
        const parts = ['pk;group', 'new', 'My New Group'];
        mockPrisma.group.create.mockResolvedValue({ id: 'g2', name: 'My New Group' });
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(mockPrisma.group.create).toHaveBeenCalled();
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Created group'),
        );
      });

      it('pk;group new without name should error', async () => {
        const parts = ['pk;group', 'new'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Usage: `pk;group new'),
        );
      });

      it('pk;group <group> should show error if group not found', async () => {
        const parts = ['pk;group', 'notfoundgroup'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('No group found with ID: notfoundgroup'),
        );
      });

      it('pk;group <group> add should add members', async () => {
        const parts = ['pk;group', 'testgroup', 'add', 'lily'];
        mockPrisma.group.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(mockPrisma.group.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { members: { connect: [{ id: 'm1' }] } },
          }),
        );
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Added 1 member'),
        );
      });

      it('pk;group <group> remove should remove members', async () => {
        const parts = ['pk;group', 'testgroup', 'remove', 'lily'];
        mockPrisma.group.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(mockPrisma.group.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { members: { disconnect: [{ id: 'm1' }] } },
          }),
        );
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Removed 1 member'),
        );
      });

      it('pk;group <group> add without args should error', async () => {
        const parts = ['pk;group', 'testgroup', 'add'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Usage: `pk;group testgroup add'),
        );
      });

      it('pk;group <group> should show error if no members found', async () => {
        const parts = ['pk;group', 'testgroup', 'add', 'notfound'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('None of the specified members were found'),
        );
      });

      it('pk;group <group> rename should rename the group', async () => {
        const parts = ['pk;group', 'testgroup', 'rename', 'New Name'];
        mockPrisma.group.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(mockPrisma.group.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { name: 'New Name' },
          }),
        );
      });

      it('pk;group <group> rename without args should error', async () => {
        const parts = ['pk;group', 'testgroup', 'rename'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Usage: `pk;group testgroup rename'),
        );
      });

      it('pk;group <group> description should update description', async () => {
        const parts = ['pk;group', 'testgroup', 'desc', 'New description'];
        mockPrisma.group.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(mockPrisma.group.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { description: 'New description' },
          }),
        );
      });

      it('pk;group <group> description empty should clear description', async () => {
        const parts = ['pk;group', 'testgroup', 'desc'];
        mockPrisma.group.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(mockPrisma.group.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { description: null },
          }),
        );
      });

      it('pk;group <group> icon should update icon', async () => {
        const parts = ['pk;group', 'testgroup', 'icon', 'mxc://icon'];
        mockPrisma.group.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(mockPrisma.group.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { icon: 'mxc://icon' },
          }),
        );
      });

      it('pk;group <group> delete should delete the group', async () => {
        const parts = ['pk;group', 'testgroup', 'delete'];
        mockPrisma.group.delete.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(mockPrisma.group.delete).toHaveBeenCalledWith({
          where: { id: 'g1' },
        });
      });

      it('pk;group <group> unknown action should show error', async () => {
        const parts = ['pk;group', 'testgroup', 'hack'];
        const handled = await commandHandler.handleCommand(groupEvent, 'group', parts, mockSystemWithGroups);
        expect(handled).toBe(true);
        expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('Unknown group action: hack'),
        );
      });
    });

    describe('pk;system commands', () => {
      let sendRichTextSpy: jest.SpyInstance;

      beforeEach(() => {
        sendRichTextSpy = jest.spyOn(commandHandler, 'sendRichText').mockResolvedValue({ event_id: '$event' });
      });

      const mockSystemExtended = createMockSystem({
        id: 'sys1',
        slug: 'testsys',
        name: 'Test System',
        description: 'A test system',
        systemTag: '🚀',
        members: [createMockMember({ id: 'm1', slug: 'lily', name: 'Lily' })],
      });
      const sysEvent = { room_id: '!room:localhost', sender: '@alice:localhost' };

      it('pk;system should show system info', async () => {
        const parts = ['pk;system'];
        const handled = await commandHandler.handleCommand(sysEvent, 'system', parts, mockSystemExtended);
        expect(handled).toBe(true);
        expect(sendRichTextSpy).toHaveBeenCalledWith(
          expect.anything(),
          '!room:localhost',
          expect.stringContaining('A test system'),
        );
      });

      it('pk;system rename should update system name', async () => {
        const parts = ['pk;system', 'rename', 'New Name'];
        mockPrisma.system.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(sysEvent, 'system', parts, mockSystemExtended);
        expect(handled).toBe(true);
        expect(mockPrisma.system.update).toHaveBeenCalledWith({
          where: { id: 'sys1' },
          data: { name: 'New Name' },
        });
      });

      it('pk;system description should update system description', async () => {
        const parts = ['pk;system', 'description', 'New desc'];
        mockPrisma.system.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(sysEvent, 'system', parts, mockSystemExtended);
        expect(handled).toBe(true);
        expect(mockPrisma.system.update).toHaveBeenCalledWith({
          where: { id: 'sys1' },
          data: { description: 'New desc' },
        });
      });

      it('pk;system tag should update system tag', async () => {
        const parts = ['pk;system', 'tag', '🔖'];
        mockPrisma.system.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(sysEvent, 'system', parts, mockSystemExtended);
        expect(handled).toBe(true);
        expect(mockPrisma.system.update).toHaveBeenCalledWith({
          where: { id: 'sys1' },
          data: { systemTag: '🔖' },
        });
      });

      it('pk;system avatar should update system avatarUrl', async () => {
        const parts = ['pk;system', 'avatar', 'mxc://example.com/123'];
        mockPrisma.system.update.mockResolvedValue({});
        const handled = await commandHandler.handleCommand(sysEvent, 'system', parts, mockSystemExtended);
        expect(handled).toBe(true);
        expect(mockPrisma.system.update).toHaveBeenCalledWith({
          where: { id: 'sys1' },
          data: { avatarUrl: 'mxc://example.com/123' },
        });
      });
    });
  });

  describe('resolveGhostMessage', () => {
    const roomId = '!room:localhost';
    const systemSlug = 'seraphim';

    it('should return data from cache if available (Fast Path)', async () => {
      const cachedData = {
        rootEventId: '$root',
        latestEventId: '$edit',
        latestContent: { body: 'cached text' },
        sender: '@_plural_seraphim_lily:localhost',
      };
      (lastMessageCache.get as jest.Mock).mockReturnValue(cachedData);

      const result = await commandHandler.resolveGhostMessage(roomId, systemSlug);

      expect(result).toEqual({
        event: expect.objectContaining({ event_id: '$edit' }) as unknown,
        latestContent: cachedData.latestContent,
        originalId: '$root',
      });
      // Should NOT fetch history
      expect(mockBotClient.doRequest).not.toHaveBeenCalled();
    });

    it('should fall back to history if cache is empty (Slow Path)', async () => {
      (lastMessageCache.get as jest.Mock).mockReturnValue(null);
      mockBotClient.doRequest.mockResolvedValue({ chunk: [] });

      await commandHandler.resolveGhostMessage(roomId, systemSlug);

      expect(mockBotClient.doRequest).toHaveBeenCalled();
    });
  });

  describe('getSenderSystem', () => {
    it('should return system if account link exists', async () => {
      const sender = '@newuser:localhost';

      // Mock DB hit
      const mockSys = { id: 'sys_new', slug: 'newuser', members: [] };
      mockPrisma.accountLink.findUnique.mockResolvedValue({
        system: mockSys,
      });

      // We need to call the private method via any
      const result = await commandHandler['getSenderSystem'](sender);

      expect(mockPrisma.accountLink.findUnique).toHaveBeenCalledWith({
        where: { matrixId: sender },
        include: { system: { include: { members: true, groups: { include: { members: true } } } } },
      });
      expect(result).toEqual(mockSys);
    });

    it('should return null if no link exists', async () => {
      const sender = '@newuser:localhost';

      // Mock DB miss
      mockPrisma.accountLink.findUnique.mockResolvedValue(null);

      // We need to call the private method via any
      const result = await commandHandler['getSenderSystem'](sender);

      expect(result).toBeNull();
    });
  });

  describe('promoteSystemPowerLevels', () => {
    const roomId = '!room:localhost';
    const ghostUserId = '@_plural_seraphim_lily:localhost';
    const ownerUserId = '@chiara:localhost';
    const botUserId = '@plural_bot:localhost';

    it('should promote bot and owner to match ghost level', async () => {
      // Mock ghost is PL 100, others are 0
      mockBotClient.getRoomStateEvent.mockResolvedValue({
        users: { [ghostUserId]: 100, [botUserId]: 0, [ownerUserId]: 0 },
        users_default: 0,
      });

      mockPrisma.system.findUnique.mockResolvedValue({
        id: 'sys123',
        slug: 'seraphim',
        accountLinks: [{ matrixId: ownerUserId, isPrimary: true }],
      });

      const sendStateMock = jest.fn().mockResolvedValue({});
      mockBotClient.sendStateEvent = sendStateMock;

      await commandHandler.promoteSystemPowerLevels(roomId, ghostUserId);

      expect(sendStateMock).toHaveBeenCalledWith(
        roomId,
        'm.room.power_levels',
        '',
        expect.objectContaining({
          users: expect.objectContaining({
            [botUserId]: 100,
            [ownerUserId]: 100,
          }) as unknown,
        }) as unknown,
      );
    });

    it('should do nothing if ghost has no authority (PL < 50)', async () => {
      mockBotClient.getRoomStateEvent.mockResolvedValue({
        users: { [ghostUserId]: 0 },
        users_default: 0,
      });

      const sendStateMock = jest.fn();
      mockBotClient.sendStateEvent = sendStateMock;

      await commandHandler.promoteSystemPowerLevels(roomId, ghostUserId);

      expect(sendStateMock).not.toHaveBeenCalled();
    });

    it('should do nothing if bot and owner are already promoted', async () => {
      mockBotClient.getRoomStateEvent.mockResolvedValue({
        users: { [ghostUserId]: 100, [botUserId]: 100, [ownerUserId]: 100 },
        users_default: 0,
      });

      const sendStateMock = jest.fn();
      mockBotClient.sendStateEvent = sendStateMock;

      await commandHandler.promoteSystemPowerLevels(roomId, ghostUserId);

      expect(sendStateMock).not.toHaveBeenCalled();
    });

    it('should handle Matrix API errors gracefully', async () => {
      mockBotClient.getRoomStateEvent.mockRejectedValue(new Error('API Error'));

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await commandHandler.promoteSystemPowerLevels(roomId, ghostUserId);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to pre-emptively promote'), 'API Error');
      consoleSpy.mockRestore();
    });
  });

  describe('Message Queries', () => {
    const roomId = '!room:localhost';
    const senderId = '@alice:localhost';
    const targetEventId = '$target_event';
    const systemSlug = 'testsys';
    const memberSlug = 'testmem';
    const ghostId = `@_plural_${systemSlug}_${memberSlug}:localhost`;

    beforeEach(() => {
      mockBotClient.getEvent.mockResolvedValue({
        sender: ghostId,
        type: 'm.room.message',
        content: { body: 'hello' },
      });
      mockPrisma.system.findUnique.mockResolvedValue({
        slug: systemSlug,
        name: 'Test System',
        members: [{ slug: memberSlug, name: 'Test Member' }],
        accountLinks: [{ matrixId: '@owner:localhost', isPrimary: true }],
      });
    });

    it('handleMessageInfoRequest should DM the user with info', async () => {
      const getOrAutoCreateSpy = jest
        .spyOn(commandHandler, 'getOrAutoCreateDMRoom')
        .mockResolvedValue('!dmroom:localhost');
      const sendCustomTextSpy = jest
        .spyOn(commandHandler, 'sendEncryptedCustomText')
        .mockResolvedValue({ event_id: '$new_event' });

      await commandHandler.handleMessageInfoRequest(roomId, senderId, targetEventId, false);

      expect(getOrAutoCreateSpy).toHaveBeenCalledWith(senderId);
      expect(sendCustomTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        '!dmroom:localhost',
        expect.stringContaining('Test System'),
        expect.stringContaining('Test Member'),
        expect.anything(),
      );
      expect(sendCustomTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        '!dmroom:localhost',
        expect.stringContaining('Test System'),
        expect.stringContaining('@owner:localhost'),
        expect.anything(),
      );
    });

    it('handleMessageInfoRequest should reply in-room if requested', async () => {
      const sendCustomTextSpy = jest
        .spyOn(commandHandler, 'sendEncryptedCustomText')
        .mockResolvedValue({ event_id: '$new_event' });

      await commandHandler.handleMessageInfoRequest(roomId, senderId, targetEventId, true);

      expect(sendCustomTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        roomId,
        expect.stringContaining('Test System'),
        expect.stringContaining('Test Member'),
        expect.anything(),
      );
    });

    it('handleMessagePingRequest should ping the sender in-room', async () => {
      const sendCustomTextSpy = jest
        .spyOn(commandHandler, 'sendEncryptedCustomText')
        .mockResolvedValue({ event_id: '$new_event' });

      await commandHandler.handleMessagePingRequest(roomId, senderId, targetEventId);

      expect(sendCustomTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        roomId,
        expect.stringContaining('pinged @owner:localhost regarding'),
        expect.stringContaining('href="https://matrix.to/#/@owner:localhost"'),
        expect.anything(),
      );
    });
  });

  describe('pk;switch and pk;config commands', () => {
    let sendRichTextSpy: jest.SpyInstance;

    beforeEach(() => {
      sendRichTextSpy = jest.spyOn(commandHandler, 'sendRichText').mockResolvedValue({ event_id: '$event' });
    });

    it('pk;switch <member> should log a new switch', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;switch', 'lily'];

      mockPrisma.switch.create.mockResolvedValueOnce({ id: 'new_switch_id' });

      const handled = await commandHandler.handleCommand(event, 'switch', parts, mockSystem);

      expect(handled).toBe(true);
      expect(mockPrisma.switch.create).toHaveBeenCalled();
      expect(mockPrisma.switchMember.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ switchId: 'new_switch_id', memberId: 'mem1', order: 0 }],
        }),
      );
      expect(sendRichTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        '!room:localhost',
        expect.stringContaining('✅ Switch logged: **Lily**'),
      );
    });

    it('pk;switch out should log a switch with no members', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;switch', 'out'];

      mockPrisma.switch.create.mockResolvedValueOnce({ id: 'new_switch_id' });

      const handled = await commandHandler.handleCommand(event, 'switch', parts, mockSystem);

      expect(handled).toBe(true);
      expect(mockPrisma.switch.create).toHaveBeenCalled();
      expect(mockPrisma.switchMember.createMany).not.toHaveBeenCalled();
      expect(sendRichTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        '!room:localhost',
        expect.stringContaining('✅ Logged switch-out'),
      );
    });

    it('pk;switch edit <member> should update the latest switch', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;switch', 'edit', 'lily'];

      mockPrisma.switch.findFirst.mockResolvedValueOnce({ id: 'latest_switch_id', timestamp: new Date() });

      const handled = await commandHandler.handleCommand(event, 'switch', parts, mockSystem);

      expect(handled).toBe(true);
      expect(mockPrisma.switchMember.deleteMany).toHaveBeenCalledWith({ where: { switchId: 'latest_switch_id' } });
      expect(mockPrisma.switchMember.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ switchId: 'latest_switch_id', memberId: 'mem1', order: 0 }],
        }),
      );
      expect(sendRichTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        '!room:localhost',
        expect.stringContaining('✅ Switch edited: **Lily**'),
      );
    });

    it('pk;switch move <time> should update the timestamp of the latest switch', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;switch', 'move', '5m'];

      const now = new Date();
      mockPrisma.switch.findFirst.mockResolvedValueOnce({ id: 'latest_switch_id', timestamp: now }); // Latest switch
      mockPrisma.switch.findFirst.mockResolvedValueOnce(null); // Previous switch (none exists)

      const handled = await commandHandler.handleCommand(event, 'switch', parts, mockSystem);

      expect(handled).toBe(true);
      expect(mockPrisma.switch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'latest_switch_id' },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({ timestamp: expect.any(Date) as unknown }),
        }),
      );
      expect(sendRichTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        '!room:localhost',
        expect.stringContaining('✅ Moved latest switch'),
      );
    });

    it('pk;switch delete should delete the latest switch', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;switch', 'delete', '-confirm'];

      mockPrisma.switch.findFirst.mockResolvedValueOnce({ id: 'latest_switch_id' });

      const handled = await commandHandler.handleCommand(event, 'switch', parts, mockSystem);

      expect(handled).toBe(true);
      expect(mockPrisma.switch.delete).toHaveBeenCalledWith({ where: { id: 'latest_switch_id' } });
      expect(sendRichTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        '!room:localhost',
        expect.stringContaining('✅ Deleted the most recent switch'),
      );
    });

    it('pk;config proxy switch <mode> should update proxy autoswitch config', async () => {
      const event = { room_id: '!room:localhost', sender: '@alice:localhost' };
      const parts = ['pk;config', 'proxy', 'switch', 'add'];

      const handled = await commandHandler.handleCommand(event, 'config', parts, mockSystem);

      expect(handled).toBe(true);
      expect(mockPrisma.system.update).toHaveBeenCalledWith({
        where: { id: 'sys123' },
        data: { proxyAutoswitch: 'add' },
      });
      expect(sendRichTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        '!room:localhost',
        expect.stringContaining('✅ Proxy autoswitch configured to **add**'),
      );
    });
  });

  describe('safeRedact', () => {
    const roomId = '!room:localhost';
    const eventId = '$event_to_redact';

    it('should successfully redact an event using the default intent', async () => {
      mockBotClient.redactEvent.mockResolvedValueOnce({});
      await commandHandler.safeRedact(roomId, eventId, 'UserRequest');
      expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, eventId, 'UserRequest');
    });

    it('should fallback to bot intent if preferred intent fails with M_FORBIDDEN', async () => {
      const preferredClient = {
        redactEvent: jest.fn().mockRejectedValue({ errcode: 'M_FORBIDDEN' }),
      };
      const preferredIntent = {
        userId: '@preferred:localhost',
        matrixClient: preferredClient,
      } as unknown as import('matrix-appservice-bridge').Intent;

      mockBotClient.redactEvent.mockResolvedValueOnce({});
      await commandHandler.safeRedact(roomId, eventId, 'UserRequest', preferredIntent);

      expect(preferredClient.redactEvent).toHaveBeenCalledWith(roomId, eventId, 'UserRequest');
      expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, eventId, 'UserRequest');
    });

    it('should send a warning message if bot also lacks permission', async () => {
      const sendEncryptedTextSpy = jest
        .spyOn(commandHandler, 'sendEncryptedText')
        .mockResolvedValue({ event_id: '$warning' });

      mockBotClient.redactEvent.mockRejectedValue({ errcode: 'M_FORBIDDEN' });

      await commandHandler.safeRedact(roomId, eventId, 'UserRequest');

      expect(sendEncryptedTextSpy).toHaveBeenCalledWith(
        expect.anything(),
        roomId,
        expect.stringContaining("I don't have permission to redact"),
      );
    });

    it('should only warn once per room about redaction permissions', async () => {
      const sendEncryptedTextSpy = jest
        .spyOn(commandHandler, 'sendEncryptedText')
        .mockResolvedValue({ event_id: '$warning' });

      mockBotClient.redactEvent.mockRejectedValue({ errcode: 'M_FORBIDDEN' });

      // First call warns
      await commandHandler.safeRedact(roomId, eventId, 'UserRequest');
      expect(sendEncryptedTextSpy).toHaveBeenCalledTimes(1);

      // Second call does not warn again for the same room
      await commandHandler.safeRedact(roomId, eventId, 'UserRequest');
      expect(sendEncryptedTextSpy).toHaveBeenCalledTimes(1);
    });

    it('should ignore other errors without warning', async () => {
      const sendEncryptedTextSpy = jest.spyOn(commandHandler, 'sendEncryptedText');
      mockBotClient.redactEvent.mockRejectedValue(new Error('Network error'));
      await commandHandler.safeRedact(roomId, eventId, 'UserRequest');
      expect(sendEncryptedTextSpy).not.toHaveBeenCalled();
    });
  });

  describe('resolveIdentity', () => {
    it('should resolve a ghost member user ID', async () => {
      mockPrisma.member.findFirst.mockResolvedValueOnce({ id: 'mem_id' });
      const res = await commandHandler.resolveIdentity('@_plural_sys1_mem1:localhost');
      expect(mockPrisma.member.findFirst).toHaveBeenCalledWith({
        where: { slug: 'mem1', system: { slug: 'sys1' } },
        select: { id: true },
      });
      expect(res).toEqual({ memberId: 'mem_id', systemId: undefined });
    });

    it('should resolve the bot user ID to the primary system', async () => {
      mockPrisma.system.findFirst.mockResolvedValueOnce({ id: 'sys_id' });
      const res = await commandHandler.resolveIdentity('@plural_bot:localhost');
      expect(mockPrisma.system.findFirst).toHaveBeenCalledWith({
        where: { accountLinks: { some: { isPrimary: true } } },
        select: { id: true },
      });
      expect(res).toEqual({ memberId: undefined, systemId: 'sys_id' });
    });

    it('should return undefined for unknown users', async () => {
      const res = await commandHandler.resolveIdentity('@someone_else:localhost');
      expect(res).toEqual({ memberId: undefined, systemId: undefined });
    });
  });

  describe('resolveGhostMessage', () => {
    const roomId = '!room:localhost';

    it('should hit cache if available and no explicit target is given', async () => {
      const cached = {
        sender: '@_plural_sys_mem:localhost',
        latestEventId: '$ev1',
        rootContent: { body: 'root' },
        latestContent: { body: 'latest' },
        rootEventId: '$ev1',
      };
      const spy = jest.spyOn(lastMessageCache, 'get').mockReturnValueOnce(cached);

      const res = await commandHandler.resolveGhostMessage(roomId, 'sys');
      expect(spy).toHaveBeenCalledWith(roomId, 'sys');
      expect(res).toEqual({
        event: { sender: cached.sender, event_id: cached.latestEventId, content: cached.rootContent },
        latestContent: cached.latestContent,
        originalId: cached.rootEventId,
      });
    });

    it('should query room messages if no cache and no explicit target', async () => {
      jest.spyOn(lastMessageCache, 'get').mockReturnValueOnce(undefined);
      const mockEvent = {
        sender: '@_plural_sys_mem:localhost',
        event_id: '$ev1',
        type: 'm.room.message',
        content: { body: 'test' },
      };
      mockBotClient.doRequest.mockResolvedValueOnce({ chunk: [mockEvent] });

      const res = await commandHandler.resolveGhostMessage(roomId, 'sys');
      expect(res).toEqual({
        event: mockEvent,
        latestContent: mockEvent.content,
        originalId: mockEvent.event_id,
      });
    });

    it('should handle explicit target ID successfully', async () => {
      const explicitId = '$explicit';
      const mockEvent = {
        sender: '@_plural_sys_mem:localhost',
        event_id: explicitId,
        type: 'm.room.message',
        content: { body: 'explicit test' },
      };

      // Simulate that the event is not in the chunk, so it fetches via getEvent
      mockBotClient.doRequest.mockResolvedValueOnce({ chunk: [] });
      mockBotClient.getEvent.mockResolvedValueOnce(mockEvent);

      const res = await commandHandler.resolveGhostMessage(roomId, 'sys', explicitId);
      expect(mockBotClient.getEvent).toHaveBeenCalledWith(roomId, explicitId);
      expect(res?.event).toMatchObject(mockEvent);
      expect(res?.originalId).toBe(explicitId);
    });
  });

  describe('Messaging Helpers', () => {
    const roomId = '!room:localhost';
    const mockIntent = { userId: '@plural_bot:localhost' } as unknown as import('matrix-appservice-bridge').Intent;

    beforeEach(() => {
      jest.clearAllMocks();
      mockPrisma.system.findFirst.mockResolvedValue({ id: 'sys1' });
    });

    it('sendEncryptedText should format payload correctly', async () => {
      const { sendEncryptedEvent } = await import('./crypto/encryption');

      await commandHandler.sendEncryptedText(mockIntent, roomId, 'Hello world');

      expect(sendEncryptedEvent).toHaveBeenCalledWith(
        mockIntent,
        roomId,
        'm.room.message',
        { msgtype: 'm.text', body: 'Hello world' },
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('sendRichText should format payload correctly with markdown', async () => {
      const { sendEncryptedEvent } = await import('./crypto/encryption');

      await commandHandler.sendRichText(mockIntent, roomId, '**Bold**');

      expect(sendEncryptedEvent).toHaveBeenCalledWith(
        mockIntent,
        roomId,
        'm.room.message',
        {
          msgtype: 'm.text',
          body: '**Bold**',
          format: 'org.matrix.custom.html',
          formatted_body: '<p><strong>Bold</strong></p>',
        },
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('sendEncryptedNotice should format payload correctly', async () => {
      const { sendEncryptedEvent } = await import('./crypto/encryption');

      await commandHandler.sendEncryptedNotice(mockIntent, roomId, 'A notice');

      expect(sendEncryptedEvent).toHaveBeenCalledWith(
        mockIntent,
        roomId,
        'm.room.message',
        { msgtype: 'm.notice', body: 'A notice' },
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('sendEncryptedImage should format payload correctly', async () => {
      const { sendEncryptedEvent } = await import('./crypto/encryption');

      await commandHandler.sendEncryptedImage(mockIntent, roomId, 'mxc://url', 'Avatar Name');

      expect(sendEncryptedEvent).toHaveBeenCalledWith(
        mockIntent,
        roomId,
        'm.room.message',
        {
          msgtype: 'm.text',
          body: '[Avatar: Avatar Name] (mxc://url)',
          format: 'org.matrix.custom.html',
          formatted_body: '<img src="mxc://url" alt="Avatar Name" />',
        },
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
