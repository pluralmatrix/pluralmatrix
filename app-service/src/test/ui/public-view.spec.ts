import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';

test.describe('Public System View and Read-Only Modals', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    test.beforeEach(async () => {
        username = `ui_public_user_${Math.random().toString(36).substring(7)}`;
        
        fullMxid = await registerUser(username, password);
        const client = await getMatrixClient(username, password);
        matrixAccessToken = client.accessToken;
        client.stop(); 
    });

    test.afterEach(async () => {
        if (fullMxid && matrixAccessToken) {
            await deactivateUser(fullMxid, matrixAccessToken);
        }
        cleanupCryptoStorage(username);
    });

    test('Unauthenticated user can view public system and read-only modals', async ({ page, context }) => {
        // 1. Log in and setup system with data
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        await page.getByTestId('login-submit-button').click();
        
        await page.waitForURL('/setup');
        await page.getByTestId('create-system-button').click();
        await page.getByTestId('acknowledge-warning-button').click();
        await page.waitForURL(/\/s\/[a-z0-9-]+/);

        // Extract system slug from URL
        const systemUrl = page.url();
        const systemSlug = systemUrl.split('/s/')[1];

        // Add a Member
        await page.getByTestId('add-member-button').click();
        await page.fill('input[name="name"]', 'Public Member');
        await page.fill('input[name="slug"]', 'pub-mem');
        await page.fill('input[name="prefix"]', 'p:');
        await page.fill('textarea', 'A public description for the member.');
        await page.getByTestId('save-member-button').click();
        await expect(page.getByTestId('member-editor-title')).not.toBeVisible();
        
        // Add a Group
        await page.getByTestId('tab-groups').click();
        await page.click('[data-testid="add-group-button"]');
        await page.fill('input[name="group-name"]', 'Public Group');
        await page.fill('textarea[name="group-description"]', 'A public description for the group.');
        // Add member to group
        await page.getByTestId('toggle-member-public-member').click();
        await page.getByTestId('save-group-button').click();

        // 2. Open a new incognito window (unauthenticated)
        const unauthPage = await context.browser()!.newPage();
        await unauthPage.goto(`/s/${systemSlug}`);

        // Verify System data is visible
        await expect(unauthPage.getByTestId('system-title')).toBeVisible();

        // 3. Verify Read-Only Member Modal
        await unauthPage.locator('h3:has-text("Public Member")').click();
        // Since it's read-only, it shouldn't show the "Edit System Member" title
        await expect(unauthPage.getByTestId('member-editor-title')).toHaveText('System Member Profile');
        await expect(unauthPage.locator('p:has-text("A public description for the member.")')).toBeVisible();
        // Close modal
        await unauthPage.getByTestId('cancel-member-button').click();

        await unauthPage.close();
    });
});