import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  isInsidePromptRepo,
  manifestFromPromptRepoFiles,
  type PromptRepoDocument,
  type PromptRepoLayout,
} from './layout';

const execFileAsync = promisify(execFile);

const GIT_IDENTITY = ['-c', 'user.name=Prompt Studio', '-c', 'user.email=studio@salir.local'] as const;

export type PromptRemote =
  | { readonly kind: 'github'; readonly owner: string; readonly repo: string; readonly cloneUrl: string }
  | { readonly kind: 'file'; readonly cloneUrl: string };

const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

/** Parses a GitHub repository address, or a file URL used by tests. */
export function parsePromptRemote(input: string): PromptRemote | { readonly error: string } {
  const trimmed = input.trim();
  if (trimmed.startsWith('file://')) {
    let pathname: string;
    try {
      const url = new URL(trimmed);
      if (url.host !== '') return { error: 'Open a GitHub repository, or a local checkout.' };
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return { error: 'That repository address is not one Prompt Studio can open.' };
    }
    if (!path.isAbsolute(pathname)) return { error: 'That repository address is not one Prompt Studio can open.' };
    return { kind: 'file', cloneUrl: trimmed };
  }

  const https = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/.exec(trimmed);
  const ssh = /^git@github\.com:([^/]+)\/([^/#?]+?)(?:\.git)?$/.exec(trimmed);
  const slug = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  const match = https ?? ssh ?? slug;
  if (!match) return { error: 'Enter a GitHub repository, such as your-team/prompts.' };
  const owner = match[1] ?? '';
  const repo = match[2] ?? '';
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
    return { error: 'Enter a GitHub repository, such as your-team/prompts.' };
  }
  if (owner.toLowerCase() === 'salir-se' && repo.toLowerCase() === 'salir') {
    return { error: 'That repository is the Salir product. Open your own prompt repository.' };
  }
  return { kind: 'github', owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length === 0) return text;
  return text.split(secret).join('[redacted]');
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

async function runGit(args: readonly string[], cwd: string | undefined, token?: string): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: bearer ${token}`;
  }
  try {
    const { stdout, stderr } = await execFileAsync('git', [...GIT_IDENTITY, '--no-pager', ...args], {
      cwd,
      env,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string };
    const stderr = redactSecret(String(failed.stderr ?? failed.message ?? 'git failed'), token);
    // eslint-disable-next-line preserve-caught-error -- stderr is redacted; the raw cause would carry the token
    throw new Error(stderr.trim() || 'git failed');
  }
}

export async function clonePromptRepository(options: {
  remote: PromptRemote;
  destination: string;
  token?: string;
}): Promise<void> {
  await mkdir(path.dirname(options.destination), { recursive: true });
  await runGit(['clone', '--quiet', options.remote.cloneUrl, options.destination], undefined, options.token);
}

export async function listTrackedPromptFiles(checkout: string): Promise<string[]> {
  const { stdout } = await runGit(['ls-files', '--', 'prompts', 'skills'], checkout);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function readCheckoutLayout(checkout: string, repoName: string): Promise<PromptRepoLayout> {
  const tracked = await listTrackedPromptFiles(checkout);
  return manifestFromPromptRepoFiles(repoName, tracked);
}

export async function readDocumentText(checkout: string, relativePath: string): Promise<string> {
  if (!isInsidePromptRepo(relativePath)) throw new Error('That file is outside the prompt repository.');
  return readFile(path.join(checkout, relativePath), 'utf8');
}

export async function commitDocuments(options: {
  checkout: string;
  documents: readonly { readonly path: string; readonly text: string }[];
  message: string;
}): Promise<string> {
  if (options.documents.length === 0) throw new Error('Add a prompt before saving a version.');
  for (const document of options.documents) {
    if (!isWritablePromptPath(document.path)) throw new Error('That file is outside the prompt repository.');
    const absolute = path.join(options.checkout, document.path);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, document.text, 'utf8');
  }
  await runGit(['add', '--', ...options.documents.map((document) => document.path)], options.checkout);
  const status = await runGit(
    ['status', '--porcelain', '--', ...options.documents.map((document) => document.path)],
    options.checkout,
  );
  if (status.stdout.trim().length === 0) throw new Error('Nothing changed.');
  const message = options.message.trim().length > 0 ? options.message.trim() : 'Save prompts';
  await runGit(['commit', '-m', message], options.checkout);
  const head = await runGit(['rev-parse', 'HEAD'], options.checkout);
  return head.stdout.trim();
}

export function isWritablePromptPath(relativePath: string): boolean {
  if (!isInsidePromptRepo(relativePath)) return false;
  return /^prompts\/[^/]+\.md$/.test(relativePath) || /^skills\/[^/]+\/SKILL\.md$/.test(relativePath);
}

export interface PromptVersion {
  readonly commit: string;
  readonly message: string;
}

export async function listVersions(checkout: string, relativePath: string): Promise<readonly PromptVersion[]> {
  if (!isWritablePromptPath(relativePath)) throw new Error('That file is outside the prompt repository.');
  const { stdout } = await runGit(['log', '--format=%H%x09%s', '--', relativePath], checkout);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { commit: line.slice(0, tab), message: line.slice(tab + 1) };
    });
}

export async function restoreVersion(options: {
  checkout: string;
  relativePath: string;
  commit: string;
}): Promise<{ readonly text: string; readonly commit: string }> {
  if (!isWritablePromptPath(options.relativePath)) throw new Error('That file is outside the prompt repository.');
  if (!/^[0-9a-f]{7,64}$/i.test(options.commit)) throw new Error('That version was not found.');
  const shown = await runGit(['show', `${options.commit}:${options.relativePath}`], options.checkout);
  const text = shown.stdout;
  const commit = await commitDocuments({
    checkout: options.checkout,
    documents: [{ path: options.relativePath, text }],
    message: `Restore ${path.basename(options.relativePath)}`,
  });
  return { text, commit };
}

export async function pushBranch(checkout: string, token?: string): Promise<string> {
  await runGit(['push', '--quiet', 'origin', 'HEAD:prompt-studio'], checkout, token);
  return 'prompt-studio';
}

export async function loadOpenDocuments(
  checkout: string,
  documents: readonly PromptRepoDocument[],
): Promise<readonly { readonly id: string; readonly title: string; readonly path: string; readonly text: string }[]> {
  const loaded = [];
  for (const document of documents) {
    let text: string;
    try {
      text = await readDocumentText(checkout, document.path);
    } catch {
      text = '';
    }
    loaded.push({ id: document.id, title: document.title, path: document.path, text });
  }
  return loaded;
}
