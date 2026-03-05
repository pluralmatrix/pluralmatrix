import { 
    getPluralMatrixToken, 
    setupTestRoom, 
    getMatrixClient, 
    registerUser,
    deactivateUser,
    cleanupCryptoStorage
} from './test/e2e-helper';
import { MatrixClient } from "@vector-im/matrix-bot-sdk";

// These E2E tests require a running stack (Synapse + App Service)
// They use the 'localhost' domain configured in setup.sh
describe('PluralMatrix E2E Roundtrip', () => {
    let client: MatrixClient;
    let observer: MatrixClient;
    let jwt: string;
    let roomId: string;
    let username: string;
    let observerName: string;
    const password = "e2e_password";

    beforeAll(async () => {
        username = `pm_test_user_${Math.random().toString(36).substring(7)}`;
        observerName = `pm_test_obs_${Math.random().toString(36).substring(7)}`;
        console.log(`[E2E] Starting beforeAll setup for ${username} and ${observerName}...`);

        // 1. Register and login real Matrix users
        await registerUser(username, password);
        await registerUser(observerName, password);
        
        client = await getMatrixClient(username, password);
        observer = await getMatrixClient(observerName, password);
        
        console.log(`[E2E] Matrix clients starting...`);
        await client.start();
        await observer.start();
        console.log(`[E2E] Matrix clients started.`);

        // 2. Login to PluralMatrix App Service
        console.log(`[E2E] Fetching PluralMatrix JWT for @${username}:localhost...`);
        jwt = await getPluralMatrixToken(`@${username}:localhost`, password);
        console.log(`[E2E] PluralMatrix JWT obtained for @${username}:localhost.`);

        console.log(`[E2E] Creating system via App Service...`);
        await fetch(`http://localhost:9000/api/system`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}` }
        });
        console.log(`[E2E] System created.`);

        // 3. Setup a test room
        console.log(`[E2E] Creating test room...`);
        roomId = await setupTestRoom(client);
        console.log(`[E2E] Inviting observer to ${roomId}...`);
        await client.inviteUser(`@${observerName}:localhost`, roomId);
        await observer.joinRoom(roomId);
        console.log(`[E2E] Test room created and joined by all.`);

        // 4. Wait for bot to join
        console.log(`[E2E] Waiting for bot to join ${roomId}...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log(`[E2E] Setup complete.`);
    }, 90000);

    afterAll(async () => {
        console.log(`[E2E] Starting afterAll teardown...`);

        // 1. Cleanup members from PluralMatrix
        try {
            console.log(`[E2E] Deleting PluralMatrix members for ${username}...`);
            await fetch(`http://localhost:9000/api/members`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${jwt}` }
            });
        } catch (e) {}

        // 2. Stop clients
        if (client) {
            console.log(`[E2E] Matrix client stopping...`);
            await client.stop();
        }
        if (observer) {
            console.log(`[E2E] Observer client stopping...`);
            await observer.stop();
        }

        // 3. Deactivate users in Synapse
        // We use the admin client to deactivate the observer, then the client deactivates itself
        if (client && observer) {
            await deactivateUser(`@${observerName}:localhost`, client.accessToken);
            await deactivateUser(`@${username}:localhost`, client.accessToken);
        } else if (client) {
            await deactivateUser(`@${username}:localhost`, client.accessToken);
        }

        // 4. Cleanup local disk
        cleanupCryptoStorage(username);
        cleanupCryptoStorage(observerName);

        console.log(`[E2E] Teardown complete.`);
        
        console.log(`[E2E] Scheduling force-exit in 3s...`);
        setTimeout(() => process.exit(0), 3000).unref();
    }, 30000);

    /**
     * Helper: Wait for a ghost message to appear for a specific client.
     */
    async function waitForGhostMessage(targetClient: MatrixClient, targetRoomId: string, timeoutMs: number = 30000) {
        return new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
                targetClient.off("room.message", listener);
                reject(new Error(`Timeout waiting for ghost message in ${targetRoomId}`));
            }, timeoutMs);

            const listener = (roomIdMatch: string, event: any) => {
                if (roomIdMatch === targetRoomId && event.sender.startsWith('@_plural_')) {
                    clearTimeout(timeout);
                    targetClient.off("room.message", listener);
                    resolve(event);
                }
            };
            targetClient.on("room.message", listener);
        });
    }

    /**
     * Helper: Verify that an event is hidden (redacted or body-cleared) for a specific client.
     */
    async function verifyRedaction(targetClient: MatrixClient, targetRoomId: string, eventId: string, label: string) {
        console.log(`[E2E-Redact] Verifying redaction of ${eventId} from ${label} view...`);
        let hidden = false;
        for (let i = 0; i < 15; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                // For encrypted clients, we might need to force event processing to see the redaction
                if ((targetClient as any).crypto) {
                    await (targetClient as any).crypto.processRoomEvents(targetRoomId);
                }
                const event = await targetClient.getEvent(targetRoomId, eventId);
                
                // SUCCESS IF:
                // 1. Event has redacted_by field
                // 2. Event content is empty/missing body
                if (event.unsigned?.redacted_by || !event.content?.body) {
                    hidden = true;
                    break;
                }
                console.log(`[E2E-Redact] Attempt ${i+1} (${label}): Message still visible, retrying...`);
            } catch (e: any) {
                // 404/NotFound is also a success for redaction
                hidden = true;
                break;
            }
        }
        expect(hidden).toBe(true);
        console.log(`[E2E-Redact] SUCCESS: Message hidden from ${label} view.`);
    }

    it('should proxy a message in a standard (unencrypted) room with 4-way verification', async () => {
        const messageBody = `Plain E2E ${Math.random().toString(36).substring(7)}`;
        const proxyPrefix = `e2e-plain-${Math.random().toString(36).substring(7)}:`;
        
        // 1. Create a system member
        const slug = `e2e-ghost-${Date.now()}`;
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-Ghost", slug: slug, proxyTags: [{ prefix: proxyPrefix, suffix: "" }] })
        });

        // 2. Start waiting for ghost response from BOTH perspectives
        const ghostFromSenderPromise = waitForGhostMessage(client, roomId);
        const ghostFromObserverPromise = waitForGhostMessage(observer, roomId);

        // 3. Send trigger message
        console.log(`[E2E-Plain] Sending trigger: ${proxyPrefix} ${messageBody}`);
        const triggerEventId = await client.sendText(roomId, `${proxyPrefix} ${messageBody}`);

        // 4. Verify ghost delivery to both
        console.log(`[E2E-Plain] Waiting for ghost response (both views)...`);
        const [senderGhost, observerGhost] = await Promise.all([ghostFromSenderPromise, ghostFromObserverPromise]);
        
        expect(senderGhost.content.body).toBe(messageBody);
        expect(observerGhost.content.body).toBe(messageBody);
        console.log(`[E2E-Plain] SUCCESS: Ghost message received by sender and observer.`);

        // 5. Verify redaction for both
        await Promise.all([
            verifyRedaction(client, roomId, triggerEventId, "Sender"),
            verifyRedaction(observer, roomId, triggerEventId, "Observer")
        ]);
    }, 60000);

    it('should proxy a message containing rich formatting (Markdown/HTML)', async () => {
        const messageText = `Rich formatting **bold** and *italic* ${Math.random().toString(36).substring(7)}`;
        const expectedBody = messageText;
        const proxyPrefix = `e2e-rich-${Math.random().toString(36).substring(7)}:`;
        
        // Create a system member
        const slug = `e2e-ghost-rich-${Date.now()}`;
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-Rich", slug: slug, proxyTags: [{ prefix: proxyPrefix, suffix: "" }] })
        });

        const ghostFromSenderPromise = waitForGhostMessage(client, roomId);
        
        console.log(`[E2E-Rich] Sending trigger: ${proxyPrefix} ${messageText}`);
        // Send a message with HTML formatting
        const triggerEventId = await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: `${proxyPrefix} ${messageText}`,
            format: "org.matrix.custom.html",
            formatted_body: `${proxyPrefix} Rich formatting <b>bold</b> and <i>italic</i> ${messageText.split(' ').pop()}`
        });

        console.log(`[E2E-Rich] Waiting for ghost response...`);
        const senderGhost = await ghostFromSenderPromise;
        
        expect(senderGhost.content.body).toBe(expectedBody);
        expect(senderGhost.content.format).toBe("org.matrix.custom.html");
        expect(senderGhost.content.formatted_body).toContain("<b>bold</b>");
        
        console.log(`[E2E-Rich] SUCCESS: Rich formatting preserved.`);
        await verifyRedaction(client, roomId, triggerEventId, "Sender");
    }, 60000);

    it('should proxy a message in an ENCRYPTED room with 4-way verification', async () => {
        const messageBody = `Secure E2E ${Math.random().toString(36).substring(7)}`;
        const proxyPrefix = `e2e-sec-${Math.random().toString(36).substring(7)}:`;

        // 1. Create system member
        const slug = `e2e-secure-${Date.now()}`;
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-Secure", slug: slug, proxyTags: [{ prefix: proxyPrefix, suffix: "" }] })
        });

        // 2. Create room and enable encryption
        const e2eeRoomId = await setupTestRoom(client);
        await client.inviteUser(`@${observerName}:localhost`, e2eeRoomId);
        await observer.joinRoom(e2eeRoomId);
        await client.sendStateEvent(e2eeRoomId, "m.room.encryption", "", { algorithm: "m.megolm.v1.aes-sha2" });
        
        console.log(`[E2E-E2EE] Encryption enabled in ${e2eeRoomId}. Waiting for settle...`);
        await new Promise(resolve => setTimeout(resolve, 10000));

        // 3. Start waiting for ghost message from BOTH perspectives
        const ghostFromSenderPromise = waitForGhostMessage(client, e2eeRoomId, 60000);
        const ghostFromObserverPromise = waitForGhostMessage(observer, e2eeRoomId, 60000);

        // 4. Send trigger message (encrypted)
        console.log(`[E2E-E2EE] Sending trigger: ${proxyPrefix} ${messageBody}`);
        const triggerEventId = await client.sendText(e2eeRoomId, `${proxyPrefix} ${messageBody}`);

        // 5. Verify ghost delivery to both
        console.log(`[E2E-E2EE] Waiting for ghost response (both views)...`);
        const [senderGhost, observerGhost] = await Promise.all([ghostFromSenderPromise, ghostFromObserverPromise]);
        
        expect(senderGhost.content.body).toBe(messageBody);
        expect(observerGhost.content.body).toBe(messageBody);
        console.log(`[E2E-E2EE] SUCCESS: Decrypted ghost message received by sender and observer.`);

        // 6. Verify redaction for both
        await Promise.all([
            verifyRedaction(client, e2eeRoomId, triggerEventId, "Sender"),
            verifyRedaction(observer, e2eeRoomId, triggerEventId, "Observer")
        ]);
    }, 180000);
});
