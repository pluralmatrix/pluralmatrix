import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load .env if it exists
dotenv.config({ path: path.resolve(__dirname, '../.env') });

process.env.NODE_ENV = 'test';

export default defineConfig({
  testDir: './src/test/ui',
  fullyParallel: false, // Run sequentially to avoid cross-user state bleed if any
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Restrict workers to 1 to reduce load on the local Synapse instance during throwaway account creation
  reporter: 'list',
  use: {
    baseURL: process.env.PUBLIC_WEB_URL || 'http://localhost:9000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ],
});
