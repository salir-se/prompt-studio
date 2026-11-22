// @vitest-environment node
// @module-tag browser
// Installed-command authoring and recovery outcome.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Browser, chromium, expect as browserExpect, type Page } from '@playwright/test';
import * as git from 'isomorphic-git';
import { afterEach, describe, expect, it } from 'vitest';
import { type MemoryRepository, RepositoryStore } from '../prompt-repo/memory-repository';
import { readWorkspacePrompt } from '../prompt-repo/workspace-document';
import { buildStudio, execFileAsync, freePort, request, stopStudio } from './launch-test-helpers';

const APP = path.resolve(import.meta.dirname, '../..');

async function editMission(page: Page) {
  await page.getByRole('article', { name: 'Mission', exact: true }).click();
  await page.getByTestId('prompt-studio-inspector').getByRole('button', { name: 'Edit section', exact: true }).click();
}

describe('prompt-studio with no arguments', () => {
  let built: string | undefined;

  afterEach(async () => {
    if (built) await rm(built, { recursive: true, force: true });
  });

  it('creates, edits, versions and transfers a project without system Git and restores it after restarting', async () => {
    const port = await freePort();
    built = await mkdtemp(path.join(tmpdir(), 'prompt-studio-bin-'));
    const binary = path.join(built, 'prompt-studio');
    await buildStudio(APP, binary);
    const help = await execFileAsync(binary, ['--help']);
    expect(help.stdout).toContain(
      'Download Prompt Studio from https://github.com/salir-se/prompt-studio/releases/latest.',
    );
    expect(help.stdout).toContain('Run prompt-studio to open your prompts.');
    expect(help.stdout).toContain('prompt-studio update     download the latest version');
    const origin = `http://127.0.0.1:${port}`;
    const emptyPath = path.join(built, 'no-external-tools');
    await mkdir(emptyPath);
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: built,
      PATH: emptyPath,
      USERPROFILE: built,
      STUDIO_HOST: '127.0.0.1',
      STUDIO_PORT: String(port),
      STUDIO_ALLOWED_ORIGINS: `${origin},http://localhost:${port}`,
    };
    delete childEnv.STUDIO_REPO_ROOT;
    delete childEnv.STUDIO_MANIFEST_PATH;
    let child = spawn(binary, [], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    let browser: Browser | undefined;
    let browserPage: Page | undefined;
    const artifacts = path.join(APP, '.output/first-prompt');
    try {
      await mkdir(artifacts, { recursive: true });
      browser = await chromium.launch();
      browserPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const healthy = await new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(output || 'studio did not start')), 20000);
        const poll = (): void => {
          void request(port, '/health')
            .then((response) => {
              if (response.status === 200) {
                clearTimeout(timer);
                resolve(true);
                return;
              }
              setTimeout(poll, 100);
            })
            .catch(() => setTimeout(poll, 100));
        };
        poll();
      });
      const page = await request(port, '/', { Origin: origin });
      const index = await request(port, '/index.html', { Origin: origin });
      const scriptSrc = page.body.match(/src="([^"]+\.js)"/)?.[1];
      const script = scriptSrc ? await request(port, scriptSrc, { Origin: origin }) : { status: 0, body: '' };
      const token = page.body.match(/name="studio-token" content="([^"]+)"/)?.[1] ?? '';
      const manifest = await request(port, '/__studio/manifest', {
        Origin: origin,
        'x-studio-token': token,
      });
      expect(healthy).toBe(true);
      expect(output).toContain(`http://127.0.0.1:${port}`);
      expect(page.status).toBe(200);
      expect(page.body).toContain('<html');
      expect(index.status).toBe(200);
      expect(index.body).toContain('studio-token');
      expect(script.status).toBe(200);
      expect(script.body).toContain('Your prompts');
      expect(manifest.status).toBe(200);
      expect(JSON.parse(manifest.body)).toMatchObject({
        ok: true,
        manifest: { contentRoots: ['prompts', 'skills'] },
      });
      expect(output).not.toContain('packages/prompts/src/scout.ts');
      expect(output).not.toContain(`${path.sep}repo${path.sep}packages`);

      // Fresh browser: real automatic history provider.
      await browserPage.goto(origin);
      const create = browserPage.getByRole('button', { name: 'New prompt', exact: true });
      await browserExpect(create).toBeEnabled({ timeout: 15000 });
      await browserExpect(browserPage.getByText('History running in fallback mode:', { exact: false })).toHaveCount(0);
      await browserPage.getByRole('button', { name: 'Your prompts', exact: true }).click();
      await browserPage.getByLabel('Project name', { exact: true }).fill('Research workspace');
      await browserPage.getByRole('button', { name: 'Create project', exact: true }).click();
      await browserExpect(browserPage.getByRole('region', { name: 'Your prompts', exact: true })).toHaveCount(0);
      await browserExpect(create).toBeEnabled();
      await create.click();
      await browserPage.getByLabel('Prompt ID', { exact: true }).fill('account-research');
      await browserPage.getByLabel('Prompt title').fill('Account Research');
      await browserPage.getByText('Inputs and tools', { exact: true }).click();
      await browserPage.getByLabel('Tool', { exact: true }).fill('web_search');
      await browserPage.getByLabel('Variable', { exact: true }).fill('company');
      await browserPage.screenshot({ path: path.join(artifacts, 'create-light.png') });
      await browserPage.getByRole('button', { name: 'Create prompt', exact: true }).click();
      await browserExpect(browserPage.getByRole('dialog')).toHaveCount(0);
      await browserExpect(browserPage.getByTestId('prompt-root-account-research')).toBeVisible();
      const api = async (route = '') => {
        const result = await request(port, `/__studio/prompt-repo${route}`, {
          Origin: origin,
          'x-studio-token': token,
        });
        expect(result.status).toBe(200);
        return JSON.parse(result.body);
      };
      const originalId = (await api()).projectId;
      await browserPage.getByRole('button', { name: 'New prompt', exact: true }).click();
      await browserPage.getByLabel('Prompt ID', { exact: true }).fill('outreach');
      await browserPage.getByLabel('Prompt title').fill('Outreach');
      await browserPage.getByRole('button', { name: 'Create prompt', exact: true }).click();
      await browserExpect(browserPage.getByTestId('prompt-root-outreach')).toBeVisible();
      await browserPage.getByTestId('prompt-root-account-research').click();
      await browserPage.getByRole('button', { name: 'Graph', exact: true }).click();
      await editMission(browserPage);
      const markdown = browserPage.getByLabel('Mission markdown', { exact: true });
      await markdown.fill(
        `${await markdown.inputValue()}\nResearch {{company}} in {{region}} before outreach. EDITED-ON-CANVAS`,
      );
      await browserPage.getByRole('button', { name: 'Apply', exact: true }).click();
      await browserExpect(browserPage.getByTestId('fragment-edit-dialog')).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await api()).documents.find((doc: { path: string }) => doc.path === 'prompts/account-research.md')?.text,
        )
        .toContain('EDITED-ON-CANVAS');
      await browserPage.getByRole('button', { name: 'Variables', exact: true }).click();
      await browserPage.getByRole('button', { name: 'Add variable', exact: true }).click();
      await browserPage.getByLabel('Name', { exact: true }).fill('region');
      await browserPage.getByLabel('Purpose', { exact: true }).fill('Region for company research');
      await browserPage.getByLabel('Example value', { exact: true }).fill('Stockholm');
      await browserPage.getByRole('button', { name: 'Save variable', exact: true }).click();
      await browserExpect(browserPage.getByRole('status').filter({ hasText: 'Saved to this project.' })).toBeVisible();
      const variableDownloadPromise = browserPage.waitForEvent('download');
      await browserPage.getByRole('button', { name: 'Export variables', exact: true }).click();
      const variableDownload = await variableDownloadPromise;
      const variablesPath = path.join(built, 'variables.json');
      await variableDownload.saveAs(variablesPath);
      const variablesJson = JSON.parse(await readFile(variablesPath, 'utf8'));
      expect(variablesJson.variables.some((item: { name: string }) => item.name === 'region')).toBe(true);
      await browserPage.getByLabel('Upload variables JSON').setInputFiles(variablesPath);
      await browserExpect(browserPage.getByRole('region', { name: 'Import preview' })).toBeVisible();
      await browserPage.getByLabel('When a name already exists').selectOption('keep');
      await browserPage.getByRole('button', { name: 'Import into project', exact: true }).click();
      await browserExpect(browserPage.getByRole('region', { name: 'Import preview' })).toHaveCount(0);
      await browserPage.screenshot({ path: path.join(artifacts, 'variables-light.png') });
      await browserPage.getByRole('button', { name: 'Close', exact: true }).click();
      await browserPage.getByRole('button', { name: 'Tools', exact: true }).click();
      await browserPage.getByRole('button', { name: 'Add tool', exact: true }).click();
      await browserPage.getByLabel('Name', { exact: true }).fill('lookup_company');
      await browserPage.getByLabel('Description', { exact: true }).fill('Find company information');
      await browserPage
        .getByRole('textbox', { name: /Input JSON Schema/ })
        .fill('{"type":"object","properties":{"company":{"type":"string"}},"required":["company"]}');
      await browserPage.getByRole('button', { name: 'Save tool', exact: true }).click();
      await browserExpect(browserPage.getByRole('status').filter({ hasText: 'Saved to this project.' })).toBeVisible();
      const toolDownloadPromise = browserPage.waitForEvent('download');
      await browserPage.getByRole('button', { name: 'Export tools', exact: true }).click();
      const toolsPath = path.join(built, 'tools.json');
      await (await toolDownloadPromise).saveAs(toolsPath);
      await browserPage.getByLabel('Upload tools JSON').setInputFiles(toolsPath);
      await browserPage.getByLabel('When a name already exists').selectOption('keep');
      await browserPage.getByRole('button', { name: 'Import into project', exact: true }).click();
      await browserExpect(browserPage.getByRole('region', { name: 'Import preview' })).toHaveCount(0);
      await browserPage.getByRole('button', { name: 'Close', exact: true }).click();
      await browserPage.getByRole('button', { name: 'Your prompts', exact: true }).click();
      await browserPage.getByRole('tab', { name: 'Versions', exact: true }).click();
      await browserPage.getByLabel('Version message').fill('Research prompts with reusable definitions');
      await browserPage.getByRole('button', { name: 'Save version', exact: true }).click();
      await browserExpect(browserPage.getByText('Saved a version of your project.', { exact: true })).toBeVisible();
      const beforeRestart = await api();
      expect(beforeRestart.documents).toHaveLength(2);
      const committedText = beforeRestart.documents.find(
        (doc: { path: string }) => doc.path === 'prompts/account-research.md',
      ).text;
      const saved = readWorkspacePrompt(committedText);
      expect(saved?.design.tools).toEqual(['web_search']);
      expect(saved?.text).toContain('EDITED-ON-CANVAS');
      expect(beforeRestart.definitions.variables).toEqual(variablesJson.variables);
      expect(beforeRestart.definitions.tools).toEqual(JSON.parse(await readFile(toolsPath, 'utf8')).tools);
      // Recovery contains a real Git object database, not just a JSON copy of prompt text.
      const store = new RepositoryStore(path.join(built, 'Salir Prompt Studio', 'repositories'));
      await store.load();
      const recovered = store.active as MemoryRepository;
      expect(recovered.projectId).toBe(originalId);
      const versions = await recovered.history();
      expect(versions[0].message).toBe('Research prompts with reusable definitions');
      const committedBlob = await git.readBlob({
        fs: recovered.fs,
        dir: '/repo',
        oid: versions[0].commit,
        filepath: 'prompts/account-research.md',
      });
      expect(new TextDecoder().decode(committedBlob.blob)).toBe(committedText);
      const archivePromise = browserPage.waitForEvent('download');
      await browserPage.getByRole('button', { name: 'Export project', exact: true }).click();
      const archivePath = path.join(built, 'project.json');
      await (await archivePromise).saveAs(archivePath);
      const archive = JSON.parse(await readFile(archivePath, 'utf8'));
      expect(archive.format).toBe('prompt-studio-project-files@1');
      await browserPage.getByRole('button', { name: 'Close', exact: true }).click();
      await browserPage.screenshot({ path: path.join(artifacts, 'created-light.png') });
      await browserPage.emulateMedia({ colorScheme: 'dark' });
      await browserPage.evaluate(() => document.documentElement.classList.add('dark'));
      await browserPage.screenshot({ path: path.join(artifacts, 'created-dark.png') });
      await browserPage.setViewportSize({ width: 375, height: 667 });
      await browserPage.getByRole('button', { name: 'Write', exact: true }).click();
      await browserExpect(browserPage.getByRole('textbox', { name: 'Prompt markdown', exact: true })).toBeVisible();
      expect(await browserPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await browserPage.screenshot({ path: path.join(artifacts, 'narrow-dark.png') });
      await browserPage.emulateMedia({ colorScheme: 'light' });
      await browserPage.evaluate(() => document.documentElement.classList.remove('dark'));
      await browserPage.screenshot({ path: path.join(artifacts, 'narrow-light.png') });

      // Close the original context, then restart the binary with the same home.
      await browserPage.context().close();
      await stopStudio(child);
      child = spawn(binary, [], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      await expect
        .poll(
          async () =>
            request(port, '/health')
              .then((result) => result.status)
              .catch(() => 0),
          { timeout: 20000 },
        )
        .toBe(200);
      browserPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await browserPage.goto(origin);
      await browserPage.getByTestId('prompt-root-account-research').click({ timeout: 15000 });
      await browserPage.getByRole('button', { name: 'Design', exact: true }).click();
      await browserExpect(browserPage.getByLabel('Available tools')).toHaveValue('web_search');
      await browserPage.getByText('Advanced: complete versioned design', { exact: true }).click();
      const design = JSON.parse(await browserPage.getByLabel('Prompt design JSON').inputValue());
      expect(design).toEqual(saved?.design);
      await browserPage.getByRole('button', { name: 'Close', exact: true }).click();
      const restartedShell = await request(port, '/', { Origin: origin });
      const restartedToken = restartedShell.body.match(/name="studio-token" content="([^"]+)"/)?.[1] ?? '';
      const resumed = JSON.parse(
        (await request(port, '/__studio/prompt-repo', { Origin: origin, 'x-studio-token': restartedToken })).body,
      );
      expect(resumed.documents).toEqual(beforeRestart.documents);
      expect(resumed.definitions).toEqual(beforeRestart.definitions);
      await browserPage.getByRole('button', { name: 'Graph', exact: true }).click();
      await browserExpect(browserPage.getByText('History running in fallback mode:', { exact: false })).toHaveCount(0);
      await browserExpect(browserPage.getByRole('article', { name: 'Mission', exact: true })).toContainText(
        'EDITED-ON-CANVAS',
      );
      await browserPage.screenshot({ path: path.join(artifacts, 'reopened-light.png') });
      await browserPage.getByRole('button', { name: 'Your prompts', exact: true }).click();
      await browserPage.getByLabel('Import project archive (JSON)', { exact: true }).setInputFiles(archivePath);
      await browserPage.getByRole('button', { name: 'Import as new project', exact: true }).click();
      await expect
        .poll(
          async () =>
            JSON.parse(
              (await request(port, '/__studio/prompt-repo', { Origin: origin, 'x-studio-token': restartedToken })).body,
            ).projectId,
        )
        .not.toBe(originalId);
      await browserPage.getByTestId('prompt-root-account-research').click();
      await browserPage.getByRole('button', { name: 'Graph', exact: true }).click();
      await browserExpect(browserPage.getByRole('article', { name: 'Mission', exact: true })).toContainText(
        'EDITED-ON-CANVAS',
      );
      const imported = JSON.parse(
        (await request(port, '/__studio/prompt-repo', { Origin: origin, 'x-studio-token': restartedToken })).body,
      );
      expect(imported.projectId).not.toBe(originalId);
      expect(imported.documents).toEqual(beforeRestart.documents);
      expect(imported.definitions).toEqual(beforeRestart.definitions);
      await editMission(browserPage);
      const importedMarkdown = browserPage.getByLabel('Mission markdown', { exact: true });
      await importedMarkdown.fill(`${await importedMarkdown.inputValue()}\nIMPORTED-PROJECT-ONLY`);
      await browserPage.getByRole('button', { name: 'Apply', exact: true }).click();
      await browserExpect(browserPage.getByRole('article', { name: 'Mission', exact: true })).toContainText(
        'IMPORTED-PROJECT-ONLY',
      );

      await browserPage.getByRole('button', { name: 'Your prompts', exact: true }).click();
      const recentButtons = browserPage
        .getByRole('region', { name: 'Your prompts' })
        .getByRole('button')
        .filter({ hasText: originalId });
      await browserExpect(recentButtons).toHaveCount(1);
      await recentButtons.click();
      await expect
        .poll(
          async () =>
            JSON.parse(
              (await request(port, '/__studio/prompt-repo', { Origin: origin, 'x-studio-token': restartedToken })).body,
            ).projectId,
        )
        .toBe(originalId);
      await browserPage.getByTestId('prompt-root-account-research').click();
      await browserPage.getByRole('button', { name: 'Graph', exact: true }).click();
      await browserExpect(browserPage.getByRole('article', { name: 'Mission', exact: true })).toContainText(
        'EDITED-ON-CANVAS',
      );
      await browserExpect(browserPage.getByRole('article', { name: 'Mission', exact: true })).not.toContainText(
        'IMPORTED-PROJECT-ONLY',
      );
    } catch (error) {
      if (browserPage && !browserPage.isClosed()) {
        await browserPage.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => undefined);
      }
      throw error;
    } finally {
      try {
        await browser?.close();
      } finally {
        await stopStudio(child);
      }
    }
  }, 180000);
});
