import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';
import * as path from 'path';

test.describe('Web UI Groups Flow', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    test.beforeEach(async () => {
        username = `ui_group_user_${Math.random().toString(36).substring(7)}`;
        
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
        await page.getByTestId('tab-groups').click();

        // Step 3: Create a Group
        await page.click('[data-testid="add-group-button"]');
        await page.fill('input[name="group-name"]', 'Cool Group');
        await page.fill('textarea[name="group-description"]', 'A very cool group.');
        // Select Lily
        await page.getByTestId('toggle-member-lily').click();
        await page.getByTestId('save-group-button').click();

        // Verify group card shows up
        await expect(page.locator('h3:has-text("Cool Group")')).toBeVisible();
        await expect(page.locator('div:has-text("1 Member")').last()).toBeVisible();

        // Switch to members tab and verify tag
        await page.getByTestId('tab-members').click();
        await expect(page.getByTestId('member-tag-cool-group')).toBeVisible();

        // Step 4: Add member to new group via Member Editor
        await page.getByTestId('tab-groups').click();
        await page.click('[data-testid="add-group-button"]');
        await page.fill('input[name="group-name"]', 'Another Group');
        await page.getByTestId('save-group-button').click();
        
        await page.getByTestId('tab-members').click();
        await page.hover('h3:has-text("Lily")');
        await page.getByTestId('edit-member-lily').click();
        
        // Ensure modal is open and the groups section is visible
        await expect(page.getByTestId('member-editor-title')).toBeVisible();
        await expect(page.locator('label:has-text("Groups")')).toBeVisible();

        // Ensure "Cool Group" is currently selected (has the primary matrix color class)
        await expect(page.getByTestId('toggle-group-cool-group')).toHaveClass(/bg-matrix-primary/);

        // Click "Another Group" to select it
        await page.getByTestId('toggle-group-another-group').click();
        await page.getByTestId('save-member-button').click();

        // Wait for modal to close indicating save is done
        await expect(page.getByTestId('member-editor-title')).toHaveCount(0);

        // Verify member now has both group tags
        await expect(page.locator('span:has-text("Cool Group")').first()).toBeVisible();
        await expect(page.locator('span:has-text("Another Group")').first()).toBeVisible();

        // Step 5: Test Member Avatar Upload and Clear
        await page.hover('h3:has-text("Lily")');
        await page.getByTestId('edit-member-lily').click();
        await expect(page.getByTestId('member-editor-title')).toBeVisible();

        const memberAvatarUploadPromise = page.waitForResponse(response => 
            response.url().includes('/api/media/upload') && response.status() === 200
        );
        await page.locator('[data-testid="avatar-upload-input"]').setInputFiles(path.resolve(__dirname, 'fixtures/dummy.png'));
        await memberAvatarUploadPromise;
        await expect(page.locator('img[alt="Avatar"]')).toBeVisible();

        await page.getByTestId('save-member-button').click();
        await expect(page.getByTestId('member-editor-title')).toHaveCount(0);

        await page.hover('h3:has-text("Lily")');
        await page.getByTestId('edit-member-lily').click();
        await expect(page.locator('img[alt="Avatar"]')).toBeVisible();
        
        await page.locator('button[title="Clear Avatar"]').click();
        await expect(page.locator('img[alt="Avatar"]')).not.toBeVisible();
        
        await page.getByTestId('save-member-button').click();
        await expect(page.getByTestId('member-editor-title')).toHaveCount(0);

        // Step 6: Test Group Icon Upload and Clear
        await page.getByTestId('tab-groups').click();

        const coolGroupCard = page.getByTestId('group-card-coolgroup');
        await coolGroupCard.hover();
        await coolGroupCard.getByTestId('edit-group-coolgroup').click();

        // Upload icon
        const groupIconUploadPromise = page.waitForResponse(response => 
            response.url().includes('/api/media/upload') && response.status() === 200
        );
        await page.locator('[data-testid="icon-upload-input"]').setInputFiles(path.resolve(__dirname, 'fixtures/dummy.png'));
        await groupIconUploadPromise;
        await expect(page.locator('img[alt="Icon"]')).toBeVisible();

        // Save
        await page.getByTestId('save-group-button').click();
        await expect(page.getByTestId('group-editor-title')).toHaveCount(0);

        // Edit again and clear icon
        await page.mouse.move(0, 0);
        await coolGroupCard.hover();
        await coolGroupCard.getByTestId('edit-group-coolgroup').click();

        await expect(page.locator('img[alt="Icon"]')).toBeVisible();
        await page.locator('button[title="Clear Icon"]').click();
        await expect(page.locator('img[alt="Icon"]')).not.toBeVisible();

        await page.fill('input[name="group-name"]', 'Super Cool Group');
        await page.getByTestId('save-group-button').click();
        await expect(page.locator('h3:has-text("Super Cool Group")')).toBeVisible();

        // Step 7: Delete Group
        const superCoolGroupCard = page.getByTestId('group-card-coolgroup');
        await superCoolGroupCard.hover();
        page.once('dialog', dialog => {
            expect(dialog.type()).toBe('confirm');
            dialog.accept();
        });
        await superCoolGroupCard.getByTestId('delete-group-coolgroup').click();

        await expect(page.locator('h3:has-text("Super Cool Group")')).not.toBeVisible();
    });

    test('User receives a warning when closing an editor with unsaved changes', async ({ page }) => {
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        await page.getByTestId('login-submit-button').click();
        
        await page.waitForURL('/setup');
        await page.getByTestId('create-system-button').click();
        await expect(page.locator('text=Please Note')).toBeVisible();
        await page.getByTestId('acknowledge-warning-button').click();
        await page.waitForURL(/\/s\/[a-z0-9-]+/);

        // Open member editor and make a change
        await page.getByTestId('add-member-button').click();
        await expect(page.getByTestId('member-editor-title')).toBeVisible();

        // 1. Test clicking cancel without changes (should close immediately)
        await page.getByTestId('cancel-member-button').click();
        await expect(page.getByTestId('member-editor-title')).not.toBeVisible();

        // 2. Test clicking cancel WITH changes (should prompt and cancel if dismissed)
        await page.getByTestId('add-member-button').click();
        await page.fill('input[name="name"]', 'Unsaved Member');
        
        // Setup dialog handler to DISMISS the dirty state warning
        let dialogHandled = false;
        page.once('dialog', dialog => {
            expect(dialog.message()).toContain('unsaved changes');
            dialog.dismiss();
            dialogHandled = true;
        });

        await page.getByTestId('cancel-member-button').click();
        
        // Ensure dialog was triggered and modal is STILL visible
        expect(dialogHandled).toBe(true);
        await expect(page.getByTestId('member-editor-title')).toBeVisible();

        // 3. Test clicking cancel WITH changes and ACCEPTING the warning (should close)
        page.once('dialog', dialog => dialog.accept());
        await page.getByTestId('cancel-member-button').click();
        
        // Ensure modal is gone
        await expect(page.getByTestId('member-editor-title')).not.toBeVisible();
    });
});
