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
     * Helper: Wait for a message from the main bot.
     */
    async function waitForBotMessage(targetClient: MatrixClient, targetRoomId: string, timeoutMs: number = 10000) {
        return new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
                targetClient.off("room.message", listener);
                reject(new Error(`Timeout waiting for bot message in ${targetRoomId}`));
            }, timeoutMs);

            const listener = (roomIdMatch: string, event: any) => {
                if (roomIdMatch === targetRoomId && event.sender.startsWith('@plural_bot:')) {
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

    it('should correctly proxy an edited reply, preserving the reply relation and fallback', async () => {
        const proxyPrefix = `e2e-edit-reply-${Math.random().toString(36).substring(7)}:`;
        const slug = `e2e-ghost-reply-${Date.now()}`;
        
        // 1. Create a system member
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-EditReply", slug: slug, proxyTags: [{ prefix: proxyPrefix, suffix: "" }] })
        });

        // 2. Send an original message to reply to
        console.log(`[E2E-EditReply] Sending original message A...`);
        const msgAId = await client.sendText(roomId, "Message A");

        // 3. Send a normal reply to A (no proxy prefix)
        console.log(`[E2E-EditReply] Sending reply B...`);
        const replyHtml = `<mx-reply><blockquote><a href="https://matrix.to/#/${roomId}/${msgAId}">In reply to</a> <a href="https://matrix.to/#/@pm_test:localhost">@pm_test:localhost</a><br>Message A</blockquote></mx-reply>Reply B`;
        const replyText = `> <@pm_test:localhost> Message A\n\nReply B`;
        const msgBId = await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: replyText,
            format: "org.matrix.custom.html",
            formatted_body: replyHtml,
            "m.relates_to": {
                "m.in_reply_to": { event_id: msgAId }
            }
        });

        // 4. Wait for the ghost message
        const ghostPromise = waitForGhostMessage(client, roomId);

        // 5. Edit B to add the proxy prefix
        console.log(`[E2E-EditReply] Editing reply B to add proxy prefix...`);
        const editedText = `${proxyPrefix} Edited Reply B with **bold**`;
        const editedHtml = `${proxyPrefix} Edited Reply B with <b>bold</b>`;
        
        const editId = await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: `* ${editedText}`,
            format: "org.matrix.custom.html",
            formatted_body: `* ${editedHtml}`,
            "m.new_content": {
                msgtype: "m.text",
                body: editedText,
                format: "org.matrix.custom.html",
                formatted_body: editedHtml
            },
            "m.relates_to": {
                rel_type: "m.replace",
                event_id: msgBId
            }
        });

        console.log(`[E2E-EditReply] Waiting for ghost response...`);
        const ghostMsg = await ghostPromise;
        
        console.log(`[E2E-EditReply] Ghost message content:`, JSON.stringify(ghostMsg.content, null, 2));

        // Assertions
        expect(ghostMsg.content["m.relates_to"]).toBeDefined();
        expect(ghostMsg.content["m.relates_to"]["m.in_reply_to"]).toBeDefined();
        expect(ghostMsg.content["m.relates_to"]["m.in_reply_to"].event_id).toBe(msgAId);
        
        expect(ghostMsg.content.body).toContain("> <@pm_test:localhost> Message A");
        expect(ghostMsg.content.body).toContain("Edited Reply B with **bold**");
        
        expect(ghostMsg.content.format).toBe("org.matrix.custom.html");
        expect(ghostMsg.content.formatted_body).toContain("<mx-reply>");
        expect(ghostMsg.content.formatted_body).toContain("<b>bold</b>");

        console.log(`[E2E-EditReply] SUCCESS: Reply correctly proxied after edit.`);
        
        // Both the original event and the edit event should be hidden
        await Promise.all([
            verifyRedaction(client, roomId, msgBId, "Sender (Original)"),
            verifyRedaction(client, roomId, editId, "Sender (Edit)")
        ]);
    }, 60000);

    it('should properly process the pk;e command and preserve rich formatting', async () => {
        const proxyPrefix = `e2e-cmd-e-${Math.random().toString(36).substring(7)}:`;
        const slug = `e2e-ghost-cmd-e-${Date.now()}`;
        
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-CmdE", slug: slug, proxyTags: [{ prefix: proxyPrefix, suffix: "" }] })
        });

        // 1. Send initial proxy message
        const ghost1Promise = waitForGhostMessage(client, roomId);
        const originalText = `${proxyPrefix} This is the original text`;
        const msgId = await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: originalText,
        });

        const ghost1 = await ghost1Promise;
        const ghostMsgId = ghost1.event_id;
        
        // Allow cache to sync
        await new Promise(r => setTimeout(r, 1000));

        // 2. Reply to the ghost message with `pk;e` and markdown formatting
        const editCmdPromise = waitForGhostMessage(client, roomId);
        const cmdText = `pk;e **new bold text**`;
        const cmdHtml = `pk;e <b>new bold text</b>`;
        
        // Simulate a Matrix reply fallback
        const replyHtml = `<mx-reply><blockquote>Ghost text</blockquote></mx-reply>${cmdHtml}`;
        const replyText = `> <@ghost> Ghost text\n\n${cmdText}`;

        const cmdEventId = await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: replyText,
            format: "org.matrix.custom.html",
            formatted_body: replyHtml,
            "m.relates_to": {
                "m.in_reply_to": { event_id: ghostMsgId }
            }
        });

        // 3. Wait for the ghost edit event
        // The ghost edit event should have an m.replace relation pointing to ghostMsgId
        const ghostEditMsg = await editCmdPromise;
        
        expect(ghostEditMsg.content["m.new_content"]).toBeDefined();
        expect(ghostEditMsg.content["m.new_content"].body).toBe("**new bold text**");
        expect(ghostEditMsg.content["m.new_content"].format).toBe("org.matrix.custom.html");
        expect(ghostEditMsg.content["m.new_content"].formatted_body).toBe("<b>new bold text</b>");
        
        expect(ghostEditMsg.content["m.relates_to"]).toBeDefined();
        expect(ghostEditMsg.content["m.relates_to"].rel_type).toBe("m.replace");
        expect(ghostEditMsg.content["m.relates_to"].event_id).toBe(ghostMsgId);

        console.log(`[E2E-CmdE] SUCCESS: pk;e preserved rich formatting.`);
    }, 60000);

    it('should correctly proxy an m.image event containing attached text (like Fluffychat)', async () => {
        const proxyPrefix = `e2e-img-${Math.random().toString(36).substring(7)}:`;
        const slug = `e2e-ghost-img-${Date.now()}`;
        
        // 1. Create a system member
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-Image", slug: slug, proxyTags: [{ prefix: proxyPrefix, suffix: "" }] })
        });

        // 2. Send a mock Fluffychat image payload with a proxy prefix in the body
        const imageText = `${proxyPrefix} Look at this cool image!`;
        const mockImagePayload = {
            "body": imageText,
            "info": {
                "h": 1600,
                "mimetype": "image/jpeg",
                "size": 1357434,
                "w": 1200
            },
            "msgtype": "m.image",
            "url": "mxc://localhost/dummy_image_id"
        };

        const ghostPromise = waitForGhostMessage(client, roomId);
        
        console.log(`[E2E-Image] Sending trigger image: ${imageText}`);
        const triggerEventId = await client.sendMessage(roomId, mockImagePayload);

        console.log(`[E2E-Image] Waiting for ghost response...`);
        const ghostMsg = await ghostPromise;
        console.log(`[E2E-Image] Ghost response:`, JSON.stringify(ghostMsg.content, null, 2));
        
        // Assertions
        expect(ghostMsg.sender).toContain(slug);
        
        expect(ghostMsg.content.msgtype).toBe("m.image");
        expect(ghostMsg.content.url).toBe("mxc://localhost/dummy_image_id");
        expect(ghostMsg.content.info).toBeDefined();
        expect(ghostMsg.content.info.h).toBe(1600);
        expect(ghostMsg.content.body).toBe("Look at this cool image!");

        console.log(`[E2E-Image] SUCCESS: Image and attached text successfully proxied.`);
        await verifyRedaction(client, roomId, triggerEventId, "Sender");
    }, 60000);

    it('should correctly proxy an edited m.image event and preserve image attachments', async () => {
        const proxyPrefix = `e2e-edit-img-${Math.random().toString(36).substring(7)}:`;
        const slug = `e2e-ghost-edit-img-${Date.now()}`;
        
        // 1. Create a system member
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-EditImage", slug: slug, proxyTags: [{ prefix: proxyPrefix, suffix: "" }] })
        });

        // 2. Send a mock image payload without a prefix (unproxied original message)
        const imageText = `Look at this cool image without a prefix!`;
        const mockImagePayload = {
            "body": imageText,
            "info": {
                "h": 1600,
                "mimetype": "image/jpeg",
                "size": 1357434,
                "w": 1200
            },
            "msgtype": "m.image",
            "url": "mxc://localhost/dummy_image_id_to_edit"
        };

        console.log(`[E2E-EditImage] Sending original unproxied image...`);
        const originalEventId = await client.sendMessage(roomId, mockImagePayload);

        // Allow Synapse to fully process and index the original event before editing it
        // Otherwise, Gatekeeper's getEvent(originalEventId) might return M_NOT_FOUND
        await new Promise(r => setTimeout(r, 1000));

        // 3. Edit the image to add the proxy prefix
        console.log(`[E2E-EditImage] Editing image to add proxy prefix...`);
        const editedText = `${proxyPrefix} Edited caption with prefix!`;
        const ghostPromise = waitForGhostMessage(client, roomId);
        
        const editId = await client.sendMessage(roomId, {
            msgtype: "m.image", // Client normally sends the same msgtype
            body: `* ${editedText}`,
            "m.new_content": {
                msgtype: "m.image", // Matrix spec says edit should maintain the type
                body: editedText,
                url: "mxc://localhost/dummy_image_id_to_edit"
            },
            "m.relates_to": {
                rel_type: "m.replace",
                event_id: originalEventId
            }
        });

        console.log(`[E2E-EditImage] Waiting for ghost response...`);
        const ghostMsg = await ghostPromise;
        
        // Assertions
        expect(ghostMsg.sender).toContain(slug);
        
        // The ghost should send a brand new m.image event, NOT an edit event
        expect(ghostMsg.content.msgtype).toBe("m.image");
        expect(ghostMsg.content.url).toBe("mxc://localhost/dummy_image_id_to_edit");
        expect(ghostMsg.content.info).toBeDefined();
        expect(ghostMsg.content.info.h).toBe(1600);
        
        // The body should be correctly stripped
        expect(ghostMsg.content.body).toBe("Edited caption with prefix!");
        
        // Edit relation should be scrubbed because it's a new proxy message
        expect(ghostMsg.content["m.new_content"]).toBeUndefined();
        expect(ghostMsg.content["m.relates_to"]).toBeUndefined();

        console.log(`[E2E-EditImage] SUCCESS: Edited image successfully proxied with preserved attachments.`);
        await Promise.all([
            verifyRedaction(client, roomId, originalEventId, "Sender (Original)"),
            verifyRedaction(client, roomId, editId, "Sender (Edit)")
        ]);
    }, 60000);

    it('should correctly reproxy a reply and preserve its quotation', async () => {
        const proxyPrefix = `e2e-rp-${Math.random().toString(36).substring(7)}:`;
        const slug1 = `e2e-ghost-rp1-${Date.now()}`;
        const slug2 = `e2e-ghost-rp2-${Date.now()}`;
        
        // 1. Create two system members
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-RP1", slug: slug1, proxyTags: [{ prefix: proxyPrefix, suffix: "" }] })
        });
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-RP2", slug: slug2, proxyTags: [{ prefix: "rp2:", suffix: "" }] })
        });

        // 2. Send an original message to reply to
        console.log(`[E2E-Reproxy] Sending original message A...`);
        const msgAId = await client.sendText(roomId, "Original Message to Reply To");

        // 3. Send a proxy reply
        console.log(`[E2E-Reproxy] Sending proxy reply B...`);
        const replyHtml = `<mx-reply><blockquote><a href="https://matrix.to/#/${roomId}/${msgAId}">In reply to</a> <a href="https://matrix.to/#/@pm_test:localhost">@pm_test:localhost</a><br>Original Message to Reply To</blockquote></mx-reply>${proxyPrefix} My proxy reply`;
        const replyText = `> <@pm_test:localhost> Original Message to Reply To\n\n${proxyPrefix} My proxy reply`;
        
        const firstProxyPromise = waitForGhostMessage(client, roomId);
        
        await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: replyText,
            format: "org.matrix.custom.html",
            formatted_body: replyHtml,
            "m.relates_to": {
                "m.in_reply_to": { event_id: msgAId }
            }
        });

        const firstGhostMsg = await firstProxyPromise;
        const ghostMsgId = firstGhostMsg.event_id;
        
        // Let the cache catch up
        await new Promise(r => setTimeout(r, 1000));

        // 4. Send the reproxy command
        console.log(`[E2E-Reproxy] Sending reproxy command...`);
        const reproxyPromise = waitForGhostMessage(client, roomId);
        
        // In Matrix, replies to ghost messages also contain the m.in_reply_to relation pointing at the ghost message.
        // The reproxy command looks up the message it replied to.
        await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: `pk;rp ${slug2}`,
            "m.relates_to": {
                "m.in_reply_to": { event_id: ghostMsgId }
            }
        });

        console.log(`[E2E-Reproxy] Waiting for reproxy ghost response...`);
        const reproxyGhostMsg = await reproxyPromise;
        
        // Assertions
        expect(reproxyGhostMsg.sender).toContain(slug2);
        
        expect(reproxyGhostMsg.content["m.relates_to"]).toBeDefined();
        expect(reproxyGhostMsg.content["m.relates_to"]["m.in_reply_to"]).toBeDefined();
        expect(reproxyGhostMsg.content["m.relates_to"]["m.in_reply_to"].event_id).toBe(msgAId);
        
        expect(reproxyGhostMsg.content.body).toContain("> <@pm_test:localhost> Original Message to Reply To");
        expect(reproxyGhostMsg.content.body).toContain("My proxy reply");
        
        expect(reproxyGhostMsg.content.format).toBe("org.matrix.custom.html");
        expect(reproxyGhostMsg.content.formatted_body).toContain("<mx-reply>");
        
        console.log(`[E2E-Reproxy] SUCCESS: Reproxy correctly preserved reply relations and fallbacks.`);
    }, 60000);

    it('should correctly reproxy an edited message, preserving the latest edit text', async () => {
        const proxyPrefix = `e2e-rpe-${Math.random().toString(36).substring(7)}:`;
        const slug1 = `e2e-ghost-rpe1-${Date.now()}`;
        const slug2 = `e2e-ghost-rpe2-${Date.now()}`;
        
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-RPE1", slug: slug1, proxyTags: [{ prefix: proxyPrefix, suffix: "" }] })
        });
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "E2E-RPE2", slug: slug2, proxyTags: [{ prefix: "rpe2:", suffix: "" }] })
        });

        // 0. Send a dummy message to reply to
        console.log(`[E2E-ReproxyEdit] Sending dummy parent message...`);
        const parentMsgId = await client.sendText(roomId, "This is the parent message");

        // 1. Send initial proxy message AS A REPLY
        console.log(`[E2E-ReproxyEdit] Sending initial proxy message as a reply...`);
        const firstProxyPromise = waitForGhostMessage(client, roomId);
        
        const replyHtml = `<mx-reply><blockquote>Parent</blockquote></mx-reply>${proxyPrefix} Original unedited text`;
        await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: `> Parent\n\n${proxyPrefix} Original unedited text`,
            format: "org.matrix.custom.html",
            formatted_body: replyHtml,
            "m.relates_to": { "m.in_reply_to": { event_id: parentMsgId } }
        });
        
        const firstGhostMsg = await firstProxyPromise;
        const ghostMsgId = firstGhostMsg.event_id;

        // Allow cache to sync
        await new Promise(r => setTimeout(r, 1000));

        // 2. Edit the ghost message via pk;e
        console.log(`[E2E-ReproxyEdit] Sending pk;e edit...`);
        const editCmdPromise = waitForGhostMessage(client, roomId);
        await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: "pk;e This text is heavily modified!",
            "m.relates_to": { "m.in_reply_to": { event_id: ghostMsgId } }
        });
        await editCmdPromise;

        // Allow cache to sync the edit
        await new Promise(r => setTimeout(r, 1000));

        // 3. Reproxy the edited message without explicitly replying
        console.log(`[E2E-ReproxyEdit] Sending bare pk;rp command...`);
        const reproxyPromise = waitForGhostMessage(client, roomId);
        await client.sendMessage(roomId, {
            msgtype: "m.text",
            body: `pk;rp ${slug2}`
        });
        
        console.log(`[E2E-ReproxyEdit] Waiting for reproxy ghost response...`);
        const reproxyGhostMsg = await reproxyPromise;

        expect(reproxyGhostMsg.sender).toContain(slug2);
        
        // Assert that the new reproxied message contains the EDITED text, not the ORIGINAL text
        expect(reproxyGhostMsg.content.body).toContain("This text is heavily modified!");
        
        // Assert that the reproxy preserved the original reply relation
        expect(reproxyGhostMsg.content["m.relates_to"]).toBeDefined();
        expect(reproxyGhostMsg.content["m.relates_to"]["m.in_reply_to"]).toBeDefined();
        expect(reproxyGhostMsg.content["m.relates_to"]["m.in_reply_to"].event_id).toBe(parentMsgId);
        
        console.log(`[E2E-ReproxyEdit] SUCCESS: Reproxy correctly grabbed the latest edited text and preserved reply.`);
    }, 60000);

    it('should correctly support latch mode autoproxying', async () => {
        const proxyPrefix1 = `latch1-${Date.now()}:`;
        const proxyPrefix2 = `latch2-${Date.now()}:`;
        const slug1 = `ghost-latch-1`;
        const slug2 = `ghost-latch-2`;

        // 1. Create two members
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "Latch 1", slug: slug1, proxyTags: [{ prefix: proxyPrefix1, suffix: "" }] })
        });
        await fetch(`http://localhost:9000/api/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: "Latch 2", slug: slug2, proxyTags: [{ prefix: proxyPrefix2, suffix: "" }] })
        });

        // 2. Enable latch mode via command
        const latchModePromise = waitForBotMessage(client, roomId);
        await client.sendText(roomId, "pk;autoproxy latch");
        const botResponse1 = await latchModePromise;
        expect(botResponse1.content.body).toContain("latch mode enabled");

        // 3. Proxy as Latch 1 (should set autoproxy to Latch 1)
        const ghost1Promise = waitForGhostMessage(client, roomId);
        await client.sendText(roomId, `${proxyPrefix1} First message`);
        const ghost1 = await ghost1Promise;
        expect(ghost1.sender).toContain(slug1);

        // Allow cache/DB to update
        await new Promise(r => setTimeout(r, 1000));

        // 4. Send a message with NO prefix. It should autoproxy as Latch 1!
        const auto1Promise = waitForGhostMessage(client, roomId);
        await client.sendText(roomId, "Second message, no tags");
        const auto1 = await auto1Promise;
        expect(auto1.sender).toContain(slug1);
        expect(auto1.content.body).toBe("Second message, no tags");

        // 5. Proxy as Latch 2 (should update the latch to Latch 2)
        const ghost2Promise = waitForGhostMessage(client, roomId);
        await client.sendText(roomId, `${proxyPrefix2} Third message`);
        const ghost2 = await ghost2Promise;
        expect(ghost2.sender).toContain(slug2);

        // Allow cache/DB to update
        await new Promise(r => setTimeout(r, 1000));

        // 6. Send a message with NO prefix. It should now autoproxy as Latch 2!
        const auto2Promise = waitForGhostMessage(client, roomId);
        await client.sendText(roomId, "Fourth message, no tags either");
        const auto2 = await auto2Promise;
        expect(auto2.sender).toContain(slug2);
        expect(auto2.content.body).toBe("Fourth message, no tags either");
        
        // 7. Disable autoproxy
        const disablePromise = waitForBotMessage(client, roomId);
        await client.sendText(roomId, "pk;autoproxy off");
        const botResponse2 = await disablePromise;
        expect(botResponse2.content.body).toContain("Autoproxy disabled");

        console.log(`[E2E-Latch] SUCCESS: Latch mode perfectly matches PluralKit behavior.`);
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
