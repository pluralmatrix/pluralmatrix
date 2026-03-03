import { TransactionRouter } from "./TransactionRouter";
import { RoomId, UserId } from "@matrix-org/matrix-sdk-crypto-nodejs";

// Define mocks BEFORE the jest.mock call to avoid hoisting issues
class MockDeviceLists {
    constructor(public changed: any[] = [], public left: any[] = []) {}
}

jest.mock("@matrix-org/matrix-sdk-crypto-nodejs", () => {
    return {
        RoomId: jest.fn().mockImplementation((id) => ({ toString: () => id })),
        UserId: jest.fn().mockImplementation((id) => ({ toString: () => id })),
        DeviceLists: jest.fn().mockImplementation((changed, left) => new MockDeviceLists(changed, left))
    };
});

describe("TransactionRouter", () => {
    let router: TransactionRouter;
    let mockManager: any;
    let mockMachine: any;
    let onRequestCallback: jest.Mock;
    let onDecryptedEvent: jest.Mock;

    const botUserId = "@bot:localhost";

    beforeEach(() => {
        onRequestCallback = jest.fn().mockResolvedValue(undefined);
        onDecryptedEvent = jest.fn().mockResolvedValue(undefined);

        mockMachine = {
            receiveSyncChanges: jest.fn().mockResolvedValue(undefined),
            decryptRoomEvent: jest.fn(),
            updateTrackedUsers: jest.fn().mockResolvedValue(undefined)
        };

        mockManager = {
            getMachine: jest.fn().mockResolvedValue(mockMachine)
        };

        router = new TransactionRouter(mockManager, botUserId, onRequestCallback, onDecryptedEvent);
    });

    it("should route to-device events to the correct machine", async () => {
        const transaction = {
            events: [],
            to_device: [
                {
                    type: "m.room_key",
                    sender: "@alice:localhost",
                    to_user_id: "@bot:localhost",
                    content: { session_id: "123" }
                }
            ]
        };

        await router.processTransaction(transaction as any);

        expect(mockManager.getMachine).toHaveBeenCalledWith("@bot:localhost");
        expect(mockMachine.receiveSyncChanges).toHaveBeenCalled();
        expect(onRequestCallback).toHaveBeenCalledWith("@bot:localhost");
    });

    it("should decrypt timeline events and call the callback", async () => {
        const encryptedEvent = {
            type: "m.room.encrypted",
            event_id: "$event1",
            room_id: "!room1",
            sender: "@alice:localhost",
            content: { ciphertext: "..." }
        };

        const transaction = {
            events: [encryptedEvent]
        };

        mockMachine.decryptRoomEvent.mockResolvedValue({
            event: JSON.stringify({
                type: "m.room.message",
                content: { body: "hello" }
            })
        });

        await router.processTransaction(transaction as any);

        expect(mockMachine.decryptRoomEvent).toHaveBeenCalled();
        expect(onDecryptedEvent).toHaveBeenCalledWith(expect.objectContaining({
            type: "m.room.message",
            content: { body: "hello" },
            room_id: "!room1"
        }));
    });

    it("should trigger a tracking nudge if decryption fails", async () => {
        const encryptedEvent = {
            type: "m.room.encrypted",
            event_id: "$event1",
            room_id: "!room1",
            sender: "@alice:localhost",
            content: { ciphertext: "..." }
        };

        const transaction = {
            events: [encryptedEvent]
        };

        mockMachine.decryptRoomEvent.mockRejectedValue(new Error("Unknown session"));

        await router.processTransaction(transaction as any);

        expect(mockMachine.updateTrackedUsers).toHaveBeenCalled();
        expect(onRequestCallback).toHaveBeenCalledWith(botUserId);
    });

    it("should debounce decryption nudges for multiple failures from the same sender", async () => {
        const encryptedEvent1 = {
            type: "m.room.encrypted",
            event_id: "$event1",
            room_id: "!room1",
            sender: "@alice:localhost",
            content: { ciphertext: "..." }
        };
        const encryptedEvent2 = {
            type: "m.room.encrypted",
            event_id: "$event2",
            room_id: "!room1",
            sender: "@alice:localhost",
            content: { ciphertext: "..." }
        };

        const transaction = {
            events: [encryptedEvent1, encryptedEvent2]
        };

        mockMachine.decryptRoomEvent.mockRejectedValue(new Error("Unknown session"));

        await router.processTransaction(transaction as any);

        // Should only be called ONCE with Alice's ID
        expect(mockMachine.updateTrackedUsers).toHaveBeenCalledTimes(1);
        expect(mockMachine.updateTrackedUsers).toHaveBeenCalledWith([expect.objectContaining({ toString: expect.any(Function) })]);
        
        // Bot sync should only be called ONCE at the end of timeline processing
        expect(onRequestCallback).toHaveBeenCalledTimes(1);
        expect(onRequestCallback).toHaveBeenCalledWith(botUserId);
    });
});
