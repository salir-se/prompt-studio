/**
 * Starts the built standalone app for tutorial recording: loopback only, port 5273, and a fresh, empty
 * profile (temporary HOME) so the video opens on the real welcome screen. Run `bun run build` first.
 * `DEMO_HOME` reuses a profile folder created by the caller (`demos/take.ts`), which then also removes it.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ownHome = !process.env.DEMO_HOME;
const home = process.env.DEMO_HOME ?? (await mkdtemp(path.join(tmpdir(), 'prompt-studio-demo-home-')));
const port = process.env.STUDIO_PORT ?? '5273';
const child = spawn('bun', ['server/main.ts'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    HOME: home,
    STUDIO_HOST: '127.0.0.1',
    STUDIO_PORT: port,
    STUDIO_REPO_ROOT: home,
    STUDIO_ALLOWED_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}`,
  },
});
const stop = async () => {
  child.kill('SIGTERM');
  if (ownHome) await rm(home, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', async (code) => {
  if (ownHome) await rm(home, { recursive: true, force: true });
  process.exit(code ?? 0);
});
