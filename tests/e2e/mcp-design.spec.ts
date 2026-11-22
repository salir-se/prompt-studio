import { expect, test } from './helpers/mcp-studio-fixture';

const ORDER_REPLY = {
  kind: 'json',
  description: 'The order status reply.',
  jsonSchema: {
    type: 'object',
    required: ['order_id', 'status'],
    properties: { order_id: { type: 'string' }, status: { type: 'string', enum: ['shipped', 'pending', 'unknown'] } },
    additionalProperties: false,
  },
  examples: [{ order_id: '1042', status: 'shipped' }],
};

/**
 * Outcome test (roadmap #7): an AI agent records the order-status prompt's design through MCP — a JSON output
 * contract, a sample check, and a workflow pattern for one section — and the person sees each change in the Design
 * panel of the open tab. An invalid contract is refused with the validator's messages and nothing is saved.
 */
test('an agent sets the JSON reply contract and a section workflow; the Design panel shows both', async ({
  page,
  agent,
}) => {
  // Given: the agent opens the order-status prompt and reads its design
  await agent.call('open_document', { rootId: 'order-status' });
  const initial = await agent.json<{ output: { kind: string }; readiness: string[] }>('get_design', {
    rootId: 'order-status',
  });
  expect(initial.output.kind).toBe('freeform');

  // When: the agent sets the prompt's output to the JSON reply contract
  const saved = await agent.json<{ version: number }>('set_design', { rootId: 'order-status', output: ORDER_REPLY });

  // Then: the Design panel opens on the whole prompt with the structured JSON output and its schema
  const panel = page.getByRole('complementary', { name: 'Prompt design', exact: true });
  await expect(panel.getByRole('heading', { name: 'Prompt design', exact: true })).toBeVisible();
  await expect(panel.getByLabel('Output', { exact: true })).toHaveValue('json');
  await expect(panel.getByLabel('Output JSON schema', { exact: true })).toHaveValue(/"order_id"/);
  expect(saved.version).toBeGreaterThan(0);

  // When: the agent checks a model reply that matches and one that does not
  const good = await agent.json<{ valid: boolean }>('verify_sample', {
    rootId: 'order-status',
    sample: '{"order_id": "1042", "status": "shipped"}',
  });
  const bad = await agent.json<{ valid: boolean; errors: string[] }>('verify_sample', {
    rootId: 'order-status',
    sample: '{"order_id": "1042", "status": "lost"}',
  });

  // Then: the first matches the contract and the second names the schema error
  expect(good.valid).toBe(true);
  expect(bad.valid).toBe(false);
  expect(bad.errors.join(' ')).toMatch(/status/);

  // When: the agent tries a contract whose example breaks its own schema
  await expect(
    agent.call('set_design', { rootId: 'order-status', output: { ...ORDER_REPLY, examples: [{ order_id: 7 }] } }),
  ).rejects.toThrow(/Output example 1:[\s\S]*\(invalid_input\)/);

  // Then: nothing was saved — the stored contract still has the valid example
  const after = await agent.json<{ output: { examples: unknown[] } }>('get_design', { rootId: 'order-status' });
  expect(after.output.examples).toEqual(ORDER_REPLY.examples);

  // When: the agent applies the "Agent with tools" pattern to the tools section
  const patterns = await agent.json<{ id: string; name: string }[]>('list_workflow_patterns');
  expect(patterns.map((pattern) => pattern.id)).toContain('tools');
  await agent.call('apply_workflow_pattern', { rootId: 'order-status', sectionId: 'tools', patternId: 'tools' });

  // Then: the Design panel shows that section's sub-prompt design with the pattern's Mermaid workflow
  await expect(panel.getByRole('heading', { name: 'Sub-prompt design', exact: true })).toBeVisible();
  await expect(panel.getByText('order-status.tools', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Sub-prompt workflow Mermaid', { exact: true })).toHaveValue(/Tool needed\?/);
  const section = await agent.json<{ workflow: string }>('get_design', { rootId: 'order-status', sectionId: 'tools' });
  expect(section.workflow).toContain('Decision{Tool needed?}');
});
