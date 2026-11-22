/**
 * README screenshots: drives the real UI of a fresh standalone server (empty profile, temporary HOME) on a fresh
 * Git copy of `examples/starter`, with the deterministic local model from `helpers/tutorial-model.ts`, and writes
 * PNGs to `docs/images/`. Run `bun run screenshots` (builds first). Nothing in the page is mocked: every state comes
 * from the real server, the real provider adapter and the local model.
 *
 * Output is pixel-stable across runs except the Git commit hashes in `evaluations-compare.png`.
 * SCREENSHOTS_DIR=<dir> writes elsewhere; SCREENSHOTS_ONLY=a,b keeps only those images; STUDIO_PORT (default 5274).
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { startTutorialModel } from './helpers/tutorial-model';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.resolve(REPO_ROOT, process.env.SCREENSHOTS_DIR ?? 'docs/images');
const PORT = process.env.STUDIO_PORT ?? '5274';
const BASE = `http://127.0.0.1:${PORT}`;
const ONLY = process.env.SCREENSHOTS_ONLY?.split(',');

const INPUT_DESCRIPTION = 'One customer message from the support inbox, plus the company name.';
const OUTPUT_DESCRIPTION = 'One routing decision the support team can act on without reading the thread again.';
const TRIAGE_WORKFLOW = `flowchart LR
  message[Customer message] --> classify{Category}
  classify -->|billing| billing[Billing team]
  classify -->|access| access[Account recovery]
  classify -->|bug| bug[Bug ticket]
  classify -->|question| question[Help article]
  billing & access & bug & question --> decision[JSON routing decision]`;
const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'urgency', 'next_step'],
  properties: {
    category: { type: 'string', enum: ['billing', 'access', 'bug', 'question'] },
    urgency: { type: 'string', enum: ['high', 'normal', 'low'] },
    next_step: { type: 'string', minLength: 1 },
  },
};
const INVALID_SAMPLE = '{"category": "billing", "next_step": "Refund the duplicate charge."}';
const VALID_SAMPLE =
  '{"category": "billing", "urgency": "high", "next_step": "Ask the billing team to compare the two charges."}';

const VARIABLES = [
  {
    name: 'company_name',
    purpose: 'The company whose support inbox this is.',
    sample: 'Northwind',
    required: true,
    lifecycle: 'runtime',
    encoding: 'xml-text',
    presentation: 'placeholder',
  },
  {
    name: 'customer_message',
    purpose: 'One message from the support inbox.',
    sample: 'I was charged twice for my November invoice.',
    required: true,
    lifecycle: 'runtime',
    encoding: 'xml-text',
    presentation: 'placeholder',
  },
];
const URGENCY_LINE = '- low: a question or a suggestion';
const URGENT_LINE = '- urgent: the customer reports a security problem or exposed data';
const TESTS = [
  { name: 'Double charge', message: 'I was charged twice for my November invoice.', mustInclude: '"billing"' },
  { name: 'Locked account', message: 'I am locked out after resetting my password.', mustInclude: '"access"' },
  {
    name: 'Account takeover',
    message: 'Someone else used my account to sign in and changed my email.',
    mustInclude: '"urgent"',
  },
];
const RUBRIC = 'Prefer the answer that routes the message correctly, flags security reports, and keeps the JSON.';
const AI_CRITERION = 'next_step names one concrete action the support team can take today.';

const scratch = mkdtempSync(path.join(tmpdir(), 'prompt-studio-shots-'));
const home = path.join(scratch, 'home');
const raw = path.join(scratch, 'raw');
const projectDir = path.join(home, 'support-prompts');
mkdirSync(raw, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

function prepareProject(): void {
  cpSync(path.join(REPO_ROOT, 'examples/starter'), projectDir, { recursive: true });
  rmSync(path.join(projectDir, 'studio.manifest.json'), { force: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Prompt Studio', '-c', 'user.email=demo@example.com', ...args], {
      cwd: projectDir,
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-05T09:00:00Z', GIT_COMMITTER_DATE: '2026-01-05T09:00:00Z' },
    });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Starter prompts');
}

async function startServer(): Promise<ChildProcess> {
  const child = spawn('bun', ['server/main.ts'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      HOME: home,
      STUDIO_HOST: '127.0.0.1',
      STUDIO_PORT: PORT,
      STUDIO_REPO_ROOT: home,
      STUDIO_ALLOWED_ORIGINS: `${BASE},http://localhost:${PORT}`,
    },
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      await fetch(`${BASE}/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return child;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill('SIGTERM');
  throw new Error(`Prompt Studio did not start on ${BASE}.`);
}

/** Viewport capture at 2x, downscaled to 1600 px wide with Lanczos so text stays crisp. */
async function shot(page: Page, name: string): Promise<void> {
  if (ONLY && !ONLY.includes(name)) return;
  await page.mouse.move(1599, 999);
  await page.waitForTimeout(400);
  const source = path.join(raw, `${name}.png`);
  await page.screenshot({ path: source, animations: 'disabled', caret: 'hide' });
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    source,
    '-vf',
    'scale=1600:-1:flags=lanczos',
    '-compression_level',
    '9',
    '-pred',
    'mixed',
    path.join(OUT_DIR, `${name}.png`),
  ]);
  console.log(`wrote ${path.relative(REPO_ROOT, path.join(OUT_DIR, `${name}.png`))}`);
}

