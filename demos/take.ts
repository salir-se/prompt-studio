/**
 * One recording take: starts a fresh standalone server (empty profile), runs `argo pipeline <demo>`, and
 * stops the server. Usage: `bun run demo:take -- getting-started` (after `bun run build`).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const demo = process.argv[2] ?? 'getting-started';
const root = path.resolve(import.meta.dirname, '..');
const server = spawn('bun', ['demos/serve.ts'], { cwd: root, stdio: 'inherit', env: process.env });
const port = process.env.STUDIO_PORT ?? '5273';
for (let attempt = 0; attempt < 50; attempt += 1) {
  const ok = await fetch(`http://127.0.0.1:${port}/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (ok) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const argo = spawn('bunx', ['argo', 'pipeline', demo], { cwd: root, stdio: 'inherit', env: process.env });
const code: number = await new Promise((resolve) => argo.on('exit', (status) => resolve(status ?? 1)));
server.kill('SIGTERM');
await new Promise((resolve) => server.on('exit', resolve));
process.exit(code);
