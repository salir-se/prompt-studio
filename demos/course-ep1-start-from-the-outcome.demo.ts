import { showOverlay, test } from '@argo-video/cli';
import { expect } from '@playwright/test';
import { agentSay } from './helpers/agent-panel';
import {
  connectAgent,
  pasteInto,
  pathField,
  ROOT_ID,
  setUpEpisode,
  startCamera,
  typeInto,
} from './course/course-session';
import {
  FINISHED_DESIGN,
  INPUT_EXAMPLE,
  MISSION,
  OUTPUT_DESCRIPTION,
  PROJECT_JSON,
  pretty,
} from './course/course-texts';

/**
 * Course episode 1, "Start from the outcome" (`demos/course/ep1-start-from-the-outcome.plan.md`): an empty project
 * gets the order-status prompt with its mission, the lookup_order tool, the customer_message variable, and JSON
 * Schema input and output contracts; then the agent reads the contract through MCP.
 * Record with `bun run demo:take -- course-ep1-start-from-the-outcome`.
 */
const DEMO_NAME = 'course-ep1-start-from-the-outcome';
const TOOL = PROJECT_JSON.tools[0];
const VARIABLE = PROJECT_JSON.variables[0];

test(DEMO_NAME, async ({ page, narration }) => {
  test.setTimeout(600_000);
  const episode = await setUpEpisode(page);
  page.on('close', () => void episode.close());
  const { cursor, hold } = await startCamera(page, narration, DEMO_NAME);

  narration.mark('course-intro');
  await showOverlay(page, 'course-intro', narration.durationFor('course-intro'));

  narration.mark('outcome-first');
  await agentSay(
    page,
    'you',
    'Plan: an order-status assistant. Output for our support system: {reply, next_action, order_id}.',
  );
  await hold('outcome-first');

  narration.mark('open-project');
  await pasteInto(cursor, pathField(page), episode.project.dir);
  await cursor.click(page.getByRole('button', { name: 'Open project', exact: true }));
  await expect(page.getByRole('status').getByText('order-status', { exact: true })).toBeVisible();
  await cursor.click(page.getByRole('banner').getByRole('button', { name: 'New prompt', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Create a prompt' });
  await typeInto(cursor, dialog.getByRole('textbox', { name: 'Prompt title' }), 'Order status', 40);
  await expect(dialog.getByRole('textbox', { name: 'Prompt ID' })).toHaveValue(ROOT_ID);
  await hold('open-project');

  narration.mark('declare-dependencies');
  await cursor.click(dialog.getByText('Inputs and tools', { exact: true }));
  await typeInto(cursor, dialog.getByRole('textbox', { name: 'Tool', exact: true }), TOOL.name, 30);
  await typeInto(cursor, dialog.getByRole('textbox', { name: 'Tool description' }), TOOL.description, 6);
  await pasteInto(cursor, dialog.getByRole('textbox', { name: 'Input JSON Schema' }), pretty(TOOL.inputSchema));
  await typeInto(cursor, dialog.getByRole('textbox', { name: 'Variable', exact: true }), VARIABLE.name, 30);
  await typeInto(cursor, dialog.getByRole('textbox', { name: 'Variable purpose' }), VARIABLE.purpose, 6);
  await typeInto(cursor, dialog.getByRole('textbox', { name: 'Example value' }), VARIABLE.sample, 6);
  await cursor.click(dialog.getByRole('button', { name: 'Create prompt', exact: true }));
  await expect(dialog).toBeHidden();
  await hold('declare-dependencies');

  narration.mark('state-the-job');
  const composer = page.locator('main textarea').first();
  await expect(composer).toContainText("Describe this prompt's primary responsibility.");
  await cursor.click(composer, { target: { x: 0.3, y: 0.12 } });
  await composer.evaluate((element: HTMLTextAreaElement) => {
    const placeholder = "Describe this prompt's primary responsibility.";
    const start = element.value.indexOf(placeholder);
    element.setSelectionRange(start, start + placeholder.length);
  });
  await page.waitForTimeout(500);
  await composer.pressSequentially(MISSION, { delay: 8 });
  await page.keyboard.press('Control+S');
  await expect(page.getByRole('status').getByText('Saved on this computer')).toBeVisible();
  await hold('state-the-job');

  narration.mark('input-contract');
  await cursor.click(page.getByRole('button', { name: 'Design', exact: true }));
  const design = page.getByRole('complementary', { name: 'Prompt design' });
  const input = design.getByRole('region', { name: 'Expected input' });
  await cursor.click(input.getByRole('combobox', { name: 'Input' }));
  await input.getByRole('combobox', { name: 'Input' }).selectOption('json');
  await pasteInto(
    cursor,
    input.getByRole('textbox', { name: 'Input JSON schema' }),
    pretty(FINISHED_DESIGN.input.jsonSchema),
  );
  await expect(design.getByRole('region', { name: 'Readiness' })).toContainText('Input example 1');
  const sample = design.getByRole('textbox', { name: 'JSON sample to verify' });
  await sample.scrollIntoViewIfNeeded();
  await pasteInto(cursor, sample, INPUT_EXAMPLE);
  await cursor.click(design.getByRole('button', { name: 'Verify sample', exact: true }));
  await cursor.click(design.getByRole('button', { name: 'Use verified sample as example', exact: true }));
  await expect(design.getByRole('region', { name: 'Readiness' })).not.toContainText('Input example 1');
  await hold('input-contract');

  narration.mark('output-contract');
  void showOverlay(page, 'output-contract', narration.durationFor('output-contract'));
  const output = design.getByRole('region', { name: 'Expected output' });
  await cursor.click(output.getByRole('combobox', { name: 'Output' }));
  await output.getByRole('combobox', { name: 'Output' }).selectOption('json');
  await typeInto(cursor, output.getByRole('textbox', { name: 'Output description' }), OUTPUT_DESCRIPTION, 6);
  await pasteInto(
    cursor,
    output.getByRole('textbox', { name: 'Output JSON schema' }),
    pretty(FINISHED_DESIGN.output.jsonSchema),
  );
  await expect(design.getByRole('region', { name: 'Readiness' })).toContainText('Output example 1');
  await cursor.click(design.getByRole('combobox', { name: 'JSON contract to verify' }));
  await design.getByRole('combobox', { name: 'JSON contract to verify' }).selectOption('output');
  await pasteInto(cursor, sample, JSON.stringify(FINISHED_DESIGN.output.examples[1]));
  await cursor.click(design.getByRole('button', { name: 'Verify sample', exact: true }));
  await cursor.click(design.getByRole('button', { name: 'Use verified sample as example', exact: true }));
  await design.getByRole('region', { name: 'Readiness' }).scrollIntoViewIfNeeded();
  await expect(design.getByRole('region', { name: 'Readiness' })).toContainText('Structurally ready');
  await cursor.click(design.getByRole('button', { name: 'Save prompt design', exact: true }));
  await expect(design.getByText(/Structurally ready · Saved version/)).toBeVisible();
  await hold('output-contract');
  await page.keyboard.press('Escape');

  narration.mark('agent-sees-contract');
  await agentSay(
    page,
    'cmd',
    'claude mcp add prompt-studio -- bunx --package @salir/prompt-studio prompt-studio-mcp --stdio',
    10,
  );
  const agent = await connectAgent();
  page.on('close', () => void agent.close());
  await agentSay(page, 'you', 'Read the order-status prompt in Prompt Studio and summarize its contract.');
  await agent.call('list_documents');
  await agentSay(page, 'tool', 'list_documents');
  await agent.call('open_document', { rootId: ROOT_ID });
  await agentSay(page, 'tool', `open_document ${ROOT_ID}`);
  await agent.call('read_document', { rootId: ROOT_ID });
  await agentSay(page, 'tool', `read_document ${ROOT_ID}`);
  const contract = JSON.parse(await agent.call('get_design', { rootId: ROOT_ID }));
  expect(JSON.stringify(contract)).toContain('ask_for_order_id');
  await agentSay(page, 'tool', `get_design ${ROOT_ID}`);
  await agentSay(
    page,
    'agent',
    'One mission section so far. Input: customer_message and company_name. Output: reply, next_action (none | escalate | ask_for_order_id), order_id (ORD-12345 or null). Tool: lookup_order(order_id).',
    12,
  );
  await hold('agent-sees-contract');

  narration.mark('recap');
  void showOverlay(page, 'recap', narration.durationFor('recap'));
  await cursor.click(page.getByRole('button', { name: 'Graph', exact: true }));
  await cursor.click(page.getByRole('button', { name: /fit view/i }).first());
  await hold('recap');

  await cursor.dispose();
  await agent.close();
});
