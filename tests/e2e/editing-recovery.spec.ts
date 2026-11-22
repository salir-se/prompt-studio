import { readWorkspacePrompt } from '../../src/prompt-repo/workspace-document';
import { expect, source, test } from './helpers/ui-contract-fixture';

test('#2534: section shortcuts focus same-line instructions without changing the draft', async ({ page }) => {
  const draft = 'MISSION: Write a short answer.\n\nOUTPUT: JSON only.';
  const writer = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
  await writer.fill(draft);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      await writer.press('Alt+j');
      await page.getByRole('combobox', { name: 'Find section' }).fill('MISSION');
      await page.getByRole('combobox', { name: 'Find section' }).press('Enter');
      await expect(writer).toBeFocused();
      await expect.poll(() => writer.evaluate((node) => node.selectionStart)).toBe(draft.indexOf('Write'));
      await writer.press('Alt+ArrowDown');
      await expect.poll(() => writer.evaluate((node) => node.selectionStart)).toBe(draft.indexOf('JSON'));
      await writer.press('Alt+ArrowUp');
      await expect.poll(() => writer.evaluate((node) => node.selectionStart)).toBe(draft.indexOf('Write'));
      await expect(writer).toHaveValue(draft);
      await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeEnabled();
      await page.screenshot({ path: test.info().outputPath(`section-jump-${width}-${dark}.png`) });
    }
  }
});

test('#2533: updating a check retains siblings through persistence and reload', async ({ page }) => {
  await page.keyboard.press('Alt+v');
  await page.getByRole('tab', { name: 'Checks & criteria', exact: true }).click();
  const rules = page.getByRole('list', { name: 'Section rules' });
  async function add(literal: string) {
    await page.getByRole('button', { name: 'Add automatic check', exact: true }).click();
    await page.getByRole('textbox', { name: 'Required text', exact: true }).fill(literal);
    await page.getByRole('button', { name: 'Add check', exact: true }).click();
    await expect(rules).toContainText(literal);
    await expect(page.getByText('Checks saved and rechecked', { exact: true })).toBeVisible();
  }
  async function readback() {
    const text = await page.evaluate(async () => {
      const token = document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? '';
      const response = await fetch('/__studio/prompt-repo', { headers: { 'x-studio-token': token } });
      if (!response.ok) throw new Error(`Project readback failed (${response.status}).`);
      const project = await response.json();
      return project.documents.find((file: { id: string }) => file.id === 'contracts').text as string;
    });
    const prompt = readWorkspacePrompt(text);
    if (!prompt) throw new Error('The saved prompt metadata could not be read.');
    return prompt;
  }
  await add('Alpha baseline.');
  await add('Beta baseline.');
  const before = await readback();
  const alpha = rules.locator('li').filter({ hasText: 'Alpha baseline.' });
  await alpha.getByRole('button', { name: 'Edit Required text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Required text', exact: true }).fill('Alpha revised.');
  for (const action of await rules.getByRole('button', { name: /^(Edit|Remove) / }).all())
    await expect(action).toBeDisabled();
  await page.getByRole('button', { name: 'Update check', exact: true }).click();
  await expect(rules).toContainText('Alpha revised.');
  await expect(rules).toContainText('Beta baseline.');
  await expect(page.getByText('Checks saved and rechecked', { exact: true })).toBeVisible();
  const after = await readback();
  expect(after.text).toBe(source);
  expect(after.design.verificationProfiles.map(({ id, deterministicRules }) => ({ id, deterministicRules }))).toEqual(
    before.design.verificationProfiles.map((profile) => ({
      id: profile.id,
      deterministicRules: profile.deterministicRules.map((rule) =>
        rule.kind === 'required-output-literal' && rule.literal === 'Alpha baseline.'
          ? { ...rule, literal: 'Alpha revised.' }
          : rule,
      ),
    })),
  );
  await page.reload();
  await page.getByTestId('prompt-root-contracts').click();
  await page.keyboard.press('Alt+v');
  await page.getByRole('tab', { name: 'Checks & criteria', exact: true }).click();
  await expect(rules).toContainText('Alpha revised.');
  await expect(rules).toContainText('Beta baseline.');
  expect((await readback()).text).toBe(source);
});
