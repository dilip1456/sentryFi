import { defineConfig, devices } from "@playwright/test";

/**
 * QA smoke suite: headless Chromium against the Vite dev server, /demo only.
 *
 * Safety: the server is started with a dummy, unroutable Supabase URL/key so
 * nothing can ever reach a real (let alone the production) project, and the
 * tests themselves stub every non-localhost request (see e2e/fixtures.ts).
 * Set QA_E2E_SERVER=preview to test the production build via `vite preview`.
 */
const PORT = Number(process.env.QA_E2E_PORT ?? 4317);
const usePreview = process.env.QA_E2E_SERVER === "preview";
const env = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54399",
  VITE_SUPABASE_PUBLISHABLE_KEY: "qa-dummy-anon-key",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "America/New_York",
    locale: "en-US",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } },
  ],
  webServer: {
    command: usePreview
      ? `npx vite build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`
      : `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/demo`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env,
  },
});
