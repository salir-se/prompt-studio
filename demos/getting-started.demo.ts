import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { showOverlay, spotlight, test } from '@argo-video/cli';
import { expect, type Locator } from '@playwright/test';
import { createArgoHumanCursor } from './argo-human-cursor';
import { agentSay, mountAgentPanel } from './helpers/agent-panel';
import { connectAgent } from './helpers/mcp-agent';
import { startTutorialModel } from './helpers/tutorial-model';

/**
 * Getting-started tutorial: an AI agent edits a prompt through Prompt Studio's MCP server while the person
 * watches, reviews, runs, tests and shares it in the browser. Record with `bun run demo:take -- getting-started`.
 *
 * The left panel shows a scripted agent conversation; every tool call listed there is a real MCP call to this
 * repository's server, which changes the open Studio tab. The project is a fresh Git copy of
 * `examples/starter` at DEMO_PROJECT_DIR (default `~/support-prompts`), removed after the take.
 * Set DEMO_SCREENSHOTS=<dir> to save README screenshots.
 */
const DEMO_NAME = 'getting-started';
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PROJECT_DIR = process.env.DEMO_PROJECT_DIR ?? path.join(homedir(), 'support-prompts');
const BILLING_MESSAGE = 'I was charged twice for my November invoice. Please fix it.';
const LOCKED_MESSAGE = 'I am locked out after resetting my password and cannot sign in.';
const EXAMPLES = `<examples>
- billing: "I was charged twice this month." → billing, high
- access: "The two-factor code never arrives." → access, high
- bug: "Export to PDF shows a blank page." → bug, normal
- question: "Can I invite a colleague?" → question, low
</examples>

`;

function prepareProject(): void {
  rmSync(PROJECT_DIR, { recursive: true, force: true });
  cpSync(path.join(REPO_ROOT, 'examples/starter'), PROJECT_DIR, { recursive: true });
  rmSync(path.join(PROJECT_DIR, 'studio.manifest.json'), { force: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Prompt Studio', '-c', 'user.email=demo@example.com', ...args], {
      cwd: PROJECT_DIR,
    });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Starter prompts');
}

