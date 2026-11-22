import { readWorkspacePrompt } from '../../src/prompt-repo/workspace-document';
import { expect, longTool, longVariable, source, test } from './helpers/ui-contract-fixture';
import { verificationPresetContract } from './helpers/verification-preset-contract';

async function graphGeometry(page: import('@playwright/test').Page) {
  return page.getByTestId('prompt-graph-canvas').evaluate((canvas) => {
    const viewport = canvas.querySelector<HTMLElement>('.react-flow__viewport')!;
    const zoom = new DOMMatrix(getComputedStyle(viewport).transform).a;
    const nodes = [...canvas.querySelectorAll('.react-flow__node')].map((node) => node.getBoundingClientRect());
    const labels = [...canvas.querySelectorAll('.react-flow__edge-textbg')].map((label) =>
      label.getBoundingClientRect(),
    );
    return {
      zoom,
      labels: labels.length,
      minimumGap: Math.min(
        ...labels.flatMap((label) =>
          nodes.map(
            (node) =>
              Math.hypot(
                Math.max(node.left - label.right, label.left - node.right, 0),
                Math.max(node.top - label.bottom, label.top - node.bottom, 0),
              ) / zoom,
          ),
        ),
      ),
    };
  });
}

test('#2498: graph labels keep a 16px gutter and collapsed sections retain compact controls across zoom', async ({
  page,
}) => {
  await page.keyboard.press('Alt+2');
  await expect(page.getByTestId('fragment-node')).toHaveCount(3);
  await expect.poll(async () => (await graphGeometry(page)).labels).toBeGreaterThanOrEqual(3);
  const labelCount = (await graphGeometry(page)).labels;
  const longEdges = page.locator(`.react-flow__edge[aria-label="declares: {{${longVariable}}}"]`);
  expect(await longEdges.count()).toBeGreaterThan(0);
  for (const edge of await longEdges.all()) {
    await expect(edge).toBeVisible();
    const visibleLabel = await edge.locator('.react-flow__edge-text').textContent();
    expect(visibleLabel).toMatch(/…$/);
    expect([...(visibleLabel ?? '')].length).toBeLessThanOrEqual(28);
    await expect(edge.locator('title')).toHaveText(`{{${longVariable}}}`);
  }
  await expect.poll(async () => (await graphGeometry(page)).minimumGap).toBeGreaterThanOrEqual(15.5);
  const mission = page.locator('.react-flow__node[data-id="section:mission"]');
  const original = await mission.evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight }));
  await mission.click({ position: { x: 3, y: 3 } });
  const handle = mission.locator('.react-flow__resize-control.bottom.right').first();
  await expect(handle).toBeVisible();
  await handle.hover();
  const grip = await handle.boundingBox();
  if (!grip) throw new Error('Selected section has no resize grip.');
  const zoom = (await graphGeometry(page)).zoom;
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 180 * zoom, grip.y + grip.height / 2 + 80 * zoom, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => mission.evaluate((node) => node.clientWidth)).toBeGreaterThan(original.width + 150);
  const resizedHeight = await mission.evaluate((node) => node.clientHeight);
  expect(resizedHeight).toBeGreaterThan(original.height + 50);
  await expect.poll(async () => (await graphGeometry(page)).minimumGap).toBeGreaterThanOrEqual(15.5);
  await page.screenshot({ path: test.info().outputPath('resized-graph.png') });
  await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
  for (let level = 0; level < 4; level++) {
    if (level === 2) await page.setViewportSize({ width: 960, height: 800 });
    await expect.poll(async () => (await graphGeometry(page)).labels).toBe(labelCount);
    await expect.poll(async () => (await graphGeometry(page)).minimumGap).toBeGreaterThanOrEqual(15.5);
    for (const card of await page.getByTestId('fragment-node').all()) {
      await expect(card).toHaveAttribute('data-collapsed', 'true');
      expect(await card.evaluate((node) => node.clientHeight)).toBeLessThanOrEqual(56);
      await expect(card.getByRole('button', { name: 'Edit section', exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Expand section', exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: /^zoom out$/i }).click();
  }
  await page.getByRole('button', { name: 'Expand all sections', exact: true }).click();
  await expect
    .poll(() => mission.evaluate((node, height) => Math.abs(node.clientHeight - height), resizedHeight))
    .toBeLessThanOrEqual(1);
  await expect.poll(async () => (await graphGeometry(page)).minimumGap).toBeGreaterThanOrEqual(15.5);
});

test('#2504: dependency chips retain the name prefix and fixed geometry', async ({ page }) => {
  await page.keyboard.press('Alt+2');
  for (const width of [2560, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 1440 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
      for (const name of [longVariable, longTool]) {
        const chip = page.getByTestId('label-chip').filter({ hasText: name });
        await expect(chip).toHaveAttribute('title', name);
        const geometry = await chip.evaluate((node) => {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          const text = walker.nextNode()!;
          const range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 5);
          const box = node.getBoundingClientRect();
          return {
            prefixInset: range.getBoundingClientRect().left - box.left,
            width: node.clientWidth,
            height: node.clientHeight,
            ellipsis: getComputedStyle(text.parentElement!).textOverflow,
          };
        });
        expect(geometry.prefixInset, `${theme}/${width}: ${name} prefix must be visible`).toBeGreaterThanOrEqual(0);
        expect(geometry.width).toBe(198);
        expect(geometry.height).toBe(34);
        expect(geometry.ellipsis).toBe('ellipsis');
      }
      await page.screenshot({ path: test.info().outputPath(`name-prefix-${width}-${theme}.png`) });
    }
  }
});

test('#2505: full inspector identifiers wrap within the panel', async ({ page }) => {
  await page.keyboard.press('Alt+2');
  await page.locator('.react-flow__node[data-id="section:mission"]').click({ position: { x: 3, y: 3 } });
  const inspector = page.getByTestId('prompt-studio-inspector');
  for (const width of [2560, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 1440 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
      await expect(inspector.getByRole('list', { name: 'Variables', exact: true })).toContainText(longVariable);
      await expect(inspector.getByRole('list', { name: 'Tools', exact: true })).toContainText(longTool);
      await expect
        .poll(() => inspector.evaluate((element) => element.scrollWidth - element.clientWidth))
        .toBeLessThanOrEqual(1);
      const geometry = await inspector.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          overflow: element.scrollWidth - element.clientWidth,
          textOutside: [...element.querySelectorAll('h2,dd,li')].flatMap((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()]
              .filter((box) => box.left < bounds.left - 1 || box.right > bounds.right + 1)
              .map(() => node.textContent);
          }),
        };
      });
      expect(geometry.overflow, `${theme}/${width}: inspector overflow`).toBeLessThanOrEqual(1);
      expect(geometry.textOutside).toEqual([]);
      await expect(inspector.getByRole('button', { name: 'Edit section', exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`inspector-${width}-${theme}.png`) });
    }
  }
});

