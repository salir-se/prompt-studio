import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { createHttpServer } from '../../../server/app';
import { manifestFromPromptRepoFiles } from '../../../src/prompt-repo/layout';
import { createWorkspacePrompt, workspaceFileForDesign } from '../../../src/prompt-repo/workspace-document';

// Bun owns the standalone runtime; Playwright's Node process only owns browser assertions.
const input = JSON.parse(await text(process.stdin)) as {
  directory: string;
  token: string;
  staticDir: string;
  source: string;
  longVariable: string;
  longTool: string;
  localModelRuns?: boolean;
};
const manifest = manifestFromPromptRepoFiles('UI contracts', []);
if (!manifest.ok) throw new Error('Invalid UI fixture manifest.');
const allowedOrigins: string[] = [];
const server = createHttpServer(
  {
    repoRoot: input.directory,
    staticDir: input.staticDir,
    promptRepoDir: path.join(input.directory, 'recovery'),
    host: '127.0.0.1',
    port: 0,
    allowedOrigins,
    verifyBudget: input.localModelRuns ? 3 : 1,
  },
  input.token,
  { status: 'ok', source: 'app', manifest: manifest.manifest },
);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No local UI fixture port.');
const url = `http://127.0.0.1:${address.port}`;
allowedOrigins.push(url);
const blank = createWorkspacePrompt({
  id: 'contracts',
  title: 'UI contracts',
  configuration: '',
  tool: input.longTool,
  variable: 'document',
});
const design = {
  ...blank.design,
  variables: [...blank.design.variables, { ...blank.design.variables[0], name: input.longVariable }],
};
const response = await fetch(`${url}/__studio/prompt-repo/import`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-studio-token': input.token },
  body: JSON.stringify({
    format: 'prompt-studio-project-files@1',
    name: 'UI contracts',
    files: [
      workspaceFileForDesign(design, input.source, ''),
      { path: 'skills/plain-language/SKILL.md', text: '# Plain language\n\nKeep instructions clear.\n' },
      {
        path: '.prompt-studio/project.json',
        text: JSON.stringify({
          format: 'prompt-studio-project@1',
          name: 'UI contracts',
          variables: design.variables,
          tools: [{ name: input.longTool, description: 'Verify supplied evidence.', inputSchema: {} }],
        }),
      },
    ].map((file) => ({ path: file.path, base64: Buffer.from(file.text).toString('base64') })),
  }),
});
if (!response.ok) throw new Error(`UI fixture import failed: ${await response.text()}`);
await mkdir(path.join(input.directory, 'fixture-skills', 'Clarity'), { recursive: true });
await writeFile(
  path.join(input.directory, 'fixture-skills', 'Clarity', 'SKILL.md'),
  '---\nname: Clarity\ndescription: Prefer explicit instructions.\n---\nKeep the prompt clear.\n',
);
process.once('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
console.log(`UI_CONTRACT_READY ${url}`);
