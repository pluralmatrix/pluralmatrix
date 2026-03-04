import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';

test.describe('Web UI Onboarding Flow', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    test.beforeAll(async () => {
        username = `ui_test_user_${Math.random().toString(36).substring(7)}`;
        
        // 1. Register a throwaway Matrix user
        fullMxid = await registerUser(username, password);
        
        // 2. Get the user's access token for cleanup later
        const client = await getMatrixClient(username, password);
        matrixAccessToken = client.accessToken;
        await client.stop(); // Stop syncing immediately, we don't need Matrix events here
    });

    test.afterAll(async () => {
        if (fullMxid && matrixAccessToken) {
            await deactivateUser(fullMxid, matrixAccessToken);
        }
        cleanupCryptoStorage(username);
    });

    test('User can log out from the setup page', async ({ page }) => {
        console.log('[UI-Logout-Test] Starting LOGIN');
        await page.goto('/login');
        
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        await page.getByTestId('login-submit-button').click();

        console.log('[UI-Logout-Test] Verifying setup page redirect...');
        await expect(page).toHaveURL(/\/setup/);
        await expect(page.locator('text=You are logged in, but you do not have a system')).toBeVisible();

        console.log('[UI-Logout-Test] Clicking Log out...');
        await page.getByTestId('logout-button').click();

        console.log('[UI-Logout-Test] Verifying login page redirect...');
        await expect(page).toHaveURL(/\/login/);
        await expect(page.getByTestId('login-submit-button')).toBeVisible();
    });

    test('User can log in, create a system, add a member, and delete the system', async ({ page }) => {
        test.setTimeout(60000); // 60 seconds
        
        console.log('[UI-Test] Starting Step 1: LOGIN');
        await page.goto('/login');
        
        // Fill out login form
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        
        const loginResponsePromise = page.waitForResponse(response => 
            response.url().includes('/api/auth/login') && response.status() === 200
        );
        
        await page.getByTestId('login-submit-button').click();
        console.log('[UI-Test] Waiting for login response...');
        await loginResponsePromise;

        console.log('[UI-Test] Starting Step 2: SETUP FLOW');
        console.log(`[UI-Test] Current URL after login: ${page.url()}`);
        await expect(page).toHaveURL(/\/setup/);
        await expect(page.locator('text=You are logged in, but you do not have a system')).toBeVisible();

        const createSystemPromise = page.waitForResponse(response => 
            response.url().includes('/api/system') && response.request().method() === 'POST' && response.status() === 201
        );
        
        await page.getByTestId('create-system-button').click();
        console.log('[UI-Test] Waiting for system creation API...');
        await createSystemPromise;

        console.log('[UI-Test] Waiting for warning screen...');
        await expect(page.locator('text=System Created!')).toBeVisible();
        await expect(page.locator('text=Please Note')).toBeVisible();
        
        await page.getByTestId('acknowledge-warning-button').click();

        console.log('[UI-Test] Starting Step 3: DASHBOARD & MEMBER MANAGEMENT');
        // We wait for navigation rather than just URL match to ensure the DOM has actually updated
        await page.waitForURL(/\/s\/[a-z0-9-]+/);
        console.log(`[UI-Test] Arrived at dashboard URL: ${page.url()}`);
        
        try {
            console.log('[UI-Test] Waiting for Add System Member button...');
            await page.getByTestId('add-member-button').waitFor({ state: 'visible', timeout: 10000 });
            await page.getByTestId('add-member-button').click();
            
            console.log('[UI-Test] Waiting for New System Member modal...');
            await page.waitForSelector('h2:has-text("New System Member")', { timeout: 5000 });
        } catch (e) {
            console.error(`[UI-Test] Failed to find member creation UI. Dumping DOM...`);
            const html = await page.content();
            console.error(html.substring(0, 1500) + '...'); // Print first 1500 chars to avoid overwhelming output
            throw e;
        }

        console.log('[UI-Test] Filling out member form...');
        // Now using reliable name attributes!
        await page.fill('input[name="name"]', 'Playwright Tester');
        await page.fill('input[name="slug"]', 'pwtester');
        await page.fill('input[name="prefix"]', 'pw:');

        const createMemberPromise = page.waitForResponse(response => 
            response.url().includes('/api/members') && response.request().method() === 'POST' && response.status() === 201
        );

        await page.getByTestId('save-member-button').click();
        console.log('[UI-Test] Waiting for member creation API...');
        await createMemberPromise;

        console.log('[UI-Test] Verifying member on dashboard...');
        await expect(page.locator('h3:has-text("Playwright Tester")')).toBeVisible();

        console.log('[UI-Test] Starting Step 4: TEARDOWN VIA UI');
        await page.getByTestId('data-menu-button').click();
        
        const deleteSystemPromise = page.waitForResponse(response => 
            response.url().includes('/api/system') && response.request().method() === 'DELETE' && response.status() === 200
        );

        page.on('dialog', dialog => dialog.accept());
        
        await page.getByTestId('delete-system-menu-button').click();
        console.log('[UI-Test] Waiting for delete system API...');
        await deleteSystemPromise;

        console.log('[UI-Test] Verifying redirect to setup...');
        await expect(page).toHaveURL(/\/setup/);
        await expect(page.locator('text=You are logged in, but you do not have a system')).toBeVisible();
        console.log('[UI-Test] Success!');
    });

});
