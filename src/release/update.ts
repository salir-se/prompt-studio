import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

/**
 * `prompt-studio update` downloads the latest GitHub Release build for this machine and replaces this program.
 * A failed download or a checksum mismatch leaves the current file in place.
 */

export type UpdateResult = 'updated' | 'kept';

/** Public release locations. Releases are GitHub Releases of the open-source repository. */
export const RELEASES_PAGE_URL = 'https://github.com/salir-se/prompt-studio/releases/latest';
export const LATEST_JSON_URL = 'https://github.com/salir-se/prompt-studio/releases/latest/download/latest.json';
export const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/salir-se/prompt-studio/releases/download';

export interface UpdateOptions {
  readonly binaryPath: string;
  /** `latest.json` published with every release (see `./latest-json.ts`). */
  readonly latestUrl: string;
  /** Base URL of release assets; an asset lives at `<base>/v<version>/<key>`. */
  readonly downloadBaseUrl: string;
  readonly platform: string;
}

interface LatestDocument {
  readonly version?: unknown;
  readonly objects?: Record<string, { readonly key?: unknown; readonly sha256?: unknown } | undefined>;
}

const MAX_REDIRECTS = 5;

function request(urlString: string, redirects = 0): Promise<{ status: number; body: Buffer }> {
  const url = new URL(urlString);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      { method: 'GET', headers: { 'User-Agent': 'prompt-studio-updater' } },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location && redirects < MAX_REDIRECTS) {
          response.resume();
          request(new URL(location, url).toString(), redirects + 1).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const ASSET_RE = /^[A-Za-z0-9._-]+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Downloads this platform's binary named in `latest.json`, verifies its SHA-256, and replaces the installed app.
 * Any failure keeps the installed app unchanged.
 */
export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const original = await readFile(options.binaryPath);
  let latest: { status: number; body: Buffer };
  try {
    latest = await request(options.latestUrl);
  } catch {
    return 'kept';
  }
  if (latest.status !== 200) return 'kept';
  let parsed: LatestDocument;
  try {
    parsed = JSON.parse(latest.body.toString('utf8')) as LatestDocument;
  } catch {
    return 'kept';
  }
  const entry = parsed.objects?.[options.platform];
  const version = parsed.version;
  const key = entry?.key;
  const sha256 = entry?.sha256;
  if (typeof version !== 'string' || !VERSION_RE.test(version)) return 'kept';
  if (typeof key !== 'string' || !ASSET_RE.test(key)) return 'kept';
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) return 'kept';
  let file: { status: number; body: Buffer };
  try {
    file = await request(`${options.downloadBaseUrl}/v${version}/${key}`);
  } catch {
    return 'kept';
  }
  if (file.status !== 200) return 'kept';
  if (createHash('sha256').update(file.body).digest('hex') !== sha256) return 'kept';
  try {
    await replaceExecutable(options.binaryPath, file.body);
  } catch {
    return 'kept';
  }
  const replaced = await readFile(options.binaryPath);
  if (Buffer.compare(replaced, file.body) !== 0) {
    await replaceExecutable(options.binaryPath, original);
    return 'kept';
  }
  return 'updated';
}

export async function replaceExecutable(filePath: string, bytes: Uint8Array): Promise<void> {
  let mode = 0o755;
  try {
    const info = await stat(filePath);
    if ((info.mode & 0o111) !== 0) mode = info.mode & 0o777;
  } catch {
    mode = 0o755;
  }
  const nextPath = `${filePath}.next`;
  const previousPath = `${filePath}.previous`;
  await writeFile(nextPath, bytes);
  await chmod(nextPath, mode);
  let backup = previousPath;
  try {
    await rm(previousPath, { force: true });
  } catch {
    backup = `${filePath}.previous-${Date.now()}`;
  }
  let movedAside = false;
  try {
    await rename(filePath, backup);
    movedAside = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await rm(nextPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  try {
    await rename(nextPath, filePath);
  } catch (error) {
    if (movedAside) await rename(backup, filePath).catch(() => undefined);
    await rm(nextPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await rm(backup, { force: true }).catch(() => undefined);
}

export function platformForThisMachine(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64';
  if (platform === 'darwin') return 'macos-x64';
  if (platform === 'win32') return 'windows-x64';
  return 'linux-x64';
}

export const HELP_TEXT = `Prompt Studio

Download Prompt Studio from https://github.com/salir-se/prompt-studio/releases/latest.
Run prompt-studio to open your prompts.
Run prompt-studio update to stay on the latest version.

prompt-studio            open the editor
prompt-studio --help     show this help
prompt-studio update     download the latest version and replace this app
`;

/** Opens a URL in the desktop browser. A missing opener does not stop the command. */
type PageLauncher = (
  command: string,
  args: readonly string[],
  options: { readonly detached: boolean; readonly stdio: 'ignore' },
) => { on(event: string, listener: () => void): unknown; unref(): void };

export function openWebPage(
  url: string,
  platform: NodeJS.Platform = process.platform,
  launch: PageLauncher = childProcess.spawn,
): void {
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = launch(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The printed URL is the fallback when this computer has no opener.
  }
}

async function startStudioDefault(): Promise<void> {
  const server = await import('../../server/main');
  const { prepareInstalledStudio } = await import('./installed-studio');
  const prepared = await prepareInstalledStudio(process.env);
  await server.runStandaloneServer(
    process.env,
    prepared
      ? { envDefaults: { STUDIO_REPO_ROOT: prepared.repoRoot }, defaultManifestPath: prepared.manifestPath }
      : {},
  );
}

export interface StudioCliDeps {
  readonly startStudio?: () => Promise<void>;
  readonly openPage?: (url: string) => void;
}

export async function runCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  stdout: (line: string) => void,
  deps: StudioCliDeps = {},
): Promise<number> {
  const openPage = deps.openPage ?? openWebPage;
  if (argv.includes('--help') || argv.includes('help')) {
    stdout(HELP_TEXT);
    return 0;
  }
  if (argv[0] === 'update') {
    const binaryPath = env.PROMPT_STUDIO_BINARY_PATH ?? process.execPath;
    const base = path.basename(binaryPath);
    if (base !== 'prompt-studio' && base !== 'prompt-studio.exe' && !env.PROMPT_STUDIO_BINARY_PATH) {
      stdout(`Download Prompt Studio from ${RELEASES_PAGE_URL}, then run prompt-studio update.`);
      return 1;
    }
    const result = await runUpdate({
      binaryPath,
      latestUrl: env.PROMPT_STUDIO_LATEST_URL ?? LATEST_JSON_URL,
      downloadBaseUrl: env.PROMPT_STUDIO_DOWNLOAD_BASE_URL ?? RELEASE_DOWNLOAD_BASE_URL,
      platform: env.PROMPT_STUDIO_PLATFORM ?? platformForThisMachine(process.platform, process.arch),
    });
    if (result === 'updated') stdout('Prompt Studio is up to date.');
    if (result === 'kept') stdout('Prompt Studio could not download an update. The installed app was left as it is.');
    return 0;
  }
  await (deps.startStudio ?? startStudioDefault)();
  const local = `http://${env.STUDIO_HOST ?? '127.0.0.1'}:${env.STUDIO_PORT ?? '5273'}`;
  stdout(`Prompt Studio is open at ${local}`);
  openPage(local);
  return 0;
}
