import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175/Listocek/',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175/Listocek/',
    env: { VITE_SUPABASE_URL: 'https://listocek-test.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
    reuseExistingServer: false,
  },
})
