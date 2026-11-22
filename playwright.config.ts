import { defineConfig } from '@playwright/test';

const studioPort = Number(process.env.PW_STUDIO_PORT ?? 5273);

/**
 * E2E for the prompt studio (task #14): real journeys against the REAL dev server — the same
 * Vite server the developer runs (`bun run dev`), with its read-only `/__studio/*` bridge reading
 * the actual monorepo checkout. Each test gets a fresh browser context (fresh IndexedDB → fresh
 * projects → only the Default configuration), so journeys are isolated without fixtures.
 *
 * Run from the app directory: `bunx playwright test`. The server binds 127.0.0.1 only (vite
 * config) and is reused when already running outside CI — same conventions as the app SPA's
 * playwright config.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // SERIAL, one worker: every open studio tab connects to the control channel, and the relay
  // serves the NEWEST tab only (ADR-236) — parallel test contexts would steal it from each
  // other mid-command. The suite is small; determinism beats the wall-clock saving.
  workers: 1,
  fullyParallel: false,
  outputDir: './.output/test-results/prompt-studio',
  reporter: process.env.CI ? [['line']] : [['html', { outputFolder: './.output/playwright-report/prompt-studio' }]],
  use: {
    baseURL: `http://127.0.0.1:${studioPort}`,
    screenshot: 'off',
    // The studio hides itself under 1100px (narrow-viewport guard) — stay above it.
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  webServer: {
    // `PW_STUDIO_MANIFEST` (PS-006): start the dev server with a manifest override — the
    // dev-mode equivalent of the container's volume bind-mount. The override run REPLACES the
    // plain server (same port — the bridge's origin allowlist is 5273-pinned), never parallels it.
    command: `${process.env.PW_STUDIO_MANIFEST ? `STUDIO_MANIFEST_PATH=${process.env.PW_STUDIO_MANIFEST} STUDIO_REPO_ROOT=. ` : ''}bun run dev -- --host 127.0.0.1 --port ${studioPort} --strictPort`,
    port: studioPort,
    reuseExistingServer: !process.env.CI && !process.env.PW_STUDIO_MANIFEST,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
