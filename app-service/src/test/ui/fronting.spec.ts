import { test, expect } from './coverage';
import { registerUser, getMatrixClient, deactivateUser, cleanupCryptoStorage } from '../e2e-helper';

test.describe('Fronting View UI', () => {
  let username: string;
  let fullMxid: string;
  const password = 'ui_test_password';
  let matrixAccessToken: string;

  test.beforeEach(async () => {
    username = `ui_front_user_${Math.random().toString(36).substring(7)}`;

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

  test('should allow logging a switch', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="text"]', fullMxid);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("Sign In")');

    await expect(page).toHaveURL('/setup');

    // Create the system
    await page.click('button:has-text("Create a System")');
    // Needs to skip past the E2EE warning screen
    await page.click('button:has-text("I Understand, Proceed")');
    await expect(page).toHaveURL('/');

    await expect(page.locator('text=Members').first()).toBeVisible();

    // Create a member first so we have someone to front
    await page.locator('button[data-testid="add-member-button"]').waitFor({ state: 'visible' });
    await page.click('button[data-testid="add-member-button"]');
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await page.fill('input[name="name"]', 'Fronter Bob');
    await page.fill('input[name="slug"]', 'fronter-bob');
    await page.fill('input[name="prefix"]', 'bob:');
    await page.click('button[data-testid="save-member-button"]');

    // Ensure member card appears
    await expect(page.locator('h3:has-text("Fronter Bob")').first()).toBeVisible();

    // Navigate to fronting tab
    await page.click('button[data-testid="tab-fronting"]');
    await expect(page.locator('text=Current Fronters').first()).toBeVisible();

    // The UI currently says "No one is currently fronting." initially.
    await expect(page.locator('text=No one is currently fronting.')).toBeVisible();

    // Click Log Switch
    await page.click('button[data-testid="log-switch-button"]');

    // Click on the member 'Fronter Bob' to add them
    await page.click('button:has-text("Fronter Bob")');

    // Save the switch
    await page.click('button[data-testid="save-switch-button"]');

    // It should now show Fronter Bob as fronting
    await expect(page.locator('text=Fronter Bob').first()).toBeVisible();
    await expect(page.locator('text=Fronter 1')).toBeVisible();

    // Log a switch-out
    await page.click('button[data-testid="log-switch-button"]');

    // Ensure the chip actually appeared (implicitly waits for modal animation)
    await expect(page.locator('[data-testid^="remove-fronter-"]').first()).toBeVisible({ timeout: 5000 });

    // Remove Fronter Bob from the current selection by clicking the X on their chip
    await page.click('[data-testid^="remove-fronter-"]');

    // Wait for the chip removal animation to finish so the Save button is stable
    await expect(page.locator('[data-testid^="remove-fronter-"]').first()).toBeHidden();

    // We can use force: true on the click to bypass any leftover animation container hitboxes
    // or wait for the button to be stable, but waiting for the chip to vanish should be enough.
    await page.click('button[data-testid="save-switch-button"]');

    await expect(page.locator('text=No one is currently fronting.')).toBeVisible();
  });

  test('should handle cancelling a switch edit and API errors', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="text"]', fullMxid);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("Sign In")');

    await expect(page).toHaveURL('/setup');

    // Create the system
    await page.click('button:has-text("Create a System")');
    await page.click('button:has-text("I Understand, Proceed")');
    await expect(page).toHaveURL('/');

    await expect(page.locator('text=Members').first()).toBeVisible();

    // Navigate to fronting tab
    await page.click('button[data-testid="tab-fronting"]');

    // Open the modal
    await page.click('button[data-testid="log-switch-button"]');
    await expect(page.locator('button:has-text("Cancel")')).toBeVisible();

    // Click Cancel
    await page.click('button:has-text("Cancel")');

    // Ensure the modal closed and Log Switch button is back
    await expect(page.locator('button[data-testid="log-switch-button"]')).toBeVisible();

    // Now test API error by routing a request to abort
    await page.route('/api/system/switches', async (route) => {
      if (route.request().method() === 'POST') {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.click('button[data-testid="log-switch-button"]');
    await page.click('button[data-testid="save-switch-button"]');

    // We expect the browser alert to fire since we aborted the POST request
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Failed to log switch');
      await dialog.accept();
    });
  });
});