test(DEMO_NAME, async ({ page, narration }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(20_000);
  prepareProject();
  const model = await startTutorialModel();
  page.on('close', model.close);
  const snap = async (name: string) => {
    if (process.env.DEMO_SCREENSHOTS)
      await page.screenshot({ path: path.join(process.env.DEMO_SCREENSHOTS, `${name}.png`) });
  };

  // Off camera: no one-time shortcut tips over the controls being explained.
  await page.addInitScript(() => localStorage.setItem('prompt-studio:shortcut-tips:v1', 'false'));
  await page.goto('/');
  const pathField = page.getByRole('textbox', { name: 'Repository URL or filesystem path' });
  await expect(pathField).toBeVisible();
  await mountAgentPanel(page, 'AI agent · MCP client');

  await narration.startRecording(page);
  const cursor = await createArgoHumanCursor(page, {
    seed: DEMO_NAME,
    accent: '#0f766e',
    size: 36,
    start: { x: 0.7, y: 0.3 },
  });
  const hold = (scene: string, startedAt: number) =>
    page.waitForTimeout(Math.max(0, narration.durationFor(scene) - (Date.now() - startedAt)));
  let started: number;

  // 1. Welcome
  narration.mark('welcome');
  await snap('welcome');
  await showOverlay(page, 'welcome', narration.durationFor('welcome'));

  // 2. Connect the agent and open the project
  narration.mark('connect');
  started = Date.now();
  void showOverlay(page, 'connect', narration.durationFor('connect'));
  await agentSay(
    page,
    'cmd',
    'claude mcp add prompt-studio -- bunx --package @salir/prompt-studio prompt-studio-mcp --stdio',
    14,
  );
  await cursor.click(pathField);
  await pathField.pressSequentially(PROJECT_DIR, { delay: 40 });
  await cursor.click(page.getByRole('button', { name: 'Open project', exact: true }));
  await expect(page.getByTestId('prompt-root-support-triage')).toBeVisible();
  const agent = await connectAgent();
  page.on('close', () => void agent.close());
  await hold('connect', started);

  // 3. The agent reads the prompt (real MCP calls; the tab follows)
  narration.mark('agent-reads');
  started = Date.now();
  await agentSay(page, 'you', 'Review the support triage prompt in Prompt Studio.');
  await agent.call('list_documents');
  await agentSay(page, 'tool', 'list_documents');
  await agent.call('open_document', { rootId: 'support-triage' });
  await agentSay(page, 'tool', 'open_document support-triage');
  const original = await agent.call('read_document', { rootId: 'support-triage' });
  await agentSay(page, 'tool', 'read_document support-triage');
  await cursor.click(page.getByRole('button', { name: 'Graph', exact: true }));
  await expect(page.getByText('Output Format', { exact: true }).first()).toBeVisible();
  await agentSay(
    page,
    'agent',
    'Five sections: mission, categories, urgency, customer message, output format. There are no examples yet.',
  );
  await hold('agent-reads', started);

  // 4. The agent edits; the graph grows a new section
  narration.mark('agent-edits');
  started = Date.now();
  void showOverlay(page, 'agent-edits', narration.durationFor('agent-edits'));
  await agentSay(
    page,
    'you',
    'Add an urgent level for security reports, and an examples section with one message per category.',
  );
  const withExamples = original
    .replace(
      '- low: a question or a suggestion',
      '- low: a question or a suggestion\n- urgent: the customer reports a security problem or exposed data',
    )
    .replace('<customer_message>', `${EXAMPLES}<customer_message>`);
  await agent.call('edit_document', {
    rootId: 'support-triage',
    text: withExamples,
    message: 'Add urgent level and examples',
  });
  await agentSay(page, 'tool', 'edit_document support-triage "Add urgent level and examples"');
  const examplesNode = page.getByText('Examples', { exact: true }).first();
  await expect(examplesNode).toBeVisible();
  await agentSay(
    page,
    'agent',
    'Done: urgency has an urgent level, and a new Examples section sits before the customer message.',
  );
  void spotlight(page, page.locator('.react-flow__node', { hasText: 'Examples' }).first(), { duration: 3500 });
  await snap('agent-edit');
  await hold('agent-edits', started);

  // 5. Review what the agent wrote, and its history
  narration.mark('review');
  started = Date.now();
  await cursor.click(page.locator('.react-flow__node', { hasText: 'Examples' }).first());
  await page.waitForTimeout(1800);
  await cursor.click(page.getByRole('button', { name: 'History', exact: true }));
  await expect(page.getByText(/Add urgent level and examples/).first()).toBeVisible();
  await hold('review', started);
  await page.keyboard.press('Escape');

  // 6. Steer: a stricter output contract
  narration.mark('steer');
  started = Date.now();
  await agentSay(page, 'you', 'Make the output stricter: next_step must be one sentence of at most 20 words.');
  const current = await agent.call('read_document', { rootId: 'support-triage' });
  const stricter = current.replace(
    'Return one JSON object and nothing else:',
    'Return one JSON object and nothing else. next_step is one sentence of at most 20 words. No markdown, no comments:',
  );
  await agent.call('edit_document', {
    rootId: 'support-triage',
    text: stricter,
    message: 'Tighten the output contract',
  });
  await agentSay(page, 'tool', 'edit_document support-triage "Tighten the output contract"');
  await expect(page.getByText(/at most 20 words/).first()).toBeVisible();
  void spotlight(page, page.locator('.react-flow__node', { hasText: 'Output Format' }).first(), { duration: 3000 });
  await agentSay(page, 'agent', 'Updated the output format. Want me to add a test case for it?');
  await hold('steer', started);

  // 7. Run with a model (a local test model in this video)
  narration.mark('run');
  started = Date.now();
  void showOverlay(page, 'run', narration.durationFor('run'));
  await page.keyboard.press('Alt+4');
  const workspace = page.locator('[data-studio-panels]');
  await cursor.click(workspace.getByRole('tab', { name: 'Settings', exact: true }));
  await cursor.click(workspace.getByRole('button', { name: 'Open app settings', exact: true }));
  const settings = page.getByRole('dialog', { name: 'App settings', exact: true });
  await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai-compat');
  await settings.getByLabel('Model', { exact: true }).fill('local-test-model');
  await settings.getByLabel(/^API base URL/).fill(model.url);
  await settings.getByLabel(/^API key/).fill('local-test-key');
  await cursor.click(settings.getByRole('button', { name: /^Save settings/ }));
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await cursor.click(workspace.getByRole('tab', { name: 'Single run', exact: true }));
  const single = workspace.getByRole('tabpanel', { name: 'Single run', exact: true });
  await single.getByRole('textbox', { name: 'company_name', exact: true }).fill('Northwind');
  const message = single.getByRole('textbox', { name: 'customer_message', exact: true });
  await cursor.click(message);
  await message.pressSequentially(BILLING_MESSAGE, { delay: 18 });
  await cursor.click(single.getByRole('button', { name: /^Run prompt/ }));
  await expect(single.getByText(/"category":"billing"/)).toBeVisible();
  await snap('run');
  await hold('run', started);

  // 8. Test suite
  narration.mark('tests');
  started = Date.now();
  await cursor.click(workspace.getByRole('button', { name: 'Open evaluations', exact: true }));
  await cursor.click(workspace.getByRole('tab', { name: 'Test suites', exact: true }));
  const suites = workspace.getByRole('tabpanel', { name: 'Test suites', exact: true });
  await cursor.click(suites.getByRole('button', { name: 'New suite', exact: true }));
  await fill(suites, 'Suite name', 'Triage regression');
  await fill(suites, 'Test name', 'Double charge');
  await suites.getByRole('textbox', { name: 'company_name', exact: true }).last().fill('Northwind');
  await fill(suites, 'customer_message', BILLING_MESSAGE);
  await fill(suites, /^Must include/, 'billing');
  await cursor.click(suites.getByRole('button', { name: 'Add test', exact: true }));
  await fill(suites, 'Test name', 'Locked account');
  await suites.getByRole('textbox', { name: 'company_name', exact: true }).last().fill('Northwind');
  await fill(suites, 'customer_message', LOCKED_MESSAGE);
  await fill(suites, /^Must include/, 'access');
  await cursor.click(suites.getByRole('button', { name: 'Save suite', exact: true }));
  await cursor.click(suites.getByRole('button', { name: 'Run test suite', exact: true }));
  await expect(workspace.getByRole('region', { name: 'Results for Double charge' })).toContainText('passed', {
    timeout: 30_000,
  });
  await expect(workspace.getByRole('region', { name: 'Results for Locked account' })).toContainText('passed');
  await snap('evaluations');
  await hold('tests', started);

  // 9. Save a version and look at Share (nothing is published)
  narration.mark('share');
  started = Date.now();
  await page.keyboard.press('Escape');
  await cursor.click(page.getByRole('button', { name: 'Versions', exact: true }).first());
  const versionMessage = page.getByLabel('Version message', { exact: true });
  await versionMessage.fill('Agent: urgent level, examples, stricter output');
  await cursor.click(page.getByRole('button', { name: 'Save version', exact: true }));
  await expect(page.getByText('Saved a version of your project.')).toBeVisible();
  await cursor.click(page.getByRole('tab', { name: 'Share', exact: true }));
  await expect(page.getByRole('button', { name: /Connect GitHub/ })).toBeVisible();
  await hold('share', started);

  // 10. Outro
  narration.mark('outro');
  await showOverlay(page, 'outro', narration.durationFor('outro'));

  await cursor.dispose();
  await agent.close();
  if (!process.env.DEMO_KEEP_PROJECT) rmSync(PROJECT_DIR, { recursive: true, force: true });

  async function fill(scope: Locator, name: string | RegExp, value: string): Promise<void> {
    const field = scope.getByRole('textbox', { name, exact: typeof name === 'string' }).last();
    await field.scrollIntoViewIfNeeded();
    await cursor.click(field);
    await field.fill('');
    await field.pressSequentially(value, { delay: 14 });
  }
});