prepareProject();
const model = await startTutorialModel();
const server = await startServer();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => localStorage.setItem('prompt-studio:shortcut-tips:v1', 'false'));
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await run(page);
} finally {
  await browser.close();
  server.kill('SIGTERM');
  model.close();
  rmSync(scratch, { recursive: true, force: true });
}

async function run(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Repository URL or filesystem path' }).fill(projectDir);
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByTestId('prompt-root-support-triage').click();
  await connectModel(page);
  await closeRunWorkspace(page);
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await designContract(page);
  await verifyChecks(page);
  await verifyFindings(page);
  await graphChecks(page);
  await repairSource(page);
  await aiReview(page);
  await evaluationsCompare(page);
  await graphDark(page);
}

/** The whole prompt as a graph in the dark theme, after the version 2 edit. */
async function graphDark(page: Page): Promise<void> {
  await closeRunWorkspace(page);
  await page.getByTestId('theme-toggle').click();
  await page.getByRole('button', { name: 'Toggle prompt explorer' }).click();
  await page.locator('.react-flow__node[data-id="section:urgency"]').click({ position: { x: 40, y: 12 } });
  await page.getByRole('button', { name: /fit view/i }).click();
  await page.waitForTimeout(500);
  await shot(page, 'graph-dark');
}

