import { expect, test } from './helpers/ui-contract-fixture';

test('#2490: shared model setup and Alt+5 preserve an unfinished evaluation and its active tab', async ({
  page,
  workspace,
}) => {
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'App settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'App settings', exact: true });
  await settings.getByRole('tab', { name: 'Models & skills', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai');
  const endpoint = settings.getByLabel(/^API base URL/);
  await expect(endpoint).not.toBeVisible();
  await settings.getByText('Advanced connection settings', { exact: true }).click();
  await expect(endpoint).toBeVisible();
  await settings.getByText('Advanced connection settings', { exact: true }).click();
  await expect(endpoint).not.toBeVisible();
  await settings.getByRole('textbox', { name: 'Model', exact: true }).fill('ui-contract-model');
  await settings.getByRole('textbox', { name: 'Local folder path', exact: true }).fill(workspace.skillsFolder);
  await settings.getByRole('button', { name: 'Save settings & scan skills', exact: true }).click();
  await expect(settings.getByText('Settings saved. Skills were scanned from this folder.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+5');
  const dock = page.getByRole('complementary', { name: 'Evaluations', exact: true });
  await expect(dock.getByText('ui-contract-model', { exact: true }).first()).toBeVisible();
  await expect(dock.getByRole('textbox', { name: 'Model', exact: true })).toHaveCount(0);
  await dock.getByRole('button', { name: 'Edit skill attachments', exact: true }).click();
  const skill = dock.getByRole('checkbox', { name: /Clarity/ });
  await skill.check();
  await dock.getByRole('button', { name: 'New suite', exact: true }).click();
  const suite = dock.getByRole('textbox', { name: 'Suite name', exact: true });
  await suite.fill('Retain unfinished evaluation');
  const check = dock.getByRole('textbox', { name: /Must include/ });
  await check.fill('Source:');
  await page.keyboard.press('Alt+5');
  await expect(dock).toBeHidden();
  await page.keyboard.press('Alt+5');
  await expect(suite).toHaveValue('Retain unfinished evaluation');
  await expect(check).toHaveValue('Source:');
  await expect(skill).toBeChecked();
  const active = dock.getByRole('tab', { name: 'Test suites', exact: true });
  await expect(active).toHaveAttribute('aria-selected', 'true');
  const inactive = dock.getByRole('tab', { name: 'Compare', exact: true });
  expect(await active.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
    await inactive.evaluate((node) => getComputedStyle(node).backgroundColor),
  );
});
