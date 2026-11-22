// @vitest-environment node
// @module-tag browser
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium, expect as browserExpect } from '@playwright/test';
import { expect, it } from 'vitest';
import { createHttpServer } from '../../server/app';
import { resolveConfig } from '../../server/config';
import { manifestFromPromptRepoFiles } from '../prompt-repo/layout';
import { readWorkspacePrompt } from '../prompt-repo/workspace-document';
import { textContrast } from './browser-text-contrast';
import { freePort } from './launch-test-helpers';

it('authors and structures a generic prompt, preserves cancelled navigation, and exports the saved project on desktop and mobile', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-authoring-'));
  const appRoot = path.resolve(import.meta.dirname, '../..');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const layout = manifestFromPromptRepoFiles('Document toolkit', []);
  if (!layout.ok) throw new Error('Invalid test manifest');
  const browser = await chromium.launch();
  const config = resolveConfig(
    {
      STUDIO_REPO_ROOT: root,
      STUDIO_STATIC_DIR: path.join(root, 'static'),
      STUDIO_PORT: String(port),
      STUDIO_ALLOWED_ORIGINS: origin,
    },
    appRoot,
  );
  const server = createHttpServer(
    { ...config, promptRepoDir: path.join(root, 'recovery') },
    'authoring-outcome-token',
    { status: 'ok', source: 'app', manifest: layout.manifest },
  );
  try {
    await promisify(execFile)('bun', ['run', 'build', '--outDir', path.join(root, 'static')], {
      cwd: appRoot,
    });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(origin);
    await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Document toolkit');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('button', { name: 'New prompt', exact: true }).click();
    await page.getByRole('textbox', { name: 'Prompt ID', exact: true }).fill('document-extraction');
    await page.getByRole('textbox', { name: 'Prompt title', exact: true }).fill('Document extraction');
    await page.getByText('Inputs and tools', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Variable', exact: true }).fill('source_document');
    await page.getByRole('textbox', { name: 'Variable purpose', exact: true }).fill('Document to summarize');
    await page.getByRole('textbox', { name: 'Example value', exact: true }).fill('Revenue increased 12%.');
    await page.getByRole('textbox', { name: 'Tool', exact: true }).fill('fetch_document');
    await page.getByRole('textbox', { name: 'Tool description', exact: true }).fill('Retrieve the source document');
    await page
      .getByRole('textbox', { name: 'Input JSON Schema', exact: true })
      .fill('{"type":"object","properties":{"source_id":{"type":"string"}},"required":["source_id"]}');
    await page.getByRole('button', { name: 'Create prompt', exact: true }).click();
    const writer = page.getByRole('textbox', { name: 'Prompt markdown', exact: true });
    await browserExpect(writer).toBeVisible();
    expect(await textContrast(page.getByRole('button', { name: 'Graph', exact: true }))).toBeGreaterThanOrEqual(4.5);
    const text = `${(await writer.inputValue()).replace(
      "Describe this prompt's primary responsibility.",
      'Extract exact facts from {{source_document}}. Use fetch_document when needed. Return source quotations.',
    )}\n## Output\n\n<output>\nCite each claim.\n</output>\n`;
    await writer.fill(text);
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    await browserExpect(writer).toHaveValue(text);
    await browserExpect(page.getByRole('button', { name: 'Write', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const navigationPrompts: string[] = [];
    const dismissNavigationPrompt = (dialog: import('@playwright/test').Dialog) => {
      navigationPrompts.push(dialog.message());
      void dialog.dismiss();
    };
    page.on('dialog', dismissNavigationPrompt);
    const explorer = page.getByRole('button', { name: 'Toggle prompt explorer', exact: true });
    await explorer.click();
    await explorer.click();
    await page.getByRole('treeitem', { name: 'Mission', exact: true }).click();
    await page.getByTestId('prompt-root-document-extraction').click();
    expect(navigationPrompts).toEqual([]);
    page.off('dialog', dismissNavigationPrompt);
    await browserExpect(writer).toHaveValue(text);
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await browserExpect(page.getByText('All writing changes applied', { exact: false })).toBeVisible();
    const savedPrompt = async () =>
      page.evaluate(async () => {
        const token = document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? '';
        const response = await fetch('/__studio/prompt-repo', { headers: { 'x-studio-token': token } });
        const project = await response.json();
        return project.documents.find((document: { id: string }) => document.id === 'document-extraction')
          ?.text as string;
      });
    await browserExpect.poll(savedPrompt).toContain('Extract exact facts');
    await browserExpect
      .poll(async () =>
        readWorkspacePrompt(await savedPrompt())?.design.sectionDesigns.map((section) => section.sectionId),
      )
      .toContain('document-extraction.output');
    await page.getByRole('button', { name: 'Design', exact: true }).click();
    await browserExpect(page.getByLabel('Readiness', { exact: true })).toContainText('Structurally ready');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('treeitem', { name: 'Mission', exact: true }).click();
    await page.getByRole('button', { name: 'Section actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add sub-section', exact: true }).click();
    await page.getByRole('textbox', { name: 'Section name', exact: true }).fill('evidence');
    await page.getByRole('button', { name: 'Add section', exact: true }).click();
    await browserExpect(page.getByRole('treeitem', { name: /^evidence$/i })).toBeVisible();
    await browserExpect.poll(savedPrompt).toContain('<evidence>');
    await page.reload();
    await page.getByTestId('prompt-root-document-extraction').click();
    await browserExpect(writer).toHaveValue(/<evidence>/);
    const stored = readWorkspacePrompt(await savedPrompt());
    expect(stored?.design.variables.find((entry) => entry.name === 'source_document')).toMatchObject({
      purpose: 'Document to summarize',
      sample: 'Revenue increased 12%.',
    });
    expect(stored?.design.sectionDesigns.map((section) => section.sectionId)).toContain('document-extraction.evidence');
    const definitions = await page.evaluate(async () => {
      const token = document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? '';
      return (await (await fetch('/__studio/prompt-repo', { headers: { 'x-studio-token': token } })).json())
        .definitions;
    });
    expect(definitions.tools).toContainEqual({
      name: 'fetch_document',
      description: 'Retrieve the source document',
      inputSchema: { type: 'object', properties: { source_id: { type: 'string' } }, required: ['source_id'] },
    });
    const mission = page.getByRole('treeitem', { name: 'Mission', exact: true });
    const evidence = page.getByRole('treeitem', { name: /^evidence$/i });
    await mission.click();
    await page.keyboard.press('ArrowRight');
    await browserExpect(evidence).toBeFocused();
    await page.keyboard.press('Enter');
    await browserExpect(evidence).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await browserExpect(mission).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await browserExpect(evidence).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await browserExpect(evidence).toBeVisible();
    await evidence.click();
    await page.getByRole('button', { name: 'Section actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remove section', exact: true }).click();
    await browserExpect(evidence).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await browserExpect(evidence).toBeVisible();
    await browserExpect.poll(savedPrompt).toContain('<evidence>');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const downloaded = await download;
    await downloaded.saveAs(path.join(root, 'project.json'));
    const archive = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8'));
    const file = archive.files.find((entry: { path: string }) => entry.path === 'prompts/document-extraction.md');
    expect(readWorkspacePrompt(Buffer.from(file.base64, 'base64').toString('utf8'))?.text).toContain('<evidence>');
    await page.setViewportSize({ width: 375, height: 667 });
    await browserExpect(writer).toBeVisible();
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    const graphSection = page.locator('.react-flow__node[data-id^="section:"]').first();
    const inspector = page.getByTestId('prompt-studio-inspector');
    if (!(await inspector.isVisible())) await graphSection.click();
    await browserExpect(inspector.getByRole('button', { name: 'Back to graph', exact: true })).toBeVisible();
    await inspector.getByRole('button', { name: 'Back to graph', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('[data-testid="prompt-studio-inspector"]')),
    ).toBe(true);
    expect(
      (await inspector.getByRole('button', { name: 'Edit section', exact: true }).boundingBox())?.height,
    ).toBeGreaterThanOrEqual(44);
    await inspector.getByRole('button', { name: 'Back to graph', exact: true }).click();
    await browserExpect(inspector).toHaveCount(0);
    await browserExpect(graphSection).toBeFocused();
    expect(
      await page.getByTestId('fragment-node').first().locator('button[aria-label="Edit section"]').isVisible(),
    ).toBe(false);
    await graphSection.press('Enter');
    await browserExpect(inspector).toBeVisible();
    await page.keyboard.press('Escape');
    await browserExpect(inspector).toHaveCount(0);
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    for (const width of [375, 1024]) {
      await page.setViewportSize({ width, height: 667 });
      await writer.focus();
      await page.keyboard.press('Alt+V');
      const verification = page.getByTestId('verification-drawer');
      await browserExpect(verification).toBeVisible();
      await verification.getByRole('button', { name: 'Close', exact: true }).focus();
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="verification-drawer"]'))).toBe(
        true,
      );
      await page.keyboard.press('Escape');
      await browserExpect(verification).toHaveCount(0);
      await browserExpect(writer).toBeFocused();
    }
    await page.setViewportSize({ width: 375, height: 667 });
    await browserExpect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Toggle prompt explorer', exact: true }).click();
    await browserExpect(page.getByRole('tree', { name: 'Prompt sections', exact: true })).toBeVisible();
    const explorerDialog = page.getByRole('dialog', { name: 'Prompt explorer', exact: true });
    await browserExpect(explorerDialog.getByRole('searchbox', { name: 'Find a document' })).toBeFocused();
    await page.keyboard.press('Escape');
    await browserExpect(explorerDialog).toHaveCount(0);
    await browserExpect(explorer).toBeFocused();
    await writer.fill(`${await writer.inputValue()}\nKeep provenance.`);
    await explorer.press('Control+s');
    await browserExpect.poll(savedPrompt).toContain('Keep provenance.');
    await explorer.click();
    await explorerDialog.getByRole('button', { name: 'Close explorer', exact: true }).click();
    await browserExpect(explorerDialog).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Variables', exact: true }).click();
    const variables = page.getByRole('complementary', { name: 'Project variables', exact: true });
    expect(await variables.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(1440);
    await variables.getByRole('button', { name: 'Add variable', exact: true }).click();
    await variables.getByLabel('Name', { exact: true }).fill('document_source');
    await explorer.click();
    await page.setViewportSize({ width: 375, height: 667 });
    await browserExpect(explorerDialog).toHaveCount(0);
    await browserExpect(variables.getByLabel('Name', { exact: true })).toHaveValue('document_source');
    await page.keyboard.press('Alt+e');
    await browserExpect(explorerDialog.getByRole('searchbox', { name: 'Find a document' })).toBeFocused();
    await page.keyboard.press('Escape');
    await browserExpect(explorerDialog).toHaveCount(0);
    await browserExpect(variables.getByLabel('Name', { exact: true })).toHaveValue('document_source');
    page.once('dialog', (dialog) => void dialog.accept());
    await variables.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'New prompt', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await browserExpect(dialog.getByRole('textbox', { name: 'Prompt title', exact: true })).toBeFocused();
    await browserExpect
      .poll(async () => {
        const bounds = await dialog.getByRole('button', { name: 'Create prompt', exact: true }).boundingBox();
        return bounds ? bounds.y + bounds.height : Infinity;
      })
      .toBeLessThanOrEqual(667);
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'New prompt', exact: true })).toBeFocused();
  } finally {
    await browser.close();
    if (server.listening)
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
