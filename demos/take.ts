/**
 * One recording take: starts a fresh standalone server (empty profile), runs `argo pipeline <demo>`, and
 * stops the server. Usage: `bun run demo:take -- getting-started` (after `bun run build`).
 *
 * The temporary profile folder is shared with the demo as `DEMO_HOME`, so a demo can put its project there
 * (the course episodes do) instead of in your real home folder. It is removed after the take.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const demo = process.argv[2] ?? 'getting-started';
const root = path.resolve(import.meta.dirname, '..');
const home = await mkdtemp(path.join(tmpdir(), 'prompt-studio-demo-home-'));
const env = { ...process.env, DEMO_HOME: home, ARGO_DEMO: demo };
const server = spawn('bun', ['demos/serve.ts'], { cwd: root, stdio: 'inherit', env });
const port = process.env.STUDIO_PORT ?? '5273';
for (let attempt = 0; attempt < 50; attempt += 1) {
  const ok = await fetch(`http://127.0.0.1:${port}/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (ok) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const argo = spawn('bunx', ['argo', 'pipeline', demo], { cwd: root, stdio: 'inherit', env });
const code: number = await new Promise((resolve) => argo.on('exit', (status) => resolve(status ?? 1)));
server.kill('SIGTERM');
await new Promise((resolve) => server.on('exit', resolve));
await rm(home, { recursive: true, force: true });
process.exit(code);
