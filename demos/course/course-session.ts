import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { createArgoHumanCursor } from '../argo-human-cursor';
import { mountAgentPanel, PANEL_WIDTH } from '../helpers/agent-panel';
import { startCourseModel } from '../helpers/course-model';
import { startDemoOrders } from '../helpers/demo-orders-mcp';
import { connectAgent } from '../helpers/mcp-agent';

/**
 * Shared setup for the zero-to-hero course recordings (`demos/course/README.md`). Each episode records against a
 * fresh server (`bun run demo:take -- <demo>`), opens a Git copy of `examples/order-status-start` that lives in the
 * take's temporary profile folder (`DEMO_HOME`), and prepares its starting state off camera before
 * `narration.startRecording`.
 */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
export const ROOT_ID = 'order-status';
export const MODEL_NAME = 'local-test-model';

export interface Narration {
  mark(scene: string): void;
  durationFor(scene: string): number;
  startRecording(page: Page): Promise<void>;
}

/** Copies the empty starting project into the take's profile folder and makes it a Git repository. */
export function prepareProject(): { dir: string; cleanup: () => void } {
  const home = process.env.DEMO_HOME ?? mkdtempSync(path.join(tmpdir(), 'prompt-studio-course-'));
  const dir = path.join(home, 'order-status');
  rmSync(dir, { recursive: true, force: true });
  cpSync(path.join(REPO_ROOT, 'examples/order-status-start'), dir, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Prompt Studio', '-c', 'user.email=demo@example.com', ...args], { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Empty project');
  return {
    dir,
    cleanup: () => {
      if (!process.env.DEMO_KEEP_PROJECT) rmSync(process.env.DEMO_HOME ? dir : home, { recursive: true, force: true });
    },
  };
}

/** Starts the local model, the "Demo orders" MCP service and the project, and opens the welcome screen. */
export async function setUpEpisode(page: Page) {
  page.setDefaultTimeout(20_000);
  const project = prepareProject();
  const model = await startCourseModel();
  const orders = await startDemoOrders();
  // Off camera: no one-time shortcut tips over the controls being explained.
  await page.addInitScript(() => localStorage.setItem('prompt-studio:shortcut-tips:v1', 'false'));
  await page.goto('/');
  await expect(pathField(page)).toBeVisible();
  const close = async () => {
    model.close();
    await orders.close();
    project.cleanup();
  };
  return { project, model, orders, close };
}

/** A section node in Graph, by its title. */
export const graphNode = (page: Page, title: string) =>
  page
    .locator('.react-flow__node')
    .filter({ hasText: new RegExp(`^\\s*(\\d+\\s*)?${title}`) })
    .first();

export const pathField = (page: Page) => page.getByRole('textbox', { name: 'Repository URL or filesystem path' });

/** Opens the project from the welcome screen (fast; off camera). */
export async function openProjectQuickly(page: Page, dir: string): Promise<void> {
  await pathField(page).fill(dir);
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(page.getByRole('status').getByText('order-status', { exact: true })).toBeVisible();
}

/** The agent panel, the real MCP client, the cursor and the scene clock, once the starting state is ready. */
export async function startCamera(page: Page, narration: Narration, seed: string) {
  await mountAgentPanel(page, 'AI agent · MCP client');
  // Dialogs are portalled to <body> and centred on the whole viewport; centre them on the app area instead, so the
  // agent panel never covers their left edge.
  await page.addStyleTag({
    content: `[data-slot="dialog-content"][class*="sm:left-[50%]"] { left: calc(50% + ${PANEL_WIDTH / 2}px) !important; }
      [data-slot="dialog-content"]:not([class*="sm:left-[50%]"]) { left: ${PANEL_WIDTH}px !important; }`,
  });
  await narration.startRecording(page);
  const cursor = await createArgoHumanCursor(page, { seed, accent: '#0f766e', size: 36, start: { x: 0.7, y: 0.3 } });
  /** Waits until the scene's narration has played (no-op when the scene already ran long). */
  const hold = (scene: string) => page.waitForTimeout(narration.durationFor(scene));
  return { cursor, hold };
}

export type Cursor = Awaited<ReturnType<typeof createArgoHumanCursor>>;
export type Agent = Awaited<ReturnType<typeof connectAgent>>;

/** Types into a field on camera: a cursor click, then visible typing. */
export async function typeInto(cursor: Cursor, field: Locator, value: string, delay = 14): Promise<void> {
  await field.scrollIntoViewIfNeeded();
  await cursor.click(field);
  // Type over the current value (select all) instead of clearing it first: some fields reject an empty value.
  await field.press('ControlOrMeta+a');
  await field.pressSequentially(value, { delay });
}

/** Pastes a long value on camera: a cursor click, then the whole value at once (like Ctrl+V). */
export async function pasteInto(cursor: Cursor, field: Locator, value: string): Promise<void> {
  await field.scrollIntoViewIfNeeded();
  await cursor.click(field);
  await field.fill(value);
  // Leave the field, as a person does after pasting, so fields that validate on blur commit the value.
  await field.blur();
}

export { connectAgent };
