import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, type Page, test } from '@playwright/test';

/**
 * The control channel's END-TO-END contract (ADR-236; docs/remote-control.md): the real CLI process, the
 * real dev server, a real browser tab. The CLI's default transport is WebSocket — this proves the whole
 * chain: CLI → `/__control/ws` gateway → the tab's WebSocket → the tab's command handlers → result → CLI
 * output, and that a CLI edit lands in the editor the user is looking at (the dirty chip).
 */
const exec = promisify(execFile);
const appDir = path.resolve(import.meta.dirname, '../..');

/** Runs the real CLI (`bun cli/main.ts …`) from the app directory, returning trimmed stdout. */
async function ps(...args: string[]): Promise<string> {
  const { stdout } = await exec('bun', ['cli/main.ts', ...args, '--port', process.env.PW_STUDIO_PORT ?? '5273'], {
    cwd: appDir,
    timeout: 30_000,
  });
  return stdout.trim();
}

interface Target {
  browserId: string;
  ready: boolean;
  documentId: string | null;
  view: string | null;
}

/** Polls `ps targets --json` until the open tab has registered over WebSocket and reports ready. */
async function readyTarget(page: Page): Promise<Target> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const targets = JSON.parse(await ps('targets', '--json')) as Target[];
    if (targets.length === 1 && targets[0]?.ready === true) return targets[0];
    await page.waitForTimeout(250);
  }
  throw new Error('The editor tab never registered as a ready WebSocket target.');
}

test('the CLI reads the editor through the control channel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('project-picker-trigger')).toBeVisible({ timeout: 30_000 });
  // The tab is a WebSocket target: exactly one, ready, listed by the gateway.
  const target = await readyTarget(page);

  const docs = await ps('docs');
  expect(docs).toContain('support-triage');

  const read = await ps('read', 'support-triage', '--target', target.browserId);
  expect(read).toContain('You are the support triage assistant'); // the starter prompt, round-tripped through the tab
});

test('the CLI writes through the editor — the open tab shows the change', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('project-picker-trigger')).toBeVisible({ timeout: 30_000 });
  await readyTarget(page);

  // `open` loads the document in the tab (the same state the sidebar click produces); the load
  // is async in the tab, so poll `read --json` until it reports the WORKING document.
  await ps('open', 'support-triage');
  let text = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const body = JSON.parse(await ps('read', 'support-triage', '--json')) as { source: string; text: string };
    if (body.source === 'working') {
      text = body.text;
      break;
    }
    await page.waitForTimeout(400);
  }
  expect(text.length).toBeGreaterThan(0); // the tab had the working document

  const dir = await mkdtemp(path.join(tmpdir(), 'ps-cli-e2e-'));
  try {
    const file = path.join(dir, 'edited.md');
    await writeFile(file, `${text}\nE2E-CONTROL-CHANNEL-MARKER`);
    const edited = await ps('edit', 'support-triage', '--file', file, '--message', 'e2e control-channel edit');
    expect(edited).toContain('e2e control-channel edit');

    // The user's tab shows it: the dirty chip appears (working text now differs from shipped).
    await expect(page.getByTestId('dirty-chip')).toBeVisible({ timeout: 15_000 });
    // And a CLI read-back round-trips the marker.
    expect(await ps('read', 'support-triage')).toContain('E2E-CONTROL-CHANNEL-MARKER');
    // And the tab reported its new state to the gateway: the open document, in the write view.
    await expect
      .poll(async () => (JSON.parse(await ps('targets', '--json')) as Target[])[0]?.documentId)
      .toBe('support-triage');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
