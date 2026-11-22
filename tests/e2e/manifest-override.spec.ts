import { expect, test } from '@playwright/test';

/**
 * PS-006 (user stories 014): a manifest OVERRIDE — the dev-mode equivalent of the container's
 * volume bind-mount — drives the whole studio. Run as a SEPARATE invocation while no other
 * studio dev server is running (the bridge's origin allowlist is pinned to port 5273):
 *
 *   PW_STUDIO_MANIFEST=$(pwd)/tests/e2e/fixtures/third-party.manifest.json bunx playwright test manifest-override
 *
 * The fixture manifest declares an explicit catalog over `tests/e2e/fixtures/vendor/` (a
 * committed content root), so this exercises the full universal-editor chain end to end:
 * server resolves the override (env > baked > app tree) → SPA fetches + re-validates it →
 * the catalog, picker baselines, and skills root all come from the THIRD-PARTY manifest.
 */
const overrideManifest = process.env.PW_STUDIO_MANIFEST;

test.skip(
  !overrideManifest,
  'manifest-override journey needs PW_STUDIO_MANIFEST — see the module doc for the invocation',
);

test('PS-006: a manifest override replaces the default catalog with the third-party tree', async ({ page }) => {
  await page.goto('/');

  // The vendor document is THE catalog; the salir inventory is absent, not appended.
  await expect(page.getByTestId('prompt-root-greeter')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('prompt-root-scout')).toHaveCount(0);

  // The vendor document loads with its file-sourced text and renders like any root (the
  // fixture's XML tags parse into real sections — assert the text on whatever card holds it).
  await page.getByTestId('prompt-root-greeter').click();
  await expect(
    page.locator('article').filter({ hasText: 'Hello from the third-party vendor prompt tree.' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('dirty-chip')).toHaveCount(0);

  // The picker's starting configurations come from the ACTIVE manifest, not the shipped one.
  await page.getByTestId('project-picker-trigger').click();
  const menu = page.getByTestId('project-picker-menu');
  await page.getByRole('button', { name: 'New configuration' }).click();
  await expect(menu.getByLabel('Starting configuration', { exact: true })).toContainText('Vendor default');
});
