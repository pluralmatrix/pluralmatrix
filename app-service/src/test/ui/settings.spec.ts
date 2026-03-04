import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';
import * as path from 'path';

test.describe('System Settings and Member Management', () => {
    let username: string;
    let fullMxid: string;
    let linkUsername: string;
    let linkFullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    test.beforeAll(async () => {
        // Register primary user
        username = `ui_set_user_${Math.random().toString(36).substring(7)}`;
        fullMxid = await registerUser(username, password);
        const client = await getMatrixClient(username, password);
        matrixAccessToken = client.accessToken;
        await client.stop();

        // Register link target user
        linkUsername = `ui_link_user_${Math.random().toString(36).substring(7)}`;
        linkFullMxid = await registerUser(linkUsername, password);
    });

    test.afterAll(async () => {
        if (fullMxid && matrixAccessToken) {
            await deactivateUser(fullMxid, matrixAccessToken);
        }
        cleanupCryptoStorage(username);
        // Link user gets deleted natively when we delete the primary system since they're linked
    });

    test('User can manage avatar uploads, account links, and view DLQ', async ({ page, context }) => {
        test.setTimeout(60000);

        // Grant clipboard permissions
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);

        // 1. Setup Phase
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        
        const loginPromise = page.waitForResponse(response => response.url().includes('/api/auth/login') && response.status() === 200);
        await page.getByTestId('login-submit-button').click();
        await loginPromise;

        await expect(page).toHaveURL(/\/setup/);
        
        const createSystemPromise = page.waitForResponse(response => response.url().includes('/api/system') && response.status() === 201);
        await page.getByTestId('create-system-button').click();
        await createSystemPromise;
        await page.getByTestId('acknowledge-warning-button').click();
        await page.waitForURL(/\/s\/[a-z0-9-]+/);

        // 2. Member Avatar Upload
        await page.getByTestId('add-member-button').waitFor({ state: 'visible' });
        await page.getByTestId('add-member-button').click();
        
        await expect(page.getByRole('heading', { name: 'New System Member' })).toBeVisible();

        await page.fill('input[name="name"]', 'Avatar Tester');
        await page.fill('input[name="slug"]', 'avatar');
        await page.fill('input[name="prefix"]', 'a:');

        const uploadPromise = page.waitForResponse(response => 
            response.url().includes('/api/media/upload') && response.status() === 200
        );

        const fixturePath = path.join(__dirname, 'fixtures', 'dummy.png');
        // Playwright handles hidden file inputs fine if targeted specifically
        await page.locator('[data-testid="avatar-upload-input"]').setInputFiles(fixturePath);
        
        console.log('[UI-Settings-Test] Waiting for image upload API...');
        await uploadPromise;

        // Image should now be visible in the preview circle
        await expect(page.locator('img[alt="Avatar"]')).toBeVisible();

        const createMemberPromise = page.waitForResponse(response => 
            response.url().includes('/api/members') && response.status() === 201
        );
        await page.getByTestId('save-member-button').click();
        await createMemberPromise;

        // 3. Settings & Account Links
        await page.getByTestId('system-settings-button').click();
        await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();

        // Add a new link
        await page.getByTestId('new-link-input').fill(linkFullMxid);
        
        const addLinkPromise = page.waitForResponse(response => response.url().includes('/api/system/links'));
        await page.getByTestId('add-link-button').click();
        
        const addLinkRes = await addLinkPromise;
        console.log(`[UI-Settings-Test] Add Link Status: ${addLinkRes.status()}`);
        if (addLinkRes.status() !== 201) {
            console.error('[UI-Settings-Test] Add Link failed with body:', await addLinkRes.text());
        }
        expect(addLinkRes.status()).toBe(201);

        // Verify link appeared (check for the text inside the list)
        await expect(page.locator(`text=${linkFullMxid}`)).toBeVisible();

        // Set as primary
        const setPrimaryPromise = page.waitForResponse(response => response.url().includes('/api/system/links/primary') && response.status() === 200);
        await page.getByTestId(`set-primary-${linkFullMxid}`).click();
        await setPrimaryPromise;

        // Remove link
        page.on('dialog', dialog => dialog.accept());
        const removeLinkPromise = page.waitForResponse(response => response.url().includes('/api/system/links') && response.status() === 200);
        await page.getByTestId(`remove-link-${linkFullMxid}`).click();
        await removeLinkPromise;

        await expect(page.locator(`text=${linkFullMxid}`)).not.toBeVisible();

        // 4. Dead Letter Queue
        // Intercept the API to return a mock dead letter instead of relying on the backend state
        await page.route('**/api/system/dead_letters', async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([{
                        id: 'mock-dl-123',
                        timestamp: Date.now(),
                        roomId: '!mockroom:localhost',
                        ghostUserId: '@_plural_ui_set_mock_ghost:localhost',
                        plaintext: 'This message failed to send due to an error.',
                        errorReason: 'Forbidden: Cannot join room'
                    }])
                });
            } else if (route.request().method() === 'DELETE') {
                await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
            } else {
                await route.continue();
            }
        });

        await page.getByTestId('open-dlq-button').click();
        await expect(page.getByTestId('dlq-modal-title')).toBeVisible();
        
        // The mock dead letter should be visible in the list
        await expect(page.locator('text=This message failed to send due to an error.')).toBeVisible();
        await expect(page.locator('text=Forbidden')).toBeVisible();

        // Click the item to view details
        await page.getByTestId('dlq-item-mock-dl-123').click();
        
        // Verify details view
        await expect(page.locator('text=Message Recovery')).toBeVisible();
        await expect(page.locator('text=Forbidden: Cannot join room')).toBeVisible();
        
        // Use a more specific locator for the textarea content
        const textarea = page.locator('textarea');
        await expect(textarea).toHaveValue('This message failed to send due to an error.');

        // Test copy action
        await page.getByTestId('dlq-copy-button').click();
        await expect(page.locator('text=Copied!')).toBeVisible();

        // Verify clipboard content
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toBe('This message failed to send due to an error.');

        // Close details view
        await page.getByTestId('dlq-detail-done-button').click();

        // Test deletion from the list view
        const deletePromise = page.waitForResponse(response => 
            response.url().includes('/api/system/dead_letters/mock-dl-123') && 
            response.request().method() === 'DELETE'
        );
        await page.getByTestId('dlq-delete-mock-dl-123').click();
        await deletePromise;
        
        // Verify it disappeared from the list
        await expect(page.locator('text=This message failed to send due to an error.')).not.toBeVisible();

        await page.getByTestId('dlq-close-button').click();
        
        // Ensure the main settings modal is also closed before trying to interact with the dashboard
        await page.getByTestId('close-settings-button').click();

        // 5. Logout from Dashboard
        console.log('[UI-Settings-Test] Starting Step 5: LOGOUT FROM DASHBOARD');
        await page.getByTestId('dashboard-logout-button').click();
        await expect(page).toHaveURL(/\/login/);
        await expect(page.getByTestId('login-submit-button')).toBeVisible();

        console.log('[UI-Settings-Test] Success!');
    });
});