/** Design: a strict JSON output contract, a routing workflow, and samples checked against the schema. */
async function designContract(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Prompt design' });
  // Declare the prompt's two runtime variables in the versioned design (Advanced JSON editor).
  const advanced = panel.locator('details', { hasText: 'Advanced: complete versioned design' });
  await advanced.locator('summary').click();
  const designJson = panel.getByLabel('Prompt design JSON', { exact: true });
  const design = JSON.parse(await designJson.inputValue());
  design.variables = [...design.variables, ...VARIABLES];
  await designJson.fill(JSON.stringify(design, null, 2));
  await advanced.locator('summary').click();
  await panel.getByLabel('Input description', { exact: true }).fill(INPUT_DESCRIPTION);

  await panel.getByRole('button', { name: 'Choose pattern', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a workflow pattern' });
  await picker.getByRole('tab', { name: 'Routing', exact: true }).click();
  await expect(picker.getByRole('region', { name: 'Routing graph preview' }).getByRole('img')).toBeVisible();
  await shot(page, 'workflow-patterns');
  await picker.getByRole('button', { name: 'Use pattern', exact: true }).click();
  await expect(picker).toBeHidden();
  await panel.getByLabel('Major workflow Mermaid', { exact: true }).fill(TRIAGE_WORKFLOW);
  await expect(panel.getByRole('region', { name: 'Workflow preview' }).getByText('Billing team')).toBeVisible();

  await panel.getByLabel('Output', { exact: true }).selectOption('json');
  await panel.getByLabel('Output description', { exact: true }).fill(OUTPUT_DESCRIPTION);
  const schema = panel.getByLabel('Output JSON schema', { exact: true });
  await schema.fill(JSON.stringify(TRIAGE_SCHEMA, null, 2));
  await schema.blur();

  const sample = panel.getByLabel('JSON sample to verify', { exact: true });
  const status = panel.getByRole('status');
  await sample.fill(INVALID_SAMPLE);
  await panel.getByRole('button', { name: 'Verify sample', exact: true }).click();
  await expect(status).toContainText('urgency');
  await schema.evaluate((node) => node.scrollTo(0, 0));
  await panel.getByRole('region', { name: 'Expected output', exact: true }).evaluate((node) => node.scrollIntoView());
  await shot(page, 'design-validation');

  await sample.fill(VALID_SAMPLE);
  await panel.getByRole('button', { name: 'Verify sample', exact: true }).click();
  await panel.getByRole('button', { name: 'Use verified sample as example', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Readiness' })).toContainText('Structurally ready');
  await panel.getByRole('button', { name: 'Verify sample', exact: true }).click();
  await expect(status).toHaveText('Sample matches the JSON schema.');
  await panel.getByLabel('Major workflow Mermaid', { exact: true }).evaluate((node) => node.scrollTo(0, 0));
  await panel.getByRole('region', { name: 'Workflow', exact: true }).evaluate((node) => node.scrollIntoView());
  await shot(page, 'design-contract');

  await panel.getByRole('button', { name: 'Save prompt design', exact: true }).click();
  await expect(status).toHaveText('Prompt design saved and ready.');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
}

/** Verify → Checks & criteria: suggested automatic checks plus one authored AI criterion, saved. */
async function verifyChecks(page: Page): Promise<void> {
  await page.locator('button[aria-keyshortcuts="Alt+V"]').click();
  const verify = page.getByRole('complementary', { name: 'Verify', exact: true });
  await verify.getByRole('tab', { name: 'Checks & criteria' }).click();
  const harness = verify.getByRole('region', { name: 'Build a verification harness' });
  for (const preset of [
    /^Keep \{\{customer_message\}\}/,
    /^Known variables only/,
    /^Validate JSON contract examples/,
  ]) {
    const suggestions = harness.locator('details');
    if ((await suggestions.getAttribute('open')) === null) await suggestions.locator('summary').click();
    await harness.getByRole('button', { name: preset }).click();
    await expect(harness.getByRole('button', { name: preset })).toHaveCount(0);
    await expect(verify.getByRole('button', { name: 'Add automatic check' })).toBeEnabled();
  }
  await verify.getByRole('button', { name: 'Add AI criterion' }).click();
  await verify
    .getByRole('textbox', { name: /AI criterion/ })
    .last()
    .fill(AI_CRITERION);
  await verify.getByRole('button', { name: 'Save checks and recheck' }).click();
  await expect(verify.getByText('Checks saved and rechecked')).toBeVisible();
  await verify.getByRole('region', { name: 'AI review criteria' }).evaluate((node) => node.scrollIntoView());
  await shot(page, 'verify-checks');
}

/** Verify → Findings: a misspelled placeholder is reported and attributed to its section. */
async function verifyFindings(page: Page): Promise<void> {
  const verify = page.getByRole('complementary', { name: 'Verify', exact: true });
  const source = verify.getByRole('textbox', { name: 'Verification prompt source' });
  const text = await source.inputValue();
  await source.fill(text.replace('{{customer_message}}', '{{customer_mesage}}'));
  await verify.getByRole('button', { name: 'Save and recheck', exact: true }).click();
  await verify.getByRole('tab', { name: /^Findings/ }).click();
  await expect(verify.getByRole('region', { name: 'Verification summary' })).toContainText('1 error');
  await verify
    .getByTestId('automatic-finding')
    .filter({ hasText: '{{customer_mesage}} is not a variable' })
    .getByRole('button', { name: 'View source' })
    .click();
  await expect(source).toBeFocused();
  await verify.getByText('Automatic findings · Whole prompt').evaluate((node) => node.scrollIntoView());
  await shot(page, 'verify-findings');
  await verify.getByRole('button', { name: 'Close', exact: true }).click();
}

/** Graph: per-section check coverage, the finding pinned to its section, and the inspector. */
async function graphChecks(page: Page): Promise<void> {
  const node = page.locator('.react-flow__node[data-id="section:customer-message"]');
  await node.click({ position: { x: 40, y: 12 } });
  await expect(page.getByTestId('prompt-studio-inspector')).toContainText('Customer Message');
  // Canvas buttons (coverage badges) show from 100% zoom. Zoom in with the canvas controls (fixed steps from the
  // fitted view), then pan by the exact distance that puts the selected section at the same place every run.
  const canvas = page.getByTestId('prompt-graph-canvas');
  await canvas.getByRole('button', { name: /fit view/i }).click();
  await page.waitForTimeout(400);
  for (let step = 0; step < 4; step += 1) {
    await canvas.getByRole('button', { name: /zoom in/i }).click();
    await page.waitForTimeout(400);
  }
  await expect(canvas).not.toHaveAttribute('data-zoomed-out');
  await expect(node.getByRole('button', { name: /^Automatic checks for Customer Message/ })).toBeVisible();
  const box = await node.boundingBox();
  if (!box) throw new Error('The Customer Message section is not on the canvas.');
  await page.mouse.move(1100, 900);
  await page.mouse.down();
  await page.mouse.move(1100 - Math.round(box.x - 540), 900 - Math.round(box.y - 175), { steps: 8 });
  await page.mouse.up();
  await shot(page, 'graph-checks');
}

/** Fix the placeholder in the Verify source editor so the later steps run on a clean prompt. */
async function repairSource(page: Page): Promise<void> {
  await page.locator('button[aria-keyshortcuts="Alt+V"]').click();
  const verify = page.getByRole('complementary', { name: 'Verify', exact: true });
  const source = verify.getByRole('textbox', { name: 'Verification prompt source' });
  await source.fill((await source.inputValue()).replace('{{customer_mesage}}', '{{customer_message}}'));
  await verify.getByRole('button', { name: 'Save and recheck', exact: true }).click();
  await expect(verify.getByRole('region', { name: 'Verification summary' })).toContainText('0 errors');
}

/** Verify → AI review: the local model returns one finding linked to the authored criterion. */
async function aiReview(page: Page): Promise<void> {
  const verify = page.getByRole('complementary', { name: 'Verify', exact: true });
  await verify.getByRole('tab', { name: 'AI review', exact: true }).click();
  await verify.getByRole('button', { name: 'Run AI review', exact: true }).click();
  const finding = verify.getByTestId('semantic-finding');
  await expect(finding).toContainText('next_step');
  await shot(page, 'ai-review');
  await verify.getByRole('button', { name: 'Close', exact: true }).click();
}

/** Evaluations → Compare: two Git-tagged versions on one saved suite, with an LLM judge. */
async function evaluationsCompare(page: Page): Promise<void> {
  await page.locator('button[aria-keyshortcuts="Alt+4"]').click();
  const workspace = page.locator('[data-studio-panels]');
  await workspace.getByRole('button', { name: 'Open evaluations', exact: true }).click();
  await workspace.getByRole('tab', { name: 'Test suites', exact: true }).click();
  const suites = workspace.getByRole('tabpanel', { name: 'Test suites', exact: true });
  await suites.getByRole('button', { name: 'New suite', exact: true }).click();
  await suites.getByRole('textbox', { name: 'Suite name', exact: true }).fill('Triage regression');
  for (const [index, test] of TESTS.entries()) {
    if (index > 0) await suites.getByRole('button', { name: 'Add test', exact: true }).click();
    await suites.getByRole('textbox', { name: 'Test name', exact: true }).last().fill(test.name);
    await suites.getByRole('textbox', { name: 'company_name', exact: true }).last().fill('Northwind');
    await suites.getByRole('textbox', { name: 'customer_message', exact: true }).last().fill(test.message);
    await suites
      .getByRole('textbox', { name: /^Must include/ })
      .last()
      .fill(test.mustInclude);
  }
  await suites.getByRole('button', { name: 'Save suite', exact: true }).click();
  await expect(suites.getByRole('button', { name: 'Run test suite', exact: true })).toBeEnabled();
  await tag(page, 'triage-v1');
  await closeRunWorkspace(page);

  // Version 2: an urgent level for security reports.
  await page.locator('button[aria-keyshortcuts="Alt+V"]').click();
  const verify = page.getByRole('complementary', { name: 'Verify', exact: true });
  const source = verify.getByRole('textbox', { name: 'Verification prompt source' });
  await source.fill((await source.inputValue()).replace(URGENCY_LINE, `${URGENCY_LINE}\n${URGENT_LINE}`));
  await verify.getByRole('button', { name: 'Save and recheck', exact: true }).click();
  await expect(verify.getByRole('region', { name: 'Verification summary' })).toContainText('0 errors');
  await verify.getByRole('button', { name: 'Close', exact: true }).click();

  await page.locator('button[aria-keyshortcuts="Alt+4"]').click();
  await workspace.getByRole('button', { name: 'Open evaluations', exact: true }).click();
  await tag(page, 'triage-v2');
  const compare = workspace.getByRole('tabpanel', { name: 'Compare', exact: true });
  await compare.getByRole('combobox', { name: 'A · Baseline', exact: true }).selectOption('tag:triage-v1');
  await compare.getByRole('combobox', { name: 'B · Candidate', exact: true }).selectOption('tag:triage-v2');
  await compare.getByRole('checkbox', { name: 'Judge both answers' }).check();
  await compare.getByLabel('Judge model', { exact: true }).fill('local-test-model');
  await compare.getByLabel('Judging rubric', { exact: true }).fill(RUBRIC);
  await compare.getByRole('button', { name: 'Run comparison', exact: true }).click();
  await expect(compare.getByText(/^completed · 6\/6 outputs/)).toBeVisible({ timeout: 60_000 });
  await workspace.getByRole('button', { name: 'Expand evaluations', exact: true }).click();
  await compare.getByRole('button', { name: 'Needs attention (1)', exact: true }).click();
  await expect(compare.getByRole('region', { name: 'Results for Account takeover', exact: true })).toBeVisible();
  await compare.getByRole('region', { name: 'Evaluation summary' }).evaluate((node) => node.scrollIntoView());
  await shot(page, 'evaluations-compare');
}

async function tag(page: Page, name: string): Promise<void> {
  const workspace = page.locator('[data-studio-panels]');
  await workspace.getByRole('tab', { name: 'Compare', exact: true }).click();
  const compare = workspace.getByRole('tabpanel', { name: 'Compare', exact: true });
  const disclosure = compare.getByText('Save a Git version tag', { exact: true });
  if (!(await compare.getByLabel('New Git tag', { exact: true }).isVisible())) await disclosure.click();
  await compare.getByLabel('New Git tag', { exact: true }).fill(name);
  await compare.getByRole('button', { name: 'Create Git tag', exact: true }).click();
  await expect(compare.getByText(`Git tag “${name}” created`, { exact: false })).toBeVisible();
}

async function connectModel(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Graph', exact: true })).toBeVisible();
  await page.locator('button[aria-keyshortcuts="Alt+4"]').click();
  const workspace = page.locator('[data-studio-panels]');
  await workspace.getByRole('tab', { name: 'Settings', exact: true }).click();
  await workspace.getByRole('button', { name: 'Open app settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'App settings', exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai-compat');
  await settings.getByLabel('Model', { exact: true }).fill('local-test-model');
  await settings.getByLabel(/^API base URL/).fill(model.url);
  await settings.getByLabel(/^API key/).fill('local-test-key');
  await settings.getByRole('button', { name: /^Save settings/ }).click();
  await expect(settings.getByLabel(/^API key/)).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
}

async function closeRunWorkspace(page: Page): Promise<void> {
  const workspace = page.locator('[data-studio-panels]');
  await page.getByRole('button', { name: /^Close (run workspace|evaluations)$/ }).click();
  await expect(workspace).toBeHidden();
}
