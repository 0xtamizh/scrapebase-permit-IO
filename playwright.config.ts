import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8080',
  },
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI
  },
}); 