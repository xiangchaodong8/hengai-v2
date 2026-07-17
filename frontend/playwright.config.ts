import { defineConfig } from '@playwright/test';

/**
 * 批次 7 · 浏览器烟测：静态托管 frontend，无需后端 DB。
 * 运行：cd frontend && npm run test:e2e:browser
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3456',
    headless: true,
  },
  webServer: {
    command: 'npx --yes serve . -l 3456',
    url: 'http://127.0.0.1:3456/index.html',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
