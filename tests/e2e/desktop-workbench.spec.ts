import { textContrast } from '../../src/release/browser-text-contrast';
import { expect, test } from './helpers/ui-contract-fixture';

test('saving a prompt Design declaration clears only that placeholder from the status bar', async ({ page }) => {
  const editor = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
  await editor.fill('<mission>Write for {{customer}} about {{topic}}.</mission>');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const count = page.getByTestId('status-undeclared-count');
  await expect(count).toHaveText('2 undeclared');

  await page.getByRole('button', { name: 'Design', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Prompt design', exact: true });
  await panel.getByText('Advanced: complete versioned design', { exact: true }).click();
  const json = panel.getByRole('textbox', { name: 'Prompt design JSON', exact: true });
  const design = JSON.parse(await json.inputValue());
  design.variables.push({ ...design.variables[0], name: 'customer', purpose: 'The person asking for help.' });
  await json.fill(JSON.stringify(design));
  await panel.getByRole('button', { name: 'Save prompt design', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Prompt design saved and ready.');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(count).toHaveText('1 undeclared');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      await page.screenshot({ path: test.info().outputPath(`undeclared-count-${width}-${theme}.png`) });
    }
  }
});

test('Explorer lists and opens repository skills in their own group', async ({ page }) => {
  const explorer = page.getByTestId('prompt-studio-sidebar');
  const skill = explorer.getByRole('region', { name: 'Skills', exact: true }).getByTestId('prompt-root-plain-language');
  await expect(skill).toBeVisible();
  const prompts = explorer.getByRole('region', { name: 'Prompts', exact: true });
  await expect(prompts.getByTestId('prompt-root-contracts')).toBeVisible();
  await expect(prompts.getByTestId('prompt-root-plain-language')).toHaveCount(0);
  const search = explorer.getByRole('searchbox', { name: 'Find a document' });
  await search.fill('plain-language');
  await expect(skill).toBeVisible();
  await expect(prompts).toHaveCount(0);
  await search.clear();
  await skill.click();
  await expect(page.getByRole('textbox', { name: 'Prompt markdown', exact: true })).toHaveValue(
    /Keep instructions clear/,
  );
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
    if (width === 375) await page.getByRole('button', { name: 'Toggle prompt explorer' }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      await expect(skill).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`explorer-skills-${width}-${theme}.png`),
        animations: 'disabled',
      });
    }
  }
});

// Outcome test: create, write and save from the actual standalone app without feedback covering actions.
test('the document workspace preserves usable editing space and reachable save actions', async ({ page }) => {
  await page.getByRole('button', { name: 'New prompt', exact: true }).click();
  await page.getByRole('textbox', { name: 'Prompt ID', exact: true }).fill('workbench');
  await page.getByRole('textbox', { name: 'Prompt title', exact: true }).fill('Workbench');
  await page.getByRole('button', { name: 'Create prompt', exact: true }).click();
  // Compact secondary commands must keep the primary desktop views readable.
  for (const name of ['Write', 'Graph', 'Design']) {
    const label = page.getByRole('button', { name, exact: true }).locator('span').last();
    await expect.poll(() => label.evaluate((element) => getComputedStyle(element).clipPath)).toBe('none');
  }
  const editor = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(viewport);
    await editor.fill(`## Mission\nWrite and save at ${viewport.width}px without losing my place.\n`);
    const size = await editor.boundingBox();
    expect(size?.height).toBeGreaterThanOrEqual(viewport.width === 375 ? 160 : 400);
    const apply = page.getByRole('button', { name: 'Apply changes', exact: true });
    await expect(apply).toBeEnabled();
    expect(
      await apply.evaluate((button) => {
        const box = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }),
    ).toBe(true);
    await apply.click();
    await expect(page.getByText('Saved on this computer', { exact: true })).toBeVisible();
  }
  // Given: an interrupted local save, retain the selected prompt through successful retry.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/__studio/prompt-repo/draft', (route) =>
    route.fulfill({ status: 503, json: { ok: false, error: 'Temporary local save failure' } }),
  );
  await editor.fill('## Mission\nKeep the selected prompt after recovery.\n');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
  await page.unroute('**/__studio/prompt-repo/draft');
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByText('Saved on this computer', { exact: true })).toBeVisible();
  await expect(editor).toHaveValue('## Mission\nKeep the selected prompt after recovery.\n');
});

test('resizing a desktop panel keeps its draft visible instead of opening Explorer over it', async ({ page }) => {
  // Given: the author explicitly reopens the desktop Explorer, then edits a variable.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Toggle prompt explorer' }).click();
  await page.getByRole('button', { name: 'Toggle prompt explorer' }).click();
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  await page.getByRole('button', { name: 'Add variable', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('retained_input');
  // When: the viewport switches to compatibility mode.
  await page.setViewportSize({ width: 375, height: 667 });
  // Then: the same unsaved form remains reachable without an unexpected covering drawer.
  await expect(page.getByRole('dialog', { name: 'Prompt explorer', exact: true })).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('retained_input');
  await expect(page.getByRole('button', { name: 'Save variable', exact: true })).toBeVisible();
});

test('retry makes a prompt visible after its creation was interrupted', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/__studio/prompt-repo/draft', (route) =>
    route.fulfill({ status: 503, json: { ok: false, error: 'Interrupted creation save' } }),
  );
  await page.getByRole('button', { name: 'New prompt', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a prompt', exact: true });
  await dialog.getByRole('textbox', { name: 'Prompt title', exact: true }).fill('Recovered prompt');
  await dialog.getByRole('textbox', { name: 'Prompt ID', exact: true }).fill('recovered');
  await dialog.getByRole('button', { name: 'Create prompt', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Interrupted creation save');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.unroute('**/__studio/prompt-repo/draft');
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByText('Saved on this computer', { exact: true })).toBeVisible();
  await expect(page.getByTestId('prompt-root-recovered')).toBeVisible();
  await page.getByTestId('prompt-root-recovered').click();
  await expect(page.getByRole('textbox', { name: 'Prompt markdown', exact: true })).toBeVisible();
});

test('phone Explorer retains readable text in both theme palettes', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByRole('button', { name: 'Toggle prompt explorer', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Prompt explorer', exact: true });
  await expect(drawer).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    expect(await textContrast(drawer.getByRole('treeitem').first())).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: test.info().outputPath(`explorer-phone-${theme}.png`) });
  }
});
