import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';
import * as path from 'path';

test.describe('Web UI System Import and Data Flow', () => {
    let jsonUsername: string;
    let jsonFullMxid: string;
    let jsonMatrixAccessToken: string;

    let zipUsername: string;
    let zipFullMxid: string;
    let zipMatrixAccessToken: string;

    const password = "ui_test_password";

    test.beforeAll(async () => {
        // User for JSON import test
        jsonUsername = `ui_import_json_${Math.random().toString(36).substring(7)}`;
        jsonFullMxid = await registerUser(jsonUsername, password);
        const jsonClient = await getMatrixClient(jsonUsername, password);
        jsonMatrixAccessToken = jsonClient.accessToken;
        await jsonClient.stop();

        // User for ZIP import test
        zipUsername = `ui_import_zip_${Math.random().toString(36).substring(7)}`;
        zipFullMxid = await registerUser(zipUsername, password);
        const zipClient = await getMatrixClient(zipUsername, password);
        zipMatrixAccessToken = zipClient.accessToken;
        await zipClient.stop();
    });

    test.afterAll(async () => {
        if (jsonFullMxid && jsonMatrixAccessToken) {
            await deactivateUser(jsonFullMxid, jsonMatrixAccessToken);
        }
        cleanupCryptoStorage(jsonUsername);

        if (zipFullMxid && zipMatrixAccessToken) {
            await deactivateUser(zipFullMxid, zipMatrixAccessToken);
        }
        cleanupCryptoStorage(zipUsername);
    });

    test('User can import a system via JSON, manage settings, and view members', async ({ page }) => {
        test.setTimeout(90000); // Higher timeout for file uploads and processing

        console.log('[UI-Import-Test] Starting Step 1: LOGIN & SETUP');
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(jsonFullMxid);
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

    test('User can import a full backup via ZIP including avatars', async ({ page }) => {
        test.setTimeout(90000); 

        console.log('[UI-Zip-Import-Test] Starting Step 1: LOGIN & SETUP');
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(zipFullMxid);
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

        console.log('[UI-Zip-Import-Test] Starting Step 2: IMPORT ZIP');
        await page.getByTestId('data-menu-button').click();
        
        await page.getByTestId('import-menu-button').click();
        await expect(page.getByRole('heading', { name: 'Import System' })).toBeVisible();

        const fixturePath = path.join(__dirname, 'fixtures', 'sample-backup.zip');
        
        const importPromise = page.waitForResponse(response => 
            response.url().includes('/api/import/backup/zip') && response.request().method() === 'POST'
        );

        await page.getByTestId('import-file-input').setInputFiles(fixturePath);
        
        await page.getByTestId('start-import-button').click();

        console.log('[UI-Zip-Import-Test] Waiting for ZIP upload and processing...');
        await importPromise;

        // Verify success screen
        await expect(page.getByTestId('import-success-header')).toBeVisible();
        await expect(page.getByTestId('import-success-message')).toContainText('Successfully imported 1 members.');
        
        console.log('[UI-Zip-Import-Test] Starting Step 3: VERIFY DASHBOARD');
        await page.waitForURL(/\/s\/zip-system(-\d+)?/, { timeout: 10000 });
        
        // Check for the imported member
        await expect(page.getByTestId('member-card-name').filter({ hasText: 'AliceZip' })).toBeVisible();
        
        // Verify that the avatar image was uploaded successfully by checking if the avatar image tag exists
        // The mock fixture sets the avatar URL, and the backend re-uploads the dummy.png to Synapse.
        await expect(page.getByTestId('member-avatar')).toBeVisible();

        console.log('[UI-Zip-Import-Test] Success!');
    });

    test('User can see failed avatars during import', async ({ page }) => {
        test.setTimeout(60000);

        console.log('[UI-Import-Fail-Test] Starting Step 1: LOGIN & SETUP');
        // Let's reuse the jsonFullMxid since it's deactivated in afterAll
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(jsonFullMxid);
        await page.getByTestId('login-password-input').fill(password);
        
        await page.getByTestId('login-submit-button').click();
        await page.waitForURL(/\/s\/[a-z0-9-]+/);

        console.log('[UI-Import-Fail-Test] Starting Step 2: MOCK IMPORT');
        await page.getByTestId('data-menu-button').click();
        await page.getByTestId('import-menu-button').click();

        await page.route('**/api/import/pk/json', async route => {
            if (route.request().method() === 'POST') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        count: 1,
                        systemSlug: 'mock-system',
                        failedAvatars: [{
                            slug: 'mock_member',
                            name: 'Mock Member',
                            error: 'Image must be under 1024 KB'
                        }]
                    })
                });
            } else {
                await route.continue();
            }
        });

        const fixturePath = path.join(__dirname, 'fixtures', 'sample-import.json');
        await page.getByTestId('import-file-input').setInputFiles(fixturePath);
        
        await page.getByTestId('start-import-button').click();

        console.log('[UI-Import-Fail-Test] Waiting for mock response...');
        await expect(page.getByTestId('import-success-header')).toBeVisible();
        await expect(page.getByTestId('import-success-message')).toContainText('Successfully imported 1 members.');
        
        console.log('[UI-Import-Fail-Test] Verifying failed avatars UI...');
        // Verify the warning box appears
        await expect(page.locator('text=Mock Member')).toBeVisible();
        await expect(page.locator('text=Image must be under 1024 KB')).toBeVisible();

        // The user must manually click finish since there were errors
        await page.click('button:has-text("Got it, Finish")');

        console.log('[UI-Import-Fail-Test] Success!');
    });
});