test('#2531: verification presets fit their cards and viewport', verificationPresetContract);

test('graph findings show the number and label together in expanded sections', async ({ page }) => {
  await page.keyboard.press('Alt+2');
  await page.keyboard.press('Alt+V');
  const verify = page.getByRole('complementary', { name: 'Verify', exact: true });
  const editor = verify.getByRole('textbox', { name: 'Verification prompt source' });
  await editor.fill(source.replace('Use {{document}}', 'Use {{missing_document}}'));
  await verify.getByRole('button', { name: 'Save and recheck', exact: true }).click();
  await verify.getByRole('button', { name: 'Close', exact: true }).click();
  const chip = page.locator('[data-id="section:mission"]').getByTestId('fragment-node-finding-count');
  await expect(chip).toHaveText('2 findings');
  // Whitespace between two flex items takes up no space in the rendered badge.
  expect(
    await chip.evaluate((element) => {
      const label = document.createRange();
      label.selectNodeContents(element);
      return label.getClientRects().length;
    }),
  ).toBe(1);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      await page.screenshot({ path: test.info().outputPath(`graph-findings-${width}-${theme}.png`) });
    }
  }
});

test('line numbers wrap and scroll with Markdown, and persist without changing source', async ({ page }) => {
  await page.keyboard.press('Alt+1');
  await page.setViewportSize({ width: 375, height: 667 });
  const editor = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
  await page.getByRole('button', { name: 'Line numbers', exact: true }).click();
  await expect(page.getByTestId('prompt-line-number')).toHaveCount(source.split('\n').length);
  const backdrop = page.getByTestId('highlighted-prompt-text-backdrop');
  expect(
    await backdrop
      .locator(':scope > div')
      .nth(1)
      .evaluate((node) => node.clientHeight / Number.parseFloat(getComputedStyle(node).lineHeight)),
  ).toBeGreaterThan(2);
  expect(
    Math.abs(
      (await editor.evaluate((node) => node.scrollHeight)) - (await backdrop.evaluate((node) => node.scrollHeight)),
    ),
  ).toBeLessThanOrEqual(1);
  await editor.focus();
  await editor.press('Control+End');
  await expect.poll(() => editor.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(async () =>
      Math.abs((await editor.evaluate((node) => node.scrollTop)) - (await backdrop.evaluate((node) => node.scrollTop))),
    )
    .toBeLessThanOrEqual(1);
  await expect(editor).toHaveValue(source);
  await page.reload();
  const explorer = page.getByRole('button', { name: 'Toggle prompt explorer', exact: true });
  await expect(explorer).toBeVisible({ timeout: 20_000 });
  if ((await explorer.getAttribute('aria-expanded')) !== 'true') await explorer.click();
  await page.getByTestId('prompt-root-contracts').click();
  await page.keyboard.press('Alt+1');
  await expect(page.getByTestId('prompt-line-number')).toHaveCount(source.split('\n').length);
  await page.getByRole('button', { name: 'Line numbers', exact: true }).click();
  await expect(page.getByTestId('prompt-line-number')).toHaveCount(0);
  await expect(editor).toHaveValue(source);
});

test('#2512: completion follows the caret and Tab indentation preserves native Undo', async ({ page }) => {
  await page.keyboard.press('Alt+1');
  const editor = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
  const menu = page.getByRole('listbox', { name: 'Prompt suggestions' });
  await page.getByRole('button', { name: 'Line numbers', exact: true }).click();
  const prefix = `<mission>\n<output>\n${'Keep the original instructions.\n'.repeat(12)}`;
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
    await editor.fill(prefix);
    await editor.press('Control+End');
    await editor.pressSequentially('</');
    await expect(menu.getByRole('option')).toHaveText([
      /^<\/output>\s*Close open tag$/,
      /^<\/mission>\s*Close open tag$/,
    ]);
    await expect
      .poll(async () => {
        const caret = await page.getByTestId('highlighted-prompt-text-backdrop').evaluate((backdrop) => {
          const walker = document.createTreeWalker(backdrop, NodeFilter.SHOW_TEXT);
          let last: Text | null = null;
          while (walker.nextNode())
            if (walker.currentNode.textContent?.endsWith('</')) last = walker.currentNode as Text;
          if (!last) throw new Error('The visible closing delimiter is missing.');
          const range = document.createRange();
          range.setStart(last, last.length - 1);
          range.setEnd(last, last.length);
          const box = range.getBoundingClientRect();
          return { left: box.right, top: box.top, bottom: box.bottom };
        });
        const box = (await menu.boundingBox())!;
        return (
          box.x <= caret.left + 8 &&
          box.x + box.width >= caret.left - 8 &&
          box.x >= 0 &&
          box.x + box.width <= width &&
          Math.min(Math.abs(box.y - caret.bottom), Math.abs(box.y + box.height - caret.top)) < 18
        );
      })
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath(`completion-caret-${width}.png`) });
    await editor.press('Tab');
    await expect(editor).toHaveValue(`${prefix}</output>`);
    await editor.press('Control+z');
    await expect(editor).toHaveValue(`${prefix}</`);
    await editor.fill('first\nsecond\nthird');
    await editor.press('Control+a');
    await editor.press('Tab');
    await expect(editor).toHaveValue('  first\n  second\n  third');
    await editor.press('Control+z');
    await expect(editor).toHaveValue('first\nsecond\nthird');
    await editor.press('Control+Shift+z');
    await expect(editor).toHaveValue('  first\n  second\n  third');
    await editor.press('Control+a');
    await editor.press('Shift+Tab');
    await expect(editor).toHaveValue('first\nsecond\nthird');
    // #2530: returning from Preview reveals the same native Undo owner.
    await page.getByRole('tab', { name: 'Preview draft', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.keyboard.press('Alt+1');
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('first\nsecond\nthird');
    await editor.press('Control+z');
    await expect(editor).toHaveValue('  first\n  second\n  third');
    await editor.press('Control+Shift+z');
    await expect(editor).toHaveValue('first\nsecond\nthird');
    await editor.press('Escape');
    await editor.press('Tab');
    await expect(editor).not.toBeFocused();
  }
});

