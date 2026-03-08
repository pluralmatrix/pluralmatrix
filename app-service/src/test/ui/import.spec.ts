import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';
import * as path from 'path';

test.describe('Web UI System Import and Data Flow', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    test.beforeEach(async () => {
        username = `ui_import_${Math.random().toString(36).substring(7)}`;
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

    test('User can import a system via JSON, manage settings, and view members', async ({ page }) => {
        test.setTimeout(90000); 

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
        await page.getByTestId('data-menu-button').click();
        await page.getByTestId('import-menu-button').click();
        await expect(page.getByTestId('import-modal-title')).toBeVisible();

        const fixturePath = path.join(__dirname, 'fixtures', 'sample-import.json');
        
        const importPromise = page.waitForResponse(response => 
            response.url().includes('/api/import/pk/json') && response.request().method() === 'POST'
        );

        await page.getByTestId('import-file-input').setInputFiles(fixturePath);
        await page.getByTestId('start-import-button').click();

        console.log('[UI-Import-Test] Waiting for JSON upload and processing...');
        await importPromise;

        // Skip checking the success modal because it auto-closes after 2s and can cause race conditions
        
        console.log('[UI-Import-Test] Starting Step 3: VERIFY DASHBOARD');
        // The URL should have changed to the imported system's name slug
        await page.waitForURL(/\/s\/fixture-system(-\d+)?/, { timeout: 10000 });
        
        // Check for the imported members
        await expect(page.getByTestId('member-card-name').filter({ hasText: 'Alice (Core)' })).toBeVisible();
        await expect(page.getByTestId('member-card-name').filter({ hasText: 'Bobby' })).toBeVisible();

        console.log('[UI-Import-Test] Starting Step 4: SYSTEM SETTINGS');
        await page.getByTestId('system-settings-button').click();
        await expect(page.getByTestId('system-settings-title')).toBeVisible();

        await page.fill('input[name="name"]', 'Updated System Name');
        
        const updateSystemPromise = page.waitForResponse(response => 
            response.url().includes('/api/system') && response.request().method() === 'PATCH' && response.status() === 200
        );
        
        await page.getByTestId('save-system-settings-button').click();
        await updateSystemPromise;

        await expect(page.getByTestId('system-title')).toHaveText('Updated System Name');

        console.log('[UI-Import-Test] Starting Step 5: MEMBER CARD INTERACTIONS');
        await page.click('button[aria-label="Edit Member Alice"]');
        await expect(page.getByTestId('member-editor-title')).toBeVisible();
        
        await page.fill('input[name="name"]', 'Alicia');
        await page.fill('input[name="displayName"]', '');
        
        const updateMemberPromise = page.waitForResponse(response => 
            response.url().includes('/api/members/') && response.request().method() === 'PATCH' && response.status() === 200
        );
        
        await page.getByTestId('save-member-button').click();
        await updateMemberPromise;

        await expect(page.getByTestId('member-card-name').filter({ hasText: 'Alicia' })).toBeVisible();

        console.log('[UI-Import-Test] Starting Step 6: AUTOPROXY & DELETION');
        const aliceCardName = page.getByTestId('member-card-name').filter({ hasText: 'Alicia' });
        await aliceCardName.hover();

        const autoproxyEnablePromise = page.waitForResponse(response => 
            response.url().includes('/api/system') && response.request().method() === 'PATCH' && response.status() === 200
        );
        
        await page.getByTestId('toggle-autoproxy-alice').click();
        await autoproxyEnablePromise;
        await expect(page.locator('text=Autoproxy').first()).toBeVisible();

        const autoproxyDisablePromise = page.waitForResponse(response => 
            response.url().includes('/api/system') && response.request().method() === 'PATCH' && response.status() === 200
        );
        
        await page.getByTestId('toggle-autoproxy-alice').click();
        await autoproxyDisablePromise;
        await expect(page.locator('text=Autoproxy')).not.toBeVisible();

        page.on('dialog', dialog => dialog.accept());
        const deleteMemberPromise = page.waitForResponse(response => 
            response.url().includes('/api/members/') && response.request().method() === 'DELETE' && response.status() === 200
        );
        
        await aliceCardName.hover();
        await page.getByTestId('delete-member-alice').click();
        await deleteMemberPromise;
        
        await expect(page.getByTestId('member-card-name').filter({ hasText: 'Alicia' })).not.toBeVisible();

        console.log('[UI-Import-Test] Starting Step 7: DATA EXPORT');
        await page.getByTestId('data-menu-button').click();
        
        const pkExportPromise = page.waitForEvent('download');
        await page.getByTestId('export-pk-button').click();
        const pkDownload = await pkExportPromise;
        expect(pkDownload.suggestedFilename()).toContain('pluralkit_export_');

        console.log('[UI-Import-Test] Success!');
    });

    test('User can import a full backup via ZIP including avatars', async ({ page }) => {
        test.setTimeout(90000); 

        console.log('[UI-Zip-Import-Test] Starting Step 1: LOGIN & SETUP');
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

        console.log('[UI-Zip-Import-Test] Starting Step 2: IMPORT ZIP');
        await page.getByTestId('data-menu-button').click();
        await page.getByTestId('import-menu-button').click();
        await expect(page.getByTestId('import-modal-title')).toBeVisible();

        const fixturePath = path.join(__dirname, 'fixtures', 'sample-backup.zip');
        
        const importPromise = page.waitForResponse(response => 
            response.url().includes('/api/import/backup/zip') && response.request().method() === 'POST'
        );

        await page.getByTestId('import-file-input').setInputFiles(fixturePath);
        await page.getByTestId('start-import-button').click();

        console.log('[UI-Zip-Import-Test] Waiting for ZIP upload and processing...');
        await importPromise;

        console.log('[UI-Zip-Import-Test] Starting Step 3: VERIFY DASHBOARD');
        await page.waitForURL(/\/s\/zip-system(-\d+)?/, { timeout: 10000 });
        
        await expect(page.getByTestId('member-card-name').filter({ hasText: 'AliceZip' })).toBeVisible();
        await expect(page.getByTestId('member-avatar')).toBeVisible();

        console.log('[UI-Zip-Import-Test] Success!');
    });

    test('User can see failed avatars during import', async ({ page }) => {
        test.setTimeout(60000);

        console.log('[UI-Import-Fail-Test] Starting Step 1: LOGIN & SETUP');
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