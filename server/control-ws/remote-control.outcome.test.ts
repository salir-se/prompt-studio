// @vitest-environment node
// @module-tag integration
/**
 * Outcome test (spec AT-19; docs/remote-control.md): a person drives the open editor tab from a shell with the
 * REAL `ps` CLI process (`bun cli/main.ts`) over WebSocket, and scripts can trust its output: stdout holds
 * only the result (JSON with `--json`), diagnostics go to stderr, and the exit code says what went wrong.
 * The Studio side is the real gateway on an ephemeral port; the editor tab is a WebSocket client in the
 * browser role.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FakeBrowser, READY_STATE, type StudioFixture, startStudioFixture, TEST_TOKEN } from './test-support';

const appDir = path.resolve(import.meta.dirname, '../..');
let studio: StudioFixture;
const tabs: FakeBrowser[] = [];

interface CliRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function ps(port: number, ...args: string[]): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.PROMPT_STUDIO_CONTROL_TOKEN;
    const child = spawn('bun', ['cli/main.ts', ...args, '--port', String(port), '--token', TEST_TOKEN], {
      cwd: appDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function tab(options: Parameters<typeof FakeBrowser.connect>[1] = {}): Promise<FakeBrowser> {
  const browser = await FakeBrowser.connect(studio.url, options);
  tabs.push(browser);
  return browser;
}

/** A loopback port with nothing listening on it. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

beforeEach(async () => {
  studio = await startStudioFixture();
});

afterEach(async () => {
  for (const browser of tabs.splice(0)) await browser.close();
  await studio.close();
});

it('lists targets and runs a command with --json; stdout parses as JSON and carries nothing else', async () => {
  // Given: one ready editor tab that knows two documents
  const documents = [
    { id: 'support-triage', title: 'Support triage', loadability: 'constant' },
    { id: 'release-notes', title: 'Release notes', loadability: 'constant' },
  ];
  const browser = await tab({
    state: { ...READY_STATE, documentId: 'support-triage', view: 'write' },
    handler: (action) => (action === 'listDocuments' ? documents : null),
  });

  // When: the person lists targets and documents with --json
  const targets = await ps(studio.port, 'targets', '--json');
  const docs = await ps(studio.port, 'docs', '--json');

  // Then: both exit 0 and stdout is exactly the JSON result
  expect(targets.code).toBe(0);
  expect(JSON.parse(targets.stdout)).toEqual([
    expect.objectContaining({ browserId: browser.browserId, ready: true, documentId: 'support-triage', view: 'write' }),
  ]);
  expect(docs.code).toBe(0);
  expect(JSON.parse(docs.stdout)).toEqual(documents);
  expect(docs.stderr).toBe('');
  // And: the tab ran exactly one command for it
  expect(browser.received.map((command) => command.action)).toEqual(['listDocuments']);
});

it('edits the open document through the tab, and capabilities list the catalog', async () => {
  // Given: a tab that records edits, and a file with the new text
  let saved: unknown;
  await tab({
    handler: (action, params) => {
      saved = params;
      return { edited: (params as { rootId: string }).rootId, message: (params as { message: string }).message };
    },
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'ps-cli-outcome-'));
  try {
    const file = path.join(dir, 'new.md');
    await writeFile(file, 'NEW TEXT');
    // When: the person runs `ps edit` with a message
    const edit = await ps(studio.port, 'edit', 'support-triage', '--file', file, '-m', 'tighten rules');
    // Then: the tab received the file's text and the CLI printed the result
    expect(edit.code).toBe(0);
    expect(saved).toEqual({ rootId: 'support-triage', text: 'NEW TEXT', message: 'tighten rules' });
    expect(edit.stdout).toContain('tighten rules');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  // And: capabilities name every command
  const capabilities = await ps(studio.port, 'capabilities', '--json');
  expect(capabilities.code).toBe(0);
  expect((JSON.parse(capabilities.stdout) as Array<{ name: string }>).map((command) => command.name)).toContain(
    'editDocument',
  );
});

it('exits 4 when two tabs make the target ambiguous, and --target picks one', async () => {
  // Given: two ready tabs
  const first = await tab();
  const second = await tab();

  // When: the person runs a command without --target, as text and as --json
  const human = await ps(studio.port, 'docs');
  const json = await ps(studio.port, 'docs', '--json');

  // Then: exit 4; the text form explains on stderr with the candidates and prints nothing on stdout
  expect(human.code).toBe(4);
  expect(human.stdout).toBe('');
  expect(human.stderr).toContain('ambiguous_target');
  expect(human.stderr).toContain(`--target ${first.browserId}`);
  // And: the --json form prints the error object on stdout
  expect(json.code).toBe(4);
  expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, error: { code: 'ambiguous_target' } });

  // When: the person picks the second tab
  const targeted = await ps(studio.port, 'docs', '--json', '--target', second.browserId);
  // Then: only that tab ran it
  expect(targeted.code).toBe(0);
  expect(second.received).toHaveLength(1);
  expect(first.received).toHaveLength(0);
});

it('exits 3 when no Studio is running, keeping stdout clean', async () => {
  // Given: a port with nothing listening
  const port = await freePort();
  // When: the person runs a command, as text and as --json
  const human = await ps(port, 'docs');
  const json = await ps(port, 'docs', '--json');
  // Then: exit 3 with the diagnostic on stderr; --json prints only the error object
  expect(human.code).toBe(3);
  expect(human.stdout).toBe('');
  expect(human.stderr).toMatch(/Cannot reach the Studio/);
  expect(json.code).toBe(3);
  expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, error: { code: 'disconnected', outcome: 'none' } });
});

it('exits 4 with not_ready when no tab is open, and 2 on a usage error', async () => {
  // Given: a running Studio with no tab
  // When: a command runs, and an unknown flag is passed
  const noTab = await ps(studio.port, 'docs');
  const usage = await ps(studio.port, 'docs', '--nonsense');
  // Then: not_ready exits 4; the usage error exits 2 on stderr
  expect(noTab.code).toBe(4);
  expect(noTab.stderr).toContain('not_ready');
  expect(usage.code).toBe(2);
  expect(usage.stdout).toBe('');
});
