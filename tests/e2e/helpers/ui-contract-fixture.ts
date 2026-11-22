import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test as base } from '@playwright/test';

const longVariable = 'source_document_with_a_deliberately_long_identifier_for_label_clearance';
const longTool = 'verify_all_source_documents_before_answering_with_a_detailed_evidence_audit';
const source = `<mission>\nUse {{document}} and {{${longVariable}}} with ${longTool}. ${'Preserve the supplied evidence and explain missing facts. '.repeat(8)}\n<constraints>\nKeep {{document}} available for every step.\n</constraints>\n</mission>\n\n<output>\n${Array.from({ length: 40 }, (_, line) => `Check evidence ${line + 1} before producing the answer.`).join('\n')}\n</output>\n`;

// Use the actual standalone runtime and built App, isolated from the user's project and keys.
const appRoot = path.resolve(import.meta.dirname, '../../..');
const test = base.extend<{ workspace: { skillsFolder: string }; localModelRuns: boolean }, { builtAssets: string }>({
  localModelRuns: [false, { option: true }],
  builtAssets: [
    async ({}, use) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'studio-ui-assets-'));
      try {
        await promisify(execFile)('bun', ['run', 'build', '--outDir', directory], {
          cwd: appRoot,
          timeout: 60_000,
        });
        await use(directory);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],
  workspace: [
    async ({ page, builtAssets, localModelRuns }, use) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'studio-ui-contracts-'));
      const server = spawn('bun', [path.join(import.meta.dirname, 'ui-contract-server.ts')], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const browserErrors: string[] = [];
      const modelRequests: string[] = [];
      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('requestfailed', (request) =>
        browserErrors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`),
      );
      let output = '';
      let errors = '';
      let initialized = false;
      server.stdout.on('data', (chunk) => {
        output += chunk;
      });
      server.stderr.on('data', (chunk) => {
        errors += chunk;
      });
      server.stdin.end(
        JSON.stringify({
          directory,
          token: randomUUID(),
          staticDir: builtAssets,
          source,
          longVariable,
          longTool,
          localModelRuns,
        }),
      );
      try {
        await expect
          .poll(
            () => {
              if (server.exitCode !== null) throw new Error(`Native UI fixture stopped: ${errors}`);
              return output.match(/UI_CONTRACT_READY (http:\/\/127\.0\.0\.1:\d+)/)?.[1] ?? '';
            },
            { timeout: 20_000 },
          )
          .toMatch(/^http:/);
        const nativeURL = output.match(/UI_CONTRACT_READY (http:\/\/127\.0\.0\.1:\d+)/)![1];
        await page.route(/\/__studio\/run(?:\/evaluations)?(?:\?.*)?$/, async (route) => {
          if (route.request().method() === 'POST' && !localModelRuns) {
            modelRequests.push(new URL(route.request().url()).pathname);
            await route.abort('blockedbyclient');
          } else await route.continue();
        });
        await page.addInitScript(() => {
          if (localStorage.getItem('prompt-studio:shortcut-tips:v1') === null)
            localStorage.setItem('prompt-studio:shortcut-tips:v1', 'false');
          if (localStorage.getItem('prompt-studio:compact-toolbars:v1') === null)
            localStorage.setItem('prompt-studio:compact-toolbars:v1', 'true');
        });
        await page.goto(nativeURL);
        await expect(page.getByTestId('prompt-root-contracts')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('prompt-root-contracts').click();
        initialized = true;
        await use({ skillsFolder: path.join(directory, 'fixture-skills') });
        expect(modelRequests, 'UI contracts must never request a paid model run').toEqual([]);
      } finally {
        if (!initialized || test.info().status !== test.info().expectedStatus) {
          const html = await page.content().catch((error) => String(error));
          console.error(
            'UI_CONTRACT_DIAGNOSTIC',
            JSON.stringify({
              browserErrors,
              nativeErrors: errors,
              html: html
                .replace(/name="studio-token" content="[^"]+"/g, 'name="studio-token" content="redacted"')
                .slice(0, 3000),
            }),
          );
          await page.screenshot({ path: test.info().outputPath('fixture-failure.png') }).catch(() => {});
        }
        if (server.exitCode === null) {
          const stopped = once(server, 'exit');
          server.kill('SIGTERM');
          await stopped;
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
    { auto: true },
  ],
});

export { expect, longTool, longVariable, source, test };
