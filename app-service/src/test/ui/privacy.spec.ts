import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';

test.describe('Web UI Privacy Settings', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    test.beforeEach(async () => {
        username = `ui_privacy_user_${Math.random().toString(36).substring(7)}`;
        
        fullMxid = await registerUser(username, password);
        const client = await getMatrixClient(username, password);
        matrixAccessToken = client.accessToken;
        await client.stop(); 
    });

    test.afterEach(async () => {
        if (fullMxid && matrixAccessToken) {
            await deactivateUser(fullMxid, matrixAccessToken);
        }
        cleanupCryptoStorage(username);
    });

    test('Owner can set member description privacy to private and still see it in the dashboard', async ({ page }) => {
        page.on('console', msg => console.log(`[Browser] ${msg.text()}`));
        page.on('response', async (res) => {
            if (res.status() === 400) {
                console.log(`[Browser] 400 Error: ${await res.text()}`);
            }
        });
        
        // 1. Log in and setup system
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        await page.getByTestId('login-submit-button').click();
        
        await page.waitForURL('/setup');
        await page.getByTestId('create-system-button').click();
        await expect(page.locator('text=Please Note')).toBeVisible();
        await page.getByTestId('acknowledge-warning-button').click();
        await page.waitForURL(/\/s\/[a-z0-9-]+/);

        // 2. Create a member with a description
        await page.getByTestId('add-member-button').click();
        await page.fill('input[name="name"]', 'Private Member');
        await page.fill('input[name="slug"]', 'priv-mem');
        await page.fill('input[name="prefix"]', 'priv:');
        await page.fill('textarea', 'This is a super secret description.');
        await page.getByTestId('save-member-button').click();
        
        // Wait for it to appear
        await expect(page.locator('h3:has-text("Private Member")')).toBeVisible();
        await expect(page.locator('p:has-text("This is a super secret description.")')).toBeVisible();

        // 3. Edit the member to set description to private
        await page.hover('h3:has-text("Private Member")');
        await page.getByTestId('edit-member-priv-mem').click();
        await expect(page.getByTestId('member-editor-title')).toBeVisible();
        
        // Switch to privacy tab
        await page.click('button:has-text("Privacy")');
        
        // Find the description privacy toggle.
        const descPrivacyRow = page.locator('span:has-text("description Privacy")').locator('..');
        await descPrivacyRow.locator('button[title="Public"]').click();
        // Click the "Private" option in the dropdown
        await page.click('button:has-text("Private")');
        
        // Save
        await page.getByTestId('save-member-button').click();

        // 4. Verify the member card still shows the description for the owner
        await expect(page.getByTestId('member-editor-title')).toHaveCount(0);
        await expect(page.locator('h3:has-text("Private Member")')).toBeVisible();
        await expect(page.locator('p:has-text("This is a super secret description.")')).toBeVisible();

        // 5. Edit again to verify it persisted as Private
        await page.hover('h3:has-text("Private Member")');
        await page.getByTestId('edit-member-priv-mem').click();
        await expect(page.getByTestId('member-editor-title')).toBeVisible();
        await page.click('button:has-text("Privacy")');
        
        // Ensure the description privacy toggle button says Private (via title="Private")
        const privateToggle = page.locator('span:has-text("description Privacy")').locator('..').locator('button[title="Private"]');
        await expect(privateToggle).toBeVisible();

        // Cancel
        await page.getByTestId('cancel-member-button').click();
    });
});
