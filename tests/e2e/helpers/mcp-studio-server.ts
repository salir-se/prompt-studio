import path from 'node:path';
import { text } from 'node:stream/consumers';
import { createHttpServer } from '../../../server/app';
import { ControlHub } from '../../../server/control-hub';
import { createControlRoutes } from '../../../server/control-routes';
import { manifestFromPromptRepoFiles } from '../../../src/prompt-repo/layout';
import { createWorkspacePrompt, workspaceFileForDesign } from '../../../src/prompt-repo/workspace-document';

/**
 * The standalone Studio runtime for MCP outcome tests: the real HTTP server, the real `/__control/ws` gateway and a
 * project with one Studio-authored prompt (`order-status`, the course example: customer message → `lookup_order` →
 * JSON reply). Bun owns this process; Playwright's Node process owns the browser and the MCP client.
 */
const input = JSON.parse(await text(process.stdin)) as {
  directory: string;
  token: string;
  staticDir: string;
  source: string;
};
const manifest = manifestFromPromptRepoFiles('Order assistant', []);
if (!manifest.ok) throw new Error('Invalid MCP fixture manifest.');
const allowedOrigins: string[] = [];
const control = await createControlRoutes(
  new ControlHub(),
  input.token,
  async () => {},
  async () => {},
  { tokenDir: path.join(input.directory, 'no-token-file'), port: 0, allowedOrigins },
);
const server = createHttpServer(
  {
    repoRoot: input.directory,
    staticDir: input.staticDir,
    promptRepoDir: path.join(input.directory, 'recovery'),
    host: '127.0.0.1',
    port: 0,
    allowedOrigins,
    verifyBudget: 1,
  },
  input.token,
  { status: 'ok', source: 'app', manifest: manifest.manifest },
  control,
);
control.attachUpgrade(server, { rejectOtherPaths: true });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No local MCP fixture port.');
const url = `http://127.0.0.1:${address.port}`;
allowedOrigins.push(url);
const prompt = createWorkspacePrompt({
  id: 'order-status',
  title: 'Order status',
  configuration: '',
  tool: 'lookup_order',
  variable: 'customer_message',
});
const response = await fetch(`${url}/__studio/prompt-repo/import`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-studio-token': input.token },
  body: JSON.stringify({
    format: 'prompt-studio-project-files@1',
    name: 'Order assistant',
    files: [
      workspaceFileForDesign(prompt.design, input.source, ''),
      {
        path: '.prompt-studio/project.json',
        text: JSON.stringify({
          format: 'prompt-studio-project@1',
          name: 'Order assistant',
          variables: prompt.design.variables,
          tools: [
            {
              name: 'lookup_order',
              description: 'Look up an order by id.',
              inputSchema: { type: 'object', properties: { order_id: { type: 'string' } } },
            },
          ],
        }),
      },
    ].map((file) => ({ path: file.path, base64: Buffer.from(file.text).toString('base64') })),
  }),
});
if (!response.ok) throw new Error(`MCP fixture import failed: ${await response.text()}`);
process.once('SIGTERM', () => {
  void control.dispose().finally(() => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
});
console.log(`MCP_STUDIO_READY ${url}`);
