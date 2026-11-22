import { showOverlay, test } from '@argo-video/cli';
import { expect } from '@playwright/test';
import { agentSay } from './helpers/agent-panel';
import { orderJson } from './helpers/demo-orders-mcp';
import {
  closeDesign,
  connectModel,
  replayEpisode1,
  replayEpisode2,
  replayEpisode3,
  setSectionDesigns,
} from './course/course-replay';
import {
  connectAgent,
  graphNode,
  pasteInto,
  ROOT_ID,
  setUpEpisode,
  startCamera,
  typeInto,
} from './course/course-session';
import { FINISHED_DESIGN, PROJECT_JSON } from './course/course-texts';

/**
 * Course episode 4, "Contracts and tools" (`demos/course/ep4-contracts-and-tools.plan.md`): a failing output sample,
 * a passing one kept as an example, two more examples verified by the agent, the company_name variable with the
 * configuration lifecycle, the lookup_order definition, a mocked run and a real MCP call to the local "Demo orders"
 * service. Record with `bun run demo:take -- course-ep4-contracts-and-tools`.
 */
const DEMO_NAME = 'course-ep4-contracts-and-tools';
const FAILING = '{"reply":"Refund issued.","next_action":"refund","order_id":"10423"}';
const [PASSING, ASK, ESCALATE] = FINISHED_DESIGN.output.examples;
const COMPANY = PROJECT_JSON.variables[1];

