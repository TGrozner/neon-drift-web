import { defineConfig, devices } from '@playwright/test'

const host = '127.0.0.1'
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4174)
const basePath = (process.env.VITE_BASE_PATH ?? '/').replace(/\/?$/, '/')
const baseURL = `http://${host}:${port}${basePath}`
const useProductionBuild = process.env.PLAYWRIGHT_USE_BUILD === 'true'
const testTimeout = Number(process.env.PLAYWRIGHT_TEST_TIMEOUT ?? (process.env.CI ? 90_000 : 45_000))
const webServerCommand = useProductionBuild
  ? `npm run build:client && npm run preview -- --host ${host} --port ${port}`
  : `npm run dev -- --host ${host} --port ${port}`

export default defineConfig({
  testDir: './e2e',
  timeout: testTimeout,
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !useProductionBuild,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
