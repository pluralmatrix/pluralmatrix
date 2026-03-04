import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Import Tool Error Handling', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    const fixturesDir = path.join(__dirname, 'fixtures');
    const malformedJsonPath = path.join(fixturesDir, 'malformed.json');
    const invalidExtPath = path.join(fixturesDir, 'invalid.txt');

    test.beforeAll(async () => {
        username = `ui_import_err_${Math.random().toString(36).substring(7)}`;
        fullMxid = await registerUser(username, password);
        const client = await getMatrixClient(username, password);
        matrixAccessToken = client.accessToken;
        await client.stop();

        if (!fs.existsSync(fixturesDir)) {
            fs.mkdirSync(fixturesDir, { recursive: true });
        }

        fs.writeFileSync(malformedJsonPath, '{ "invalid": json ');
        fs.writeFileSync(invalidExtPath, 'not a json or zip');
    });

    test.afterAll(async () => {
        if (fullMxid && matrixAccessToken) {
            await deactivateUser(fullMxid, matrixAccessToken);
        }
        cleanupCryptoStorage(username);

        if (fs.existsSync(malformedJsonPath)) fs.unlinkSync(malformedJsonPath);
        if (fs.existsSync(invalidExtPath)) fs.unlinkSync(invalidExtPath);
    });

    test.beforeEach(async ({ page }) => {
        console.log('[UI-Import-Err-Test] Starting beforeEach...');
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        await page.getByTestId('login-submit-button').click();

        console.log('[UI-Import-Err-Test] Waiting for redirect...');
        // It could go to /setup or /s/ depending on if system creation already happened (it shouldn't yet)
        await page.waitForURL(url => url.pathname.includes('/setup') || url.pathname.includes('/s/'), { timeout: 30000 });
        
        if (page.url().includes('/setup')) {
            console.log('[UI-Import-Err-Test] On setup page, creating system...');
            await page.getByTestId('create-system-button').click();
            await page.getByTestId('acknowledge-warning-button').click();
            await page.waitForURL(/\/s\/[a-z0-9-]+/);
        }

        console.log('[UI-Import-Err-Test] On dashboard, opening import menu...');
        await page.getByTestId('data-menu-button').click();
        await page.getByTestId('import-menu-button').click();
        console.log('[UI-Import-Err-Test] beforeEach complete.');
    });

    test('User sees error for malformed JSON file', async ({ page }) => {
        await page.getByTestId('import-file-input').setInputFiles(malformedJsonPath);
        await page.getByTestId('start-import-button').click();

        await expect(page.locator('text=Import Failed')).toBeVisible();
        await expect(page.locator('text=Invalid JSON file or server error.')).toBeVisible();
    });

    test('User sees error for invalid file extension', async ({ page }) => {
        // We need to bypass the 'accept' attribute check in the browser if possible, 
        // or just rely on the component's internal check if we can force the file.
        // Actually setInputFiles doesn't care about the 'accept' attribute.
        await page.getByTestId('import-file-input').setInputFiles(invalidExtPath);
        await page.getByTestId('start-import-button').click();

        await expect(page.locator('text=Import Failed')).toBeVisible();
        await expect(page.locator('text=Please upload a .json or .zip file.')).toBeVisible();
    });

    test('User sees error for server failure during JSON import', async ({ page }) => {
        await page.route('**/api/import/pk/json', route => route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal Server Error' })
        }));

        // Use a valid JSON for the file part
        const validJsonPath = path.join(fixturesDir, 'sample-import.json');
        await page.getByTestId('import-file-input').setInputFiles(validJsonPath);
        await page.getByTestId('start-import-button').click();

        await expect(page.locator('text=Import Failed')).toBeVisible();
        await expect(page.locator('text=Invalid JSON file or server error.')).toBeVisible();
    });

    test('User sees error for server failure during ZIP import', async ({ page }) => {
        await page.route('**/api/import/backup/zip', route => route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal Server Error' })
        }));

        const validZipPath = path.join(fixturesDir, 'sample-backup.zip');
        await page.getByTestId('import-file-input').setInputFiles(validZipPath);
        await page.getByTestId('start-import-button').click();

        await expect(page.locator('text=Import Failed')).toBeVisible();
        await expect(page.locator('text=Failed to process ZIP backup.')).toBeVisible();
    });
});