test('#2521: a parent section edits its children once and preserves surrounding source', async ({ page }) => {
  await page.keyboard.press('Alt+2');
  await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
  const mission = page.locator('.react-flow__node[data-id="section:mission"]');
  await mission.getByRole('button', { name: 'Edit section', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mission', exact: true });
  const body = dialog.getByRole('textbox');
  await expect(body).toHaveValue(source.slice(source.indexOf('\n') + 1, source.indexOf('</mission>')));
  await body.fill((await body.inputValue()).replace('Keep {{document}} available', 'Retain {{document}} throughout'));
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/__studio/prompt-repo/draft') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Alt+1');
  const writer = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
  const edited = source.replace('Keep {{document}} available', 'Retain {{document}} throughout');
  await expect(writer).toHaveValue(edited);
  const persisted = await page.evaluate(async () => {
    const token = document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? '';
    const response = await fetch('/__studio/prompt-repo', { headers: { 'x-studio-token': token } });
    if (!response.ok) throw new Error(`Project readback failed (${response.status}).`);
    const project = await response.json();
    return project.documents.find((file: { id: string }) => file.id === 'contracts').text;
  });
  expect(readWorkspacePrompt(persisted)?.text).toBe(edited);
  await page.reload();
  await page.getByTestId('prompt-root-contracts').click();
  await page.keyboard.press('Alt+1');
  await expect(writer).toHaveValue(edited);
});

test('#2525: an @file between XML sections remains a separate Missing graph node after save', async ({ page }) => {
  const written = '<mission>\nTask\n</mission>\n@folder/file.md\n<output>\nResult\n</output>\n';
  await page.keyboard.press('Alt+1');
  const editor = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
  await editor.fill(written);
  await editor.press('Control+s');
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeDisabled();
  await page.keyboard.press('Alt+2');
  const file = page.locator('.react-flow__node[data-id="file:folder/file.md"]');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      await expect(file).toContainText('Missing: folder/file.md');
      await expect(page.locator('.react-flow__edge[aria-label="references: Load before prompt"]')).toHaveCount(1);
      await page.screenshot({
        path: test.info().outputPath(`missing-reference-${width}-${dark ? 'dark' : 'light'}.png`),
      });
    }
  }
  await page.reload();
  const explorer = page.getByRole('button', { name: 'Toggle prompt explorer', exact: true });
  await expect(explorer).toBeVisible();
  if ((await explorer.getAttribute('aria-expanded')) !== 'true') await explorer.click();
  await expect(page.getByTestId('prompt-root-contracts')).toBeVisible();
  await page.getByTestId('prompt-root-contracts').click();
  await page.keyboard.press('Alt+2');
  await expect(file).toContainText('Missing: folder/file.md');
});
