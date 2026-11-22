import { expect, ORDER_STATUS_SOURCE, test } from './helpers/mcp-studio-fixture';

interface Section {
  id: string;
  title: string;
  depth: number;
}

/**
 * Outcome test (roadmap #6): an AI agent edits a prompt one SECTION at a time through MCP — a real MCP client over
 * stdio → the MCP server → the Studio's WebSocket gateway → the open editor tab — and the person sees the graph
 * change live. Editing one section leaves every other section byte-identical.
 */
test('an agent builds the order-status prompt section by section and the graph follows', async ({ page, agent }) => {
  // Given: the agent opens the order-status prompt and the person watches the graph
  await agent.call('open_document', { rootId: 'order-status' });
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const cards = page.getByTestId('fragment-node');
  await expect(cards).toHaveCount(3);
  const listed = await agent.json<{ sections: Section[] }>('list_sections', { rootId: 'order-status' });
  expect(listed.sections.map((section) => section.id)).toEqual(['role', 'tools', 'output']);

  // When: the agent inserts an examples section after the role
  const inserted = await agent.json<{ inserted: string }>('insert_section', {
    rootId: 'order-status',
    sectionId: 'role',
    tag: 'examples',
    body: 'Customer: "Where is order 1042?" → call lookup_order with "1042".',
  });

  // Then: the graph shows a fourth section card with the new body
  expect(inserted.inserted).toBe('examples');
  await expect(cards).toHaveCount(4);
  await expect(cards.filter({ hasText: 'Where is order 1042?' })).toHaveCount(1);

  // When: the agent rewrites only the output section
  const before = await agent.call('read_document', { rootId: 'order-status' });
  await agent.call('edit_section', {
    rootId: 'order-status',
    sectionId: 'output',
    body: 'Reply with one JSON object: {"order_id": string, "status": string}.',
    message: 'define the JSON reply',
  });

  // Then: the output card shows the new instruction and every other section is byte-identical
  await expect(cards.filter({ hasText: '"order_id": string' })).toHaveCount(1);
  const after = await agent.call('read_document', { rootId: 'order-status' });
  const output = /<output>\n[\s\S]*?<\/output>/;
  expect(after.replace(output, '')).toBe(before.replace(output, ''));
  expect(after).toContain('<output>\nReply with one JSON object: {"order_id": string, "status": string}.\n</output>');
  expect(before).toContain(ORDER_STATUS_SOURCE.split('\n\n')[0]);

  // When: the agent moves the examples below the tools, then removes them
  await agent.call('move_section', { rootId: 'order-status', sectionId: 'examples', direction: 'down' });
  await expect
    .poll(async () =>
      (await agent.json<{ sections: Section[] }>('list_sections', { rootId: 'order-status' })).sections.map(
        (section) => section.id,
      ),
    )
    .toEqual(['role', 'tools', 'examples', 'output']);
  await agent.call('remove_section', { rootId: 'order-status', sectionId: 'examples' });

  // Then: the graph is back to three cards, and History records each section edit as a commit
  await expect(cards).toHaveCount(3);
  await expect
    .poll(
      async () =>
        (await agent.json<{ message: string }[]>('history', { rootId: 'order-status' })).map(
          (commit) => commit.message,
        ),
      { timeout: 20_000 },
    )
    .toEqual(expect.arrayContaining(['define the JSON reply', 'move Examples down', 'remove Examples']));

  // And: an unknown section is a stable, actionable error
  await expect(agent.call('read_section', { rootId: 'order-status', sectionId: 'missing' })).rejects.toThrow(
    /No section "missing" — run listSections for ids\. \(missing_target\)/,
  );
});
