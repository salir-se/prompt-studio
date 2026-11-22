import { expect, type Page, type TestInfo } from '@playwright/test';

/** #2531: exercise the real Verify entrypoint and rendered preset boundaries. */
export async function verificationPresetContract({ page }: { page: Page }, info: TestInfo) {
  await page.keyboard.press('Alt+V');
  await page.getByRole('tab', { name: 'Checks & criteria', exact: true }).click();
  const harness = page.getByRole('region', { name: 'Build a verification harness' });
  const suggestions = harness.locator('details');
  if ((await suggestions.getAttribute('open')) === null) await suggestions.locator('summary').click();
  const variable = harness.getByRole('button', { name: /^Keep \{\{source_document_with_a_deliberately_long/ });
  const tool = harness.getByRole('button', { name: /^Keep tool verify_all_source_documents/ });
  await expect(variable).toBeVisible();
  await expect(tool).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      await expect
        .poll(() =>
          harness.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return (
              bounds.left >= 0 &&
              bounds.right <= document.documentElement.clientWidth &&
              [...element.querySelectorAll('button')].every((button) => {
                const box = button.getBoundingClientRect();
                return (
                  box.left >= bounds.left && box.right <= bounds.right && button.scrollWidth <= button.clientWidth + 1
                );
              })
            );
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(`presets-${width}-${dark ? 'dark' : 'light'}.png`),
        animations: 'disabled',
      });
    }
  }
}
