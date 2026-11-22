import { readWorkspacePrompt } from '../../src/prompt-repo/workspace-document';
import { expect, source, test } from './helpers/ui-contract-fixture';

async function position(node: import('@playwright/test').Locator) {
  return node.evaluate((element) => {
    const matrix = new DOMMatrix(element.style.transform);
    return { x: matrix.e, y: matrix.f };
  });
}

async function minimumLabelGap(page: import('@playwright/test').Page) {
  return page.getByTestId('prompt-graph-canvas').evaluate((canvas) => {
    const viewport = canvas.querySelector<HTMLElement>('.react-flow__viewport')!;
    const zoom = new DOMMatrix(getComputedStyle(viewport).transform).a;
    const nodes = [...canvas.querySelectorAll('.react-flow__node')].map((node) => node.getBoundingClientRect());
    const labels = [...canvas.querySelectorAll('.react-flow__edge-textbg')].map((label) =>
      label.getBoundingClientRect(),
    );
    if (labels.length === 0) return -1;
    return Math.min(
      ...labels.flatMap((label) =>
        nodes.map(
          (node) =>
            Math.hypot(
              Math.max(node.left - label.right, label.left - node.right, 0),
              Math.max(node.top - label.bottom, label.top - node.bottom, 0),
            ) / zoom,
        ),
      ),
    );
  });
}

async function savedPrompt(page: import('@playwright/test').Page) {
  const file = await page.evaluate(async () => {
    const token = document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? '';
    const response = await fetch('/__studio/prompt-repo', { headers: { 'x-studio-token': token } });
    if (!response.ok) throw new Error(`Prompt readback failed (${response.status}).`);
    const project = await response.json();
    return project.documents.find((document: { id: string }) => document.id === 'contracts') as {
      path: string;
      text: string;
    };
  });
  const prompt = readWorkspacePrompt(file.text);
  if (!prompt) throw new Error('The saved prompt metadata could not be read.');
  return { path: file.path, text: prompt.text };
}

async function drag(page: import('@playwright/test').Page, node: import('@playwright/test').Locator, dx = 90, dy = 50) {
  const bounds = await node.boundingBox();
  if (!bounds) throw new Error('No graph drag target.');
  await page.mouse.move(bounds.x + 25, bounds.y + 15);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 25 + dx, bounds.y + 15 + dy, { steps: 10 });
  await page.mouse.up();
}

test('#2536: dragging expanded and collapsed section nodes moves the node instead of panning', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press('Alt+2');
  const node = page.locator('.react-flow__node[data-id="section:mission"]');
  await expect(node).toBeVisible();
  await node.click({ position: { x: 8, y: 8 } });
  for (const collapsed of [false, true]) {
    if (collapsed) await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
    const before = await position(node);
    const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
    await drag(page, node);
    await expect.poll(async () => (await position(node)).x).toBeGreaterThan(before.x + 20);
    await expect.poll(async () => (await position(node)).y).toBeGreaterThan(before.y + 10);
    await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', viewport!);
    await expect(node).toHaveClass(/selected/);
    await expect.poll(() => minimumLabelGap(page)).toBeGreaterThanOrEqual(15.5);
    await node.focus();
    for (let step = 0; step < 3; step++) {
      const previous = await position(node);
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await position(node)).x).toBeGreaterThan(previous.x);
      expect((await position(node)).y).toBe(previous.y);
    }
    await expect(node).toBeFocused();
    await expect.poll(() => minimumLabelGap(page)).toBeGreaterThanOrEqual(15.5);
  }
  const beforeControls = await position(node);
  const edit = node.getByRole('button', { name: 'Edit section', exact: true });
  await edit.focus();
  await page.keyboard.press('ArrowRight');
  expect(await position(node)).toEqual(beforeControls);
  await edit.click();
  await expect(page.getByTestId('fragment-edit-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await position(node)).toEqual(beforeControls);
  await node.getByRole('button', { name: 'Expand section', exact: true }).click();
  await expect(node.getByTestId('fragment-node')).toHaveAttribute('data-collapsed', 'false');
  expect(await position(node)).toEqual(beforeControls);
  expect((await savedPrompt(page)).text).toBe(source);
});

