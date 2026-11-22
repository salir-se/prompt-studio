import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { expect, test } from './helpers/mcp-studio-fixture';

test('a subscribed MCP client sees browser edits in less than one second', async ({ page, agent }) => {
  await agent.call('open_document', { rootId: 'order-status' });
  const { resources } = await agent.client.listResources();
  expect(resources.map(({ name }) => name)).toEqual(['document', 'sections', 'findings', 'events']);
  const document = resources.find(({ name }) => name === 'document')!.uri;
  const sections = resources.find(({ name }) => name === 'sections')!.uri;
  const findings = resources.find(({ name }) => name === 'findings')!.uri;
  const events = resources.find(({ name }) => name === 'events')!.uri;
  const notices: { uri: string; at: number }[] = [];
  agent.client.setNotificationHandler(ResourceUpdatedNotificationSchema, ({ params }) => {
    notices.push({ uri: params.uri, at: Date.now() });
  });
  const writer = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
  const original = await writer.inputValue();
  await agent.client.subscribeResource({ uri: document });
  await writer.evaluate((element) => {
    element.addEventListener('input', () => element.setAttribute('data-edited-at', String(Date.now())), { once: true });
  });
  await writer.fill(`${original}\n<example>\nKeep order details private.\n</example>\n`);
  const edited = Number(await writer.getAttribute('data-edited-at'));
  expect(edited).toBeGreaterThan(0);
  await expect.poll(() => notices.some(({ at }) => at >= edited)).toBe(true);
  expect(notices.every(({ uri }) => uri === document)).toBe(true);
  expect(notices.find(({ at }) => at >= edited)!.at - edited).toBeLessThan(1000);

  async function read(uri: string) {
    const content = (await agent.client.readResource({ uri })).contents[0];
    return JSON.parse(content && 'text' in content ? String(content.text) : 'null');
  }
  expect(await read(document)).toMatchObject({
    rootId: 'order-status',
    draft: true,
    text: expect.stringContaining('Keep order details private.'),
  });
  expect(await read(sections)).toEqual(expect.arrayContaining([expect.objectContaining({ tag: 'example' })]));
  expect(await read(events)).toEqual(
    expect.arrayContaining([expect.objectContaining({ action: 'document.edited', rootId: 'order-status' })]),
  );

  await agent.client.unsubscribeResource({ uri: document });
  // Subscribe to the log so its notification acknowledges the next edit without polling the document.
  await agent.client.subscribeResource({ uri: events });
  const priorNotices = notices.length;
  await writer.fill(original);
  await expect.poll(() => notices.slice(priorNotices).map(({ uri }) => uri)).toEqual([events]);

  await agent.call('run_checks', { rootId: 'order-status' });
  expect(await read(findings)).toMatchObject({ automatic: { freshness: 'current' } });
  await agent.call('propose_check', {
    rootId: 'order-status',
    kind: 'rule',
    rule: { kind: 'minimum-length', minChars: 20 },
  });
  await page.getByRole('button', { name: 'Accept proposal', exact: true }).click();
  await expect(page.getByText('Checks saved and rechecked', { exact: true })).toBeVisible();
  expect(await read(events)).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'check.saved' })]));
  await page
    .getByRole('complementary', { name: 'Verify', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(page.getByText('Saved a version of your project.', { exact: true })).toBeVisible();
  expect(await read(events)).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'version.saved' })]));
});