test(DEMO_NAME, async ({ page, narration }) => {
  test.setTimeout(600_000);
  const episode = await setUpEpisode(page);
  page.on('close', () => void episode.close());
  const agent = await connectAgent();
  page.on('close', () => void agent.close());
  // Off camera: the end state of episodes 1–3, and the local test model connected in App settings.
  await replayEpisode1(page, agent, episode.project.dir);
  await replayEpisode2(agent);
  await replayEpisode3(agent);
  await closeDesign(page);
  await connectModel(page, episode.model.url);
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(graphNode(page, 'Customer message')).toBeVisible();

  const { cursor, hold } = await startCamera(page, narration, DEMO_NAME);
  const design = page.getByRole('complementary', { name: 'Prompt design' });
  const sample = design.getByRole('textbox', { name: 'JSON sample to verify' });
  const message = design.getByRole('status');

  /** Shows the run's JSON output, then opens its tool call to show the arguments the model sent. */
  const showRunResult = async (orderId: string) => {
    const single = page.locator('[data-studio-panels]').getByRole('tabpanel', { name: 'Single run', exact: true });
    const output = single.getByRole('region', { name: 'Model output' }).first();
    await output.scrollIntoViewIfNeeded();
    await cursor.moveTo(output, { target: { x: 0.3, y: 0.3 } });
    await page.waitForTimeout(1500);
    const history = single.getByRole('region', { name: 'Tool call history' });
    await expect(history).toContainText('lookup_order');
    await cursor.click(history.locator('summary').first());
    await expect(history).toContainText(orderId);
  };

  narration.mark('intro');
  void showOverlay(page, 'intro', narration.durationFor('intro'));
  await cursor.click(page.getByRole('button', { name: 'Design', exact: true }));
  await hold('intro');

  narration.mark('sample-fails');
  void showOverlay(page, 'sample-fails', narration.durationFor('sample-fails'));
  await sample.scrollIntoViewIfNeeded();
  await cursor.click(design.getByRole('combobox', { name: 'JSON contract to verify' }));
  await design.getByRole('combobox', { name: 'JSON contract to verify' }).selectOption('output');
  await pasteInto(cursor, sample, FAILING);
  await cursor.click(design.getByRole('button', { name: 'Verify sample', exact: true }));
  await expect(message).toContainText('next_action');
  await expect(message).toContainText('order_id');
  await expect(design.getByRole('button', { name: 'Use verified sample as example' })).toHaveCount(0);
  await cursor.moveTo(message, { target: { x: 0.3, y: 0.5 } });
  await hold('sample-fails');

  narration.mark('sample-passes');
  await pasteInto(cursor, sample, JSON.stringify(PASSING));
  await cursor.click(design.getByRole('button', { name: 'Verify sample', exact: true }));
  await expect(message).toContainText('Sample matches the JSON schema.');
  await cursor.click(design.getByRole('button', { name: 'Use verified sample as example', exact: true }));
  await cursor.click(design.getByRole('button', { name: 'Save prompt design', exact: true }));
  await expect(design.getByText(/Structurally ready · Saved version/)).toBeVisible();
  await agentSay(
    page,
    'you',
    'Verify two more output samples, one for ask_for_order_id and one for escalate, and add them as examples.',
  );
  for (const example of [ASK, ESCALATE]) {
    const verdict = await agent.call('verify_sample', { rootId: ROOT_ID, sample: JSON.stringify(example) });
    expect(verdict).toMatch(/"valid":\s*true/);
    await agentSay(page, 'tool', `verify_sample ${ROOT_ID} output → valid`);
  }
  const examples = [PASSING, ASK, ESCALATE];
  // The Output format section carries the same contract, so it gets the same examples (Tool use stays last).
  await setSectionDesigns(agent, ['output_format'], examples);
  await agent.call('set_design', { rootId: ROOT_ID, output: { ...FINISHED_DESIGN.output, examples } });
  await agentSay(page, 'tool', `set_design ${ROOT_ID} output examples`);
  await agentSay(page, 'agent', 'Both samples pass the output schema. The contract now has three examples.');
  await design.getByRole('region', { name: 'Readiness' }).scrollIntoViewIfNeeded();
  await expect(design.getByRole('region', { name: 'Readiness' })).toContainText('Structurally ready');
  await hold('sample-passes');

  narration.mark('variables');
  await closeDesign(page);
  await cursor.click(page.getByRole('button', { name: 'Variables', exact: true }));
  const variables = page.getByRole('complementary', { name: 'Project variables' });
  await expect(variables.getByText('customer_message', { exact: true })).toBeVisible();
  await cursor.moveTo(variables.getByText('customer_message', { exact: true }), { target: { x: 0.5, y: 0.5 } });
  await page.waitForTimeout(1200);
  await cursor.click(variables.getByRole('button', { name: 'Add variable', exact: true }));
  const form = variables.locator('#project-definition-editor');
  await typeInto(cursor, form.getByLabel('Name', { exact: true }), COMPANY.name, 30);
  await typeInto(cursor, form.getByLabel('Purpose', { exact: true }), COMPANY.purpose, 6);
  await typeInto(cursor, form.getByLabel('Example value', { exact: true }), COMPANY.sample, 20);
  await cursor.click(form.getByText('Advanced settings', { exact: true }));
  await cursor.click(form.getByLabel('Value source'));
  await form.getByLabel('Value source').selectOption('configuration');
  await cursor.click(variables.getByRole('button', { name: 'Save variable', exact: true }));
  await expect(variables.getByText('company_name', { exact: true })).toBeVisible();
  await expect(variables.getByText('Used by: Order status')).toHaveCount(2);
  await hold('variables');

  narration.mark('tool-definition');
  await cursor.click(variables.getByRole('button', { name: /close/i }).first());
  await cursor.click(page.getByRole('button', { name: 'Tools', exact: true }));
  const tools = page.getByRole('complementary', { name: 'Project tools' });
  await cursor.click(tools.getByRole('button', { name: 'Edit lookup_order', exact: true }));
  await expect(tools.locator('#project-definition-editor')).toContainText('ORD-[0-9]{5}');
  await cursor.moveTo(tools.locator('#project-definition-editor textarea').last(), { target: { x: 0.4, y: 0.4 } });
  await hold('tool-definition');
  await cursor.click(tools.getByRole('button', { name: 'Cancel edit', exact: true }));
  await cursor.click(tools.getByRole('button', { name: /close/i }).first());

  narration.mark('mock-run');
  void showOverlay(page, 'mock-run', narration.durationFor('mock-run'));
  await page.keyboard.press('Alt+4');
  const workspace = page.locator('[data-studio-panels]');
  await cursor.click(workspace.getByRole('tab', { name: 'Settings', exact: true }));
  await cursor.click(workspace.getByRole('button', { name: 'Open app settings', exact: true }));
  const settings = page.getByRole('dialog', { name: 'App settings', exact: true });
  await cursor.click(settings.getByRole('tab', { name: 'MCP servers', exact: true }));
  const servers = settings.getByRole('region', { name: 'MCP servers' });
  await typeInto(cursor, servers.getByLabel('Server name'), 'Demo orders', 30);
  await pasteInto(cursor, servers.getByLabel('MCP endpoint URL'), episode.orders.url);
  await cursor.click(servers.getByRole('button', { name: 'Save server', exact: true }));
  await cursor.click(servers.getByRole('button', { name: 'Discover tools', exact: true }));
  await expect(servers.getByText(/1 discovered tools/)).toBeVisible();
  await cursor.click(settings.getByRole('button', { name: 'Close', exact: true }));
  await expect(settings).toBeHidden();
  await cursor.click(workspace.getByRole('tab', { name: 'Single run', exact: true }));
  const single = workspace.getByRole('tabpanel', { name: 'Single run', exact: true });
  await cursor.click(single.getByText(/^Tool responses · \d selected$/));
  const execution = single.getByRole('region', { name: 'Tool execution' });
  await cursor.click(execution.getByLabel('Available MCP tool'));
  await execution.getByLabel('Available MCP tool').selectOption({ label: 'Demo orders / lookup_order' });
  await cursor.click(execution.getByRole('button', { name: 'Add tool', exact: true }));
  await pasteInto(cursor, execution.getByLabel('Mock response (JSON)'), orderJson('ORD-10423'));
  await typeInto(cursor, single.getByRole('textbox', { name: 'company_name', exact: true }), COMPANY.sample, 12);
  await typeInto(
    cursor,
    single.getByRole('textbox', { name: 'customer_message', exact: true }),
    'Hi, where is ORD-10423?',
    22,
  );
  await cursor.click(single.getByRole('button', { name: /^Run prompt/ }));
  await expect(single.getByText(/PG-55821/).first()).toBeVisible();
  await showRunResult('ORD-10423');
  await hold('mock-run');

  narration.mark('real-call');
  void showOverlay(page, 'real-call', narration.durationFor('real-call'));
  await cursor.click(execution.getByLabel('Execution mode'));
  await execution.getByLabel('Execution mode').selectOption('real');
  await typeInto(
    cursor,
    single.getByRole('textbox', { name: 'customer_message', exact: true }),
    'Where is ORD-99999?',
    22,
  );
  await cursor.click(single.getByRole('button', { name: /^Run prompt/ }));
  await expect(single.getByText(/I could not find order ORD-99999/).first()).toBeVisible();
  await expect(episode.orders.calls).toContain('ORD-99999');
  await showRunResult('ORD-99999');
  await hold('real-call');

  narration.mark('recap');
  void showOverlay(page, 'recap', narration.durationFor('recap'));
  await hold('recap');

  await cursor.dispose();
  await agent.close();
});