test('#2536: all label kinds can move without opening files or changing source, and Auto arrange resets layout', async ({
  page,
}) => {
  const original = await savedPrompt(page);
  const expectedSource = `${source}\n@${original.path}\n`;
  await page.keyboard.press('Alt+1');
  await page.getByRole('textbox', { name: 'Prompt markdown', exact: true }).fill(expectedSource);
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect.poll(async () => (await savedPrompt(page)).text).toBe(expectedSource);
  await page.keyboard.press('Alt+2');
  const canvas = page.getByTestId('prompt-graph-canvas');
  await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const nodes = ['root:', 'variable:', 'tool:', 'file:'].map((prefix) =>
    canvas.locator(`.react-flow__node[data-id^="${prefix}"]`).first(),
  );
  const initial = [];
  for (const node of nodes) {
    await expect(node).toBeVisible();
    initial.push(await position(node));
    const before = await position(node);
    const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
    const box = await node.boundingBox();
    const graph = await canvas.boundingBox();
    if (!box || !graph) throw new Error('No label drag target.');
    // Stay away from the canvas edge: React Flow deliberately auto-pans edgeward drags.
    const dx = box.x + box.width / 2 > graph.x + graph.width / 2 ? -90 : 90;
    const dy = box.y + box.height / 2 > graph.y + graph.height / 2 ? -50 : 50;
    await drag(page, node, dx, dy);
    await expect.poll(async () => ((await position(node)).x - before.x) * Math.sign(dx)).toBeGreaterThan(20);
    await expect(
      page.locator('.react-flow__viewport'),
      `${await node.getAttribute('data-id')}: inward drag`,
    ).toHaveAttribute('style', viewport!);
    await expect(page.getByTestId('fragment-edit-dialog')).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'Referenced file editor' })).not.toBeVisible();
    await expect.poll(() => minimumLabelGap(page)).toBeGreaterThanOrEqual(15.5);
  }
  // Compare defaults while the viewport still matches the baseline; opening Inspector refits the camera.
  await page.getByRole('button', { name: 'Auto arrange graph', exact: true }).click();
  for (const [index, node] of nodes.entries()) await expect.poll(() => position(node)).toEqual(initial[index]);
  // Reversing a dependency must not put its label over either endpoint or another node.
  const variable = nodes[1]!;
  await variable.click();
  await variable.focus();
  const section = canvas.locator('.react-flow__node[data-id="section:mission"]');
  const targetX = (await position(section)).x - 240;
  const presses = Math.ceil(((await position(variable)).x - targetX) / 20);
  for (let step = 0; step < presses; step++) await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await position(variable)).x).toBeLessThan((await position(section)).x - 200);
  await expect(variable).toBeFocused();
  await expect.poll(() => minimumLabelGap(page)).toBeGreaterThanOrEqual(15.5);
  expect((await savedPrompt(page)).text).toBe(expectedSource);
});

