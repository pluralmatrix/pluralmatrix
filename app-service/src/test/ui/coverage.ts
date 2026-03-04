import { test as base, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    
    if (process.env.VITE_COVERAGE === 'true') {
      const coverage: any = await page.evaluate(() => (window as any).__coverage__);
      if (coverage) {
        console.log(`[Coverage] Captured coverage for ${page.url()}`);
        const outputDir = path.resolve(__dirname, '../../../.nyc_output');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
          path.join(outputDir, `coverage-${Math.random().toString(36).substring(7)}.json`),
          JSON.stringify(coverage)
        );
      }
    }
  },
});

export { expect };
