import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

/**
 * The control channel's END-TO-END contract (ADR-236; tasks #18/#19): the real CLI binary, the
 * real dev server, a real browser tab. `ps` is an RPC formatter over POST /__control/command —
 * this proves the whole chain: CLI → server relay → SSE → the tab's command handlers → response
 * → CLI output, and that a CLI edit lands in the editor the user is looking at (the dirty chip).
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

test('the CLI reads the editor through the control channel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('project-picker-trigger')).toBeVisible({ timeout: 30_000 });

  const docs = await ps('docs');
  expect(docs).toContain('support-triage');

  const read = await ps('read', 'support-triage');
  expect(read).toContain('You are the support triage assistant'); // the starter prompt, round-tripped through the tab
});

test('the CLI writes through the editor — the open tab shows the change', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('project-picker-trigger')).toBeVisible({ timeout: 30_000 });

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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