test('#2540: connections follow facing sides during dragging and keyboard moves without label detours', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.keyboard.press('Alt+2');
  await page.getByRole('button', { name: 'Collapse all sections', exact: true }).click();
  const canvas = page.getByTestId('prompt-graph-canvas');
  const section = canvas.locator('.react-flow__node[data-id="section:mission"]');
  const variable = canvas.locator('.react-flow__node[data-id="variable:document"]');
  const edge = canvas.locator('[data-id="declares:section:mission->variable:document"] .react-flow__edge-path');
  await variable.click();
  await variable.focus();
  await page.evaluate(() => document.fonts.ready);
  const rectangle = (node: import('@playwright/test').Locator) =>
    node.evaluate((element) => {
      const matrix = new DOMMatrix(element.style.transform);
      return { x: matrix.e, y: matrix.f, width: element.offsetWidth, height: element.offsetHeight };
    });
  type Side = 'left' | 'right' | 'top' | 'bottom';
  // Native paths attach to the outward edge of a handle, not the card's border.
  const anchor = (node: import('@playwright/test').Locator, type: 'source' | 'target', side: Side) =>
    node.evaluate(
      (element, { type, side }) => {
        const handle = element.querySelector(`[data-handleid="${type}-${side}"]`)!.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        const zoom = bounds.width / element.offsetWidth;
        const matrix = new DOMMatrix(element.style.transform);
        return {
          x:
            matrix.e +
            ((side === 'left' ? handle.left : side === 'right' ? handle.right : handle.x + handle.width / 2) -
              bounds.x) /
              zoom,
          y:
            matrix.f +
            ((side === 'top' ? handle.top : side === 'bottom' ? handle.bottom : handle.y + handle.height / 2) -
              bounds.y) /
              zoom,
        };
      },
      { type, side },
    );
  async function assertRoute(from: Side, to: Side) {
    await expect
      .poll(async () => {
        const start = await anchor(section, 'source', from);
        const end = await anchor(variable, 'target', to);
        return edge.evaluate(
          (path: SVGPathElement, expected) => {
            const length = path.getTotalLength();
            const first = path.getPointAtLength(0);
            const last = path.getPointAtLength(length);
            return Math.max(
              Math.hypot(first.x - expected.start.x, first.y - expected.start.y),
              Math.hypot(last.x - expected.end.x, last.y - expected.end.y),
              length - Math.abs(expected.start.x - expected.end.x) - Math.abs(expected.start.y - expected.end.y),
            );
          },
          { start, end },
        );
      })
      .toBeLessThan(1);
    await expect.poll(() => minimumLabelGap(page)).toBeGreaterThanOrEqual(15.5);
  }
  async function moveWithKeys(target: { x: number; y: number }) {
    await variable.focus();
    const expected = await position(variable);
    for (const axis of ['x', 'y'] as const) {
      // xyflow moves 5 graph pixels, or 20 with Shift, per native key press.
      const delta = Math.round((target[axis] - expected[axis]) / 5) * 5;
      expected[axis] += delta;
      const key = axis === 'x' ? (delta < 0 ? 'ArrowLeft' : 'ArrowRight') : delta < 0 ? 'ArrowUp' : 'ArrowDown';
      for (let count = 0; count < Math.floor(Math.abs(delta) / 20); count++) await page.keyboard.press(`Shift+${key}`);
      for (let count = 0; count < (Math.abs(delta) % 20) / 5; count++) await page.keyboard.press(key);
    }
    await expect(variable).toBeFocused();
    await expect
      .poll(async () =>
        Math.hypot((await position(variable)).x - expected.x, (await position(variable)).y - expected.y),
      )
      .toBeLessThan(1);
  }
  const sourceBox = await rectangle(section);
  const targetBox = await rectangle(variable);
  const right = { x: sourceBox.x + sourceBox.width + 70, y: sourceBox.y + (sourceBox.height - targetBox.height) / 2 };
  const zoom = await canvas
    .locator('.react-flow__viewport')
    .evaluate((element) => new DOMMatrix(element.style.transform).a);
  const box = await variable.boundingBox();
  if (!box) throw new Error('The variable chip is unavailable.');
  const beforePath = await edge.getAttribute('d');
  await page.mouse.move(box.x + 25, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 25 + ((right.x - targetBox.x) * zoom) / 2, box.y + 15, { steps: 8 });
  await expect.poll(() => edge.getAttribute('d')).not.toBe(beforePath);
  await page.mouse.move(box.x + 25 + (right.x - targetBox.x) * zoom, box.y + 15 + (right.y - targetBox.y) * zoom, {
    steps: 8,
  });
  await page.mouse.up();
  await assertRoute('right', 'left');
  for (const [name, from, to, destination] of [
    [
      'below',
      'bottom',
      'top',
      { x: sourceBox.x + (sourceBox.width - targetBox.width) / 2, y: sourceBox.y + sourceBox.height + 70 },
    ],
    ['left', 'left', 'right', { x: sourceBox.x - targetBox.width - 70, y: right.y }],
    [
      'above',
      'top',
      'bottom',
      { x: sourceBox.x + (sourceBox.width - targetBox.width) / 2, y: sourceBox.y - targetBox.height - 70 },
    ],
  ] as const) {
    await moveWithKeys(destination);
    await assertRoute(from, to);
    await page.screenshot({ path: test.info().outputPath(`compact-route-${name}.png`) });
  }
  expect((await savedPrompt(page)).text).toBe(source);
});
