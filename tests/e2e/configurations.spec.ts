import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * Document journeys against the real dev server, the real repo bridge, and the `examples/starter`
 * project. Each test starts from a fresh context: a fresh IndexedDB means a fresh configuration
 * and baselines — no fixtures, no cleanup.
 */

async function openPickerMenu(page: Page): Promise<Locator> {
  await page.getByTestId('project-picker-trigger').click();
  const menu = page.getByTestId('project-picker-menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('PS-002: reset a document to its shipped default as an append-only commit', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('prompt-root-support-triage').click();

  // Diverge through the root editor (the whole-document path — no canvas-internal knowledge).
  const rootChip = page.locator('[data-id="root:support-triage"]');
  await rootChip.click();
  await page.getByRole('button', { name: 'Edit markdown' }).click();
  const textarea = page.locator('[data-testid="fragment-edit-dialog"] textarea');
  await textarea.fill(`${await textarea.inputValue()}\n\nE2E-RESET-MARKER`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('dirty-chip')).toBeVisible();

  // Reset to shipped: the marker disappears, the chip clears, and History keeps both commits.
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('button', { name: 'Reset this prompt to starting text' }).click();
  await expect(page.getByTestId('dirty-chip')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('history-drawer')).toContainText('reset to shipped default');
  // The baseline seed row is still present — the reset was append-only, not destructive.
  await expect(page.getByTestId('history-drawer')).toContainText('baseline');
});

test('PS-004: edit a prose fragment document through its Document card', async ({ page }) => {
  await page.goto('/');

  // The greeting prompt is prose (no section structure) — it renders as one synthetic Document card.
  await page.getByTestId('prompt-root-greeting').click();
  const card = page.getByRole('article', { name: 'Document' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('business day'); // the starter greeting prose

  await card.click();
  await page.getByTestId('prompt-studio-inspector').getByRole('button', { name: 'Edit section' }).click();
  const textarea = page.getByTestId('fragment-edit-dialog').locator('textarea');
  await textarea.fill(`${await textarea.inputValue()}\nE2E-PROSE-MARKER`);
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByTestId('fragment-edit-dialog')).toHaveCount(0);
  await expect(page.getByTestId('dirty-chip')).toBeVisible();
  await expect(page.getByTestId('prompt-studio-inspector')).toContainText('E2E-PROSE-MARKER');
});

test('PS-005: skill documents load from the repo and open like any other root', async ({ page }) => {
  await page.goto('/');

  // The starter skill (skills/plain-language/SKILL.md) appears as its own root.
  const skillRoot = page.getByTestId('prompt-root-plain-language');
  await expect(skillRoot).toBeVisible({ timeout: 15_000 });
  await skillRoot.click();

  // SKILL.md parses into real sections (frontmatter + headings) — the canvas shows cards; the
  // exact section labels belong to the skill's own prose, so assert the shape, not the words.
  await expect(page.locator('article').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('dirty-chip')).toHaveCount(0);
});
