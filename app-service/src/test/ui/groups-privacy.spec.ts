import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';

test.describe('Web UI Groups Privacy Flow', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    test.beforeEach(async () => {
        username = `ui_group_priv_${Math.random().toString(36).substring(7)}`;
        
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

    test('Owner can set group description privacy to private and it persists', async ({ page }) => {
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

        // 2. Go to groups tab
        await page.getByTestId('tab-groups').click();

        // 3. Create a Group with description
        await page.click('[data-testid="add-group-button"]');
        await page.fill('input[name="group-name"]', 'Private Group');
        await page.fill('textarea[name="group-description"]', 'A very private group description.');
        await page.getByTestId('save-group-button').click();

        // Wait for group card shows up
        await expect(page.locator('h3:has-text("Private Group")')).toBeVisible();
        await expect(page.locator('p:has-text("A very private group description.")')).toBeVisible();

        // 4. Edit the group to set description to private
        await page.hover('h3:has-text("Private Group")');
        await page.getByTestId('edit-group-privategroup').click();
        await expect(page.getByTestId('group-editor-title')).toBeVisible();
        
        // Switch to privacy tab
        await page.click('button:has-text("Privacy")');
        
        // Find the description privacy toggle.
        const descPrivacyRow = page.locator('span:has-text("description Privacy")').locator('..');
        await descPrivacyRow.locator('button[title="Public"]').click();
        // Click the "Private" option in the dropdown
        await page.click('button:has-text("Private")');
        
        // Save
        await page.getByTestId('save-group-button').click();

        // 5. Verify the group card still shows the description for the owner
        await expect(page.locator('h3:has-text("Private Group")')).toBeVisible();
        await expect(page.locator('p:has-text("A very private group description.")')).toBeVisible();

        // 6. Edit again to verify it persisted as Private
        await page.hover('h3:has-text("Private Group")');
        await page.getByTestId('edit-group-privategroup').click();
        await expect(page.getByTestId('group-editor-title')).toBeVisible();
        await page.click('button:has-text("Privacy")');
        
        // Ensure the description privacy toggle button says Private (via title="Private")
        const privateToggle = page.locator('span:has-text("description Privacy")').locator('..').locator('button[title="Private"]');
        await expect(privateToggle).toBeVisible();

        // Cancel
        await page.getByTestId('cancel-group-button').click();
    });
});