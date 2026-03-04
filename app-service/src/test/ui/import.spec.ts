import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';
import * as path from 'path';

test.describe('Web UI System Import and Data Flow', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    test.beforeAll(async () => {
        username = `ui_import_user_${Math.random().toString(36).substring(7)}`;
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

    test('User can import a system via JSON, manage settings, and view members', async ({ page }) => {
        test.setTimeout(90000); // Higher timeout for file uploads and processing

        console.log('[UI-Import-Test] Starting Step 1: LOGIN & SETUP');
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        
        const loginResponsePromise = page.waitForResponse(response => 
            response.url().includes('/api/auth/login') && response.status() === 200
        );
        await page.getByTestId('login-submit-button').click();
        await loginResponsePromise;

        await expect(page).toHaveURL(/\/setup/);
        
        const createSystemPromise = page.waitForResponse(response => 
            response.url().includes('/api/system') && response.request().method() === 'POST' && response.status() === 201
        );
        await page.getByTestId('create-system-button').click();
        await createSystemPromise;
        await page.getByTestId('acknowledge-warning-button').click();
        await page.waitForURL(/\/s\/[a-z0-9-]+/);

        console.log('[UI-Import-Test] Starting Step 2: IMPORT JSON');
        // Open Data menu to access import
        await page.getByTestId('data-menu-button').click();
        
        // Open Import Tool
        await page.getByTestId('import-menu-button').click();
        await expect(page.locator('h2:has-text("Import System")')).toBeVisible();

        // Upload the fixture file
        const fixturePath = path.join(__dirname, 'fixtures', 'sample-import.json');
        
        const importPromise = page.waitForResponse(response => 
            response.url().includes('/api/import/pk/json') && response.request().method() === 'POST'
        );

        // Playwright allows setting files on input[type="file"]
        await page.getByTestId('import-file-input').setInputFiles(fixturePath);
        
        // We must actually click the start button after selecting the file
        await page.getByTestId('start-import-button').click();

        console.log('[UI-Import-Test] Waiting for JSON upload and processing...');
        await page.screenshot({ path: 'test-results/during-import.png' });
        await importPromise;

        // Verify success screen
        await expect(page.getByTestId('import-success-header')).toBeVisible();
        await expect(page.getByTestId('import-success-message')).toContainText('Successfully imported 2 members.');
        
        // If there are no failed avatars, the component auto-calls onComplete after 2 seconds.
        // We do not need to click a finish button here.

        console.log('[UI-Import-Test] Starting Step 3: VERIFY DASHBOARD');
        // The URL should have changed to the imported system's name slug
        await page.waitForURL(/\/s\/fixture-system(-\d+)?/, { timeout: 10000 });
        
        // Check for the imported members (MemberCard shows display name if available)
        await expect(page.getByTestId('member-card-name').filter({ hasText: 'Alice (Core)' })).toBeVisible();
        await expect(page.getByTestId('member-card-name').filter({ hasText: 'Bobby' })).toBeVisible();

        console.log('[UI-Import-Test] Starting Step 4: SYSTEM SETTINGS');
        // Test System Settings Modal
        await page.getByTestId('system-settings-button').click();
        await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();

        // Update the system name
        await page.fill('input[name="name"]', 'Updated System Name');
        
        const updateSystemPromise = page.waitForResponse(response => 
            response.url().includes('/api/system') && response.request().method() === 'PATCH' && response.status() === 200
        );
        
        await page.getByTestId('save-system-settings-button').click();
        await updateSystemPromise;

        // Verify the title on the dashboard updated
        await expect(page.getByTestId('system-title')).toHaveText('Updated System Name');

        console.log('[UI-Import-Test] Starting Step 5: MEMBER CARD INTERACTIONS');
        // Edit an imported member
        await page.click('button[aria-label="Edit Member Alice"]');
        await expect(page.getByRole('heading', { name: 'Edit System Member' })).toBeVisible();
        
        // Change the name and clear the display name so the new name is visible on the card
        await page.fill('input[name="name"]', 'Alicia');
        await page.fill('input[name="displayName"]', '');
        
        const updateMemberPromise = page.waitForResponse(response => 
            response.url().includes('/api/members/') && response.request().method() === 'PATCH' && response.status() === 200
        );
        
        await page.getByTestId('save-member-button').click();
        await updateMemberPromise;

        // Verify the member name updated on the card
        await expect(page.getByTestId('member-card-name').filter({ hasText: 'Alicia' })).toBeVisible();

        console.log('[UI-Import-Test] Success!');
    });
});
