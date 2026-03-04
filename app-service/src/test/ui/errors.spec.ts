import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

test.describe('Frontend Error Resilience', () => {
    let username: string;
    let fullMxid: string;
    const password = "ui_test_password";
    let matrixAccessToken: string;

    const fixturesDir = path.join(__dirname, 'fixtures');
    const badFilePath = path.join(fixturesDir, 'bad-file.txt');
    const largeFilePath = path.join(fixturesDir, 'too-large.png');

    test.beforeAll(async () => {
        username = `ui_error_user_${Math.random().toString(36).substring(7)}`;
        fullMxid = await registerUser(username, password);
        const client = await getMatrixClient(username, password);
        matrixAccessToken = client.accessToken;
        await client.stop();

        // Ensure fixtures directory exists
        if (!fs.existsSync(fixturesDir)) {
            fs.mkdirSync(fixturesDir, { recursive: true });
        }

        // Generate fixtures
        fs.writeFileSync(badFilePath, 'This is definitely not an image');
        
        // Generate a 2MB file
        const dummyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        fs.writeFileSync(largeFilePath, Buffer.from(dummyPngBase64, 'base64'));
        execSync(`truncate -s 2M "${largeFilePath}"`);
    });

    test.afterAll(async () => {
        if (fullMxid && matrixAccessToken) {
            await deactivateUser(fullMxid, matrixAccessToken);
        }
        cleanupCryptoStorage(username);

        // Cleanup fixtures
        if (fs.existsSync(badFilePath)) fs.unlinkSync(badFilePath);
        if (fs.existsSync(largeFilePath)) fs.unlinkSync(largeFilePath);
    });

    test('User sees descriptive errors for invalid avatar uploads', async ({ page }) => {
        // 1. Login & Navigate to Member Editor
        await page.goto('/login');
        await page.getByTestId('login-mxid-input').fill(fullMxid);
        await page.getByTestId('login-password-input').fill(password);
        await page.getByTestId('login-submit-button').click();

        await page.waitForURL(/\/setup/);
        await page.getByTestId('create-system-button').click();
        await page.getByTestId('acknowledge-warning-button').click();
        await page.waitForURL(/\/s\/[a-z0-9-]+/);

        await page.getByTestId('add-member-button').click();

        // 2. Test Invalid File Format (.txt)
        console.log('[UI-Error-Test] Testing invalid file format (.txt)...');
        
        // Listen for the alert dialog
        let alertMessage = '';
        page.on('dialog', dialog => {
            alertMessage = dialog.message();
            dialog.dismiss();
        });

        await page.getByTestId('avatar-upload-input').setInputFiles(badFilePath);
        await expect.poll(() => alertMessage).toContain('must be in .jpg, .png, or .webp format');

        // 3. Test File Too Large (>1MB)
        console.log('[UI-Error-Test] Testing oversized file (>1MB)...');
        alertMessage = ''; // reset
        await page.getByTestId('avatar-upload-input').setInputFiles(largeFilePath);
        await expect.poll(() => alertMessage).toContain('must be under 1024 KB');

        console.log('[UI-Error-Test] Success!');
    });
});
