import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';
import * as path from 'path';

test.describe('Web UI Groups Flow', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    test.beforeAll(async () => {
        username = `ui_group_user_${Math.random().toString(36).substring(7)}`;
        
        fullMxid = await registerUser(username, password);
        const client = await getMatrixClient(username, password);
        matrixAccessToken = client.accessToken;
        await client.stop(); 
    });

    test.afterAll(async () => {
        if (fullMxid && matrixAccessToken) {
            await deactivateUser(fullMxid, matrixAccessToken);
        }
        cleanupCryptoStorage(username);
    });

    test('User can create, edit, and delete groups, and add members', async ({ page }) => {
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        await page.getByTestId('login-submit-button').click();
        
        await page.waitForURL('/setup');
        await page.getByTestId('create-system-button').click();
        await expect(page.locator('text=Please Note')).toBeVisible();
        await page.getByTestId('acknowledge-warning-button').click();
        await page.waitForURL(/\/s\/[a-z0-9-]+/);

        // Step 1: Create a member to add to the group
        await page.getByTestId('add-member-button').click();
        await page.fill('input[name="name"]', 'Lily');
        await page.fill('input[name="slug"]', 'lily');
        await page.fill('input[name="prefix"]', 'lily:');
        await page.getByTestId('save-member-button').click();
        await expect(page.locator('h3:has-text("Lily")')).toBeVisible();

        // Step 2: Switch to Groups Tab
        await page.click('button:has-text("Groups (0)")');

        // Step 3: Create a Group
        await page.click('[data-testid="add-group-button"]');
        await page.fill('input[name="group-name"]', 'Cool Group');
        await page.fill('textarea[name="group-description"]', 'A very cool group.');
        // Select Lily
        await page.getByTestId('toggle-member-lily').click();
        await page.click('button:has-text("Save Group")');

        // Verify group card shows up
        await expect(page.locator('h3:has-text("Cool Group")')).toBeVisible();
        await expect(page.locator('div:has-text("1 Member")').last()).toBeVisible();

        // Switch to members tab and verify tag
        await page.click('button:has-text("Members (1)")');
        await expect(page.getByTestId('member-tag-cool-group')).toBeVisible();

        // Step 4: Add member to new group via Member Editor
        await page.click('button:has-text("Groups (1)")');
        await page.click('[data-testid="add-group-button"]');
        await page.fill('input[name="group-name"]', 'Another Group');
        await page.click('button:has-text("Save Group")');
        
        await page.click('button:has-text("Members (1)")');
        await page.hover('h3:has-text("Lily")');
        await page.getByTestId('edit-member-lily').click();
        
        // Ensure modal is open and the groups section is visible
        await expect(page.locator('h2:has-text("Edit System Member")')).toBeVisible();
        await expect(page.locator('label:has-text("Groups")')).toBeVisible();

        // Ensure "Cool Group" is currently selected (has the primary matrix color class)
        await expect(page.getByTestId('toggle-group-cool-group')).toHaveClass(/bg-matrix-primary/);

        // Click "Another Group" to select it
        await page.getByTestId('toggle-group-another-group').click();
        await page.getByTestId('save-member-button').click();

        // Wait for modal to close indicating save is done
        await page.waitForTimeout(500);
        await expect(page.locator('h2:has-text("Edit System Member")')).not.toBeVisible();

        // Verify member now has both group tags
        await expect(page.locator('span:has-text("Cool Group")').first()).toBeVisible();
        await expect(page.locator('span:has-text("Another Group")').first()).toBeVisible();

        // Step 5: Test Member Avatar Upload and Clear
        await page.hover('h3:has-text("Lily")');
        await page.getByTestId('edit-member-lily').click();
        await expect(page.locator('h2:has-text("Edit System Member")')).toBeVisible();

        const memberAvatarUploadPromise = page.waitForResponse(response => 
            response.url().includes('/api/media/upload') && response.status() === 200
        );
        await page.locator('[data-testid="avatar-upload-input"]').setInputFiles(path.resolve(__dirname, 'fixtures/dummy.png'));
        await memberAvatarUploadPromise;
        await expect(page.locator('img[alt="Avatar"]')).toBeVisible();

        await page.getByTestId('save-member-button').click();
        await page.waitForTimeout(500);

        await page.hover('h3:has-text("Lily")');
        await page.getByTestId('edit-member-lily').click();
        await expect(page.locator('img[alt="Avatar"]')).toBeVisible();
        
        await page.locator('button[title="Clear Avatar"]').click();
        await expect(page.locator('img[alt="Avatar"]')).not.toBeVisible();
        
        await page.getByTestId('save-member-button').click();
        await page.waitForTimeout(500);

        // Step 6: Test Group Icon Upload and Clear
        await page.click('button:has-text("Groups (2)")');
        await page.hover('h3:has-text("Cool Group")');
        await page.locator('div.group', { hasText: 'Cool Group' }).locator('button[title="Edit Group"]').click();

        // Upload icon
        const groupIconUploadPromise = page.waitForResponse(response => 
            response.url().includes('/api/media/upload') && response.status() === 200
        );
        await page.locator('[data-testid="icon-upload-input"]').setInputFiles(path.resolve(__dirname, 'fixtures/dummy.png'));
        await groupIconUploadPromise;
        await expect(page.locator('img[alt="Icon"]')).toBeVisible();

        // Save
        await page.click('button:has-text("Save Group")');
        await page.waitForTimeout(500);

        // Edit again and clear icon
        await page.hover('h3:has-text("Cool Group")');
        await page.locator('div.group', { hasText: 'Cool Group' }).locator('button[title="Edit Group"]').click();

        await expect(page.locator('img[alt="Icon"]')).toBeVisible();
        await page.locator('button[title="Clear Icon"]').click();
        await expect(page.locator('img[alt="Icon"]')).not.toBeVisible();

        await page.fill('input[name="group-name"]', 'Super Cool Group');
        await page.click('button:has-text("Save Group")');
        await expect(page.locator('h3:has-text("Super Cool Group")')).toBeVisible();

        // Step 6: Delete Group
        await page.hover('h3:has-text("Super Cool Group")');
        page.on('dialog', dialog => dialog.accept()); // Accept the confirmation dialog
        await page.locator('div.group', { hasText: 'Super Cool Group' }).locator('button[title="Delete Group"]').click();

        await expect(page.locator('h3:has-text("Super Cool Group")')).not.toBeVisible();
    });
});
