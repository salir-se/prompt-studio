import { startHelpModelProvider } from './helpers/help-model-provider';
import { textContrast } from '../../src/release/browser-text-contrast';
import { expect, test } from './helpers/ui-contract-fixture';

test.use({ localModelRuns: true });
test('Help inherits the prompt model, uses its own override, and returns to inheritance without changing prompts', async ({
  page,
}) => {
  const fixture = await startHelpModelProvider();
  try {
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'App settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'App settings', exact: true });
    await settings.getByRole('tab', { name: 'Models & skills' }).click();
    await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai-compat');
    await settings.getByLabel('Model', { exact: true }).fill('prompt-model');
    await settings.getByLabel(/^API base URL/).fill(`${fixture.url}/v1`);
    await settings.getByLabel(/^API key/).fill('local-fixture-only');
    await settings.getByRole('button', { name: 'Save settings & scan skills' }).click();
    await expect(settings.getByText('Settings saved. Skills were scanned from this folder.')).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Ask the help assistant', exact: true }).click();
    const help = page.getByRole('complementary', { name: 'Help assistant', exact: true });
    const question = help.getByRole('textbox', { name: 'Ask the help assistant' });
    await expect(help.getByText('OpenAI compatible · prompt-model', { exact: true })).toBeVisible();
    await question.fill('How do I save a version?');
    await help.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(help.getByText(/prompt-model: Open Your prompts/)).toBeVisible();
    await page.setViewportSize({ width: 375, height: 667 });
    await help.getByRole('checkbox', { name: 'Use model from App settings' }).uncheck();
    await help.getByRole('textbox', { name: 'Model', exact: true }).fill('help-model');
    await expect(help.getByRole('button', { name: 'Save Help model' })).toBeInViewport();
    await help.getByRole('button', { name: 'Save Help model' }).click();
    await expect(help.getByText('Help model saved. Prompt settings are unchanged.')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await question.fill('Which menu is that?');
    await help.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(help.getByText(/help-model: Open Your prompts/)).toBeVisible();
    const config = await page.evaluate(async () => {
      const response = await fetch('/__studio/run/settings', {
        headers: { 'x-studio-token': document.querySelector('meta[name="studio-token"]')!.getAttribute('content')! },
      });
      return response.json();
    });
    expect(config.model).toBe('prompt-model');
    expect(config.helpModel.model).toBe('help-model');
    await help.getByRole('checkbox', { name: 'Use model from App settings' }).check();
    await help.getByRole('button', { name: 'Save Help model' }).click();
    await expect(help.getByText('Help model saved. Prompt settings are unchanged.')).toBeVisible();
    await question.fill('One last question');
    await help.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(help.getByText(/prompt-model: Open Your prompts/)).toHaveCount(2);
    expect(fixture.models).toEqual(['prompt-model', 'help-model', 'prompt-model']);
    // A failed reply preserves the question and remains readable in both themes.
    await page.route('**/__studio/run/help', (route) =>
      route.fulfill({ status: 503, json: { error: 'Help could not get a reply. Check App settings and retry.' } }),
    );
    await question.fill('Keep this question after failure');
    await help.getByRole('button', { name: 'Ask', exact: true }).click();
    const error = help.getByRole('alert');
    await expect(error).toContainText('could not get a reply');
    await expect(help.getByText('Keep this question after failure', { exact: true })).toBeVisible();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      expect(await textContrast(error)).toBeGreaterThanOrEqual(4.5);
    }
  } finally {
    await fixture.close();
  }
});
