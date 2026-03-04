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
        await page.fill('input[placeholder="@user:server.com"]', fullMxid);
        await page.fill('input[placeholder="Password"]', password);
        
        const loginResponsePromise = page.waitForResponse(response => 
            response.url().includes('/api/auth/login') && response.status() === 200
        );
        await page.click('button:has-text("Sign In")');
        await loginResponsePromise;

        await expect(page).toHaveURL(/\/setup/);
        
        const createSystemPromise = page.waitForResponse(response => 
            response.url().includes('/api/system') && response.request().method() === 'POST' && response.status() === 201
        );
        await page.click('button:has-text("Create a System")');
        await createSystemPromise;
        await page.click('button:has-text("I understand, proceed to Dashboard")');
        await page.waitForURL(/\/s\/[a-z0-9-]+/);

        console.log('[UI-Import-Test] Starting Step 2: IMPORT JSON');
        // Open Data menu to access import
        await page.click('button:has-text("Data")');
        
        // Open Import Tool
        await page.click('button:has-text("Import System")');
        await expect(page.locator('h2:has-text("Import System")')).toBeVisible();

        // Upload the fixture file
        const fixturePath = path.join(__dirname, 'fixtures', 'sample-import.json');
        
        const importPromise = page.waitForResponse(response => 
            response.url().includes('/api/import/pk/json') && response.request().method() === 'POST'
        );

        // Playwright allows setting files on input[type="file"]
        await page.setInputFiles('input[type="file"]', fixturePath);
        
        // We must actually click the start button after selecting the file
        await page.click('button:has-text("Start Import")');

        console.log('[UI-Import-Test] Waiting for JSON upload and processing...');
        await page.screenshot({ path: 'test-results/during-import.png' });
        await importPromise;

        // Verify success screen
        await expect(page.locator('text=Import Successful!')).toBeVisible();
        await expect(page.locator('text=Successfully imported 2 members.')).toBeVisible();
        
        // If there are no failed avatars, the component auto-calls onComplete after 2 seconds.
        // We do not need to click a finish button here.

        console.log('[UI-Import-Test] Starting Step 3: VERIFY DASHBOARD');
        // The URL should have changed to the imported system's name slug
        await page.waitForURL(/\/s\/fixture-system(-\d+)?/, { timeout: 10000 });
        
        // Check for the imported members (MemberCard shows display name if available)
        await expect(page.locator('h3:has-text("Alice (Core)")')).toBeVisible();
        await expect(page.locator('h3:has-text("Bobby")')).toBeVisible();

        console.log('[UI-Import-Test] Starting Step 4: SYSTEM SETTINGS');
        // Test System Settings Modal
        await page.click('button[title="Edit System Settings"]');
        await expect(page.locator('h2:has-text("System Settings")')).toBeVisible();

        // Update the system name
        await page.fill('input[name="name"]', 'Updated System Name');
        
        const updateSystemPromise = page.waitForResponse(response => 
            response.url().includes('/api/system') && response.request().method() === 'PATCH' && response.status() === 200
        );
        
        await page.click('button:has-text("Save General Settings")');
        await updateSystemPromise;

        // Verify the title on the dashboard updated
        await expect(page.locator('h2:has-text("Updated System Name")')).toBeVisible();

        console.log('[UI-Import-Test] Starting Step 5: MEMBER CARD INTERACTIONS');
        // Edit an imported member
        await page.click('button[aria-label="Edit Member Alice"]');
        await expect(page.locator('h2:has-text("Edit System Member")')).toBeVisible();
        
        // Change the name and clear the display name so the new name is visible on the card
        await page.fill('input[name="name"]', 'Alicia');
        await page.fill('input[name="displayName"]', '');
        
        const updateMemberPromise = page.waitForResponse(response => 
            response.url().includes('/api/members/') && response.request().method() === 'PATCH' && response.status() === 200
        );
        
        await page.click('button:has-text("Save Member")');
        await updateMemberPromise;

        // Verify the member name updated on the card
        await expect(page.locator('h3:has-text("Alicia")')).toBeVisible();

        console.log('[UI-Import-Test] Success!');
    });
});
