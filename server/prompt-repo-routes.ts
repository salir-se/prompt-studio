import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type } from 'arktype';
import type http from 'isomorphic-git/http/web';
import { STUDIO_TOKEN_HEADER, validateOrigin, validateToken } from '../src/bridge/fs-bridge';
import type { ResolvedManifest } from '../src/manifest/resolve-manifest';
import { MemoryRepository, RepositoryStore } from '../src/prompt-repo/memory-repository';
import {
  editProjectFiles,
  ProjectFileConflict,
  projectFileIndex,
  readProjectFile,
} from '../src/prompt-repo/project-files';
import { publishGithubProject } from './github-publish';
import { createProjectTag, parseProjectTag } from './project-tags';

export interface PromptRepoRuntime {
  repoRoot: string;
  resolvedManifest: ResolvedManifest;
  checkout: string | null;
  repoName: string | null;
  repository?: MemoryRepository;
  initialize?: () => Promise<void>;
}
export function defaultPromptRepoDir(): string {
  return path.join(homedir(), 'Salir Prompt Studio', 'repositories');
}
const identity = { 'projectId?': 'string', 'revision?': 'number.integer >= 0' } as const;
const documentBody = type({ '+': 'reject', path: 'string', text: 'string' });
const openBody = type({ '+': 'reject', 'url?': 'string', 'path?': 'string', 'token?': 'string', 'branch?': 'string' });
const saveBody = type({
  '+': 'reject',
  ...identity,
  'message?': 'string',
  'documents?': documentBody.array(),
  'definitions?': 'unknown',
  'files?': type({ '+': 'reject', path: 'string', text: 'string', expectedHash: 'string' }).array(),
  'mutationId?': type('string').narrow((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value)),
});
const restoreBody = type({ '+': 'reject', ...identity, path: 'string', commit: 'string' });
const publishBody = type({
  '+': 'reject',
  projectId: 'string',
  revision: 'number.integer >= 0',
  'url?': 'string',
  branch: 'string',
  title: 'string',
  'body?': 'string',
});
const nameBody = type({ '+': 'reject', name: 'string > 0' });
const resumeBody = type({ '+': 'reject', projectId: 'string' });
function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 48 * 1024 * 1024) throw new Error('Project upload is too large.');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
class StaleProject extends Error {}
export function createPromptRepoHandler(options: {
  runtime: PromptRepoRuntime;
  workspaceDir: string;
  studioToken: string;
  allowedOrigins: readonly string[];
  getToken?: () => string | undefined;
  fetch?: typeof fetch;
  http?: typeof http;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { runtime, studioToken, allowedOrigins } = options;
  const store = new RepositoryStore(options.workspaceDir);
  let ready: Promise<void> | undefined;
  let queue = Promise.resolve();
  let compatibilityToken: string | undefined;
  function syncRuntime() {
    runtime.repository = store.active;
    if (store.active) {
      runtime.repoName = store.active.name;
      runtime.checkout = null;
    }
  }
  async function initialize() {
    await store.load();
    if (!store.active && runtime.checkout && existsSync(path.join(runtime.checkout, '.git')))
      await store.adopt(await MemoryRepository.local(runtime.checkout));
    syncRuntime();
  }
  runtime.initialize = () => {
    ready ??= initialize();
    return ready;
  };
  async function describe() {
    syncRuntime();
    return store.active
      ? { ...(await store.active.describe()), files: await projectFileIndex(store.active) }
      : { ok: true, open: false };
  }
  function checkIdentity(body: { projectId?: string; revision?: number }, required = false) {
    const repo = store.active;
    if (!repo) throw new Error('Open a prompt project first.');
    if (
      (required && (body.projectId === undefined || body.revision === undefined)) ||
      (body.projectId !== undefined && body.projectId !== repo.projectId) ||
      (body.revision !== undefined && body.revision !== repo.revision)
    )
      throw new StaleProject('This project changed. Reload its latest saved state before trying again.');
    return repo;
  }
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/__studio/prompt-repo' && !url.pathname.startsWith('/__studio/prompt-repo/')) return false;
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    if (!validateOrigin(header('origin'), allowedOrigins)) {
      sendJson(res, 403, { ok: false, error: 'Forbidden.' });
      return true;
    }
    if (!validateToken(header(STUDIO_TOKEN_HEADER), studioToken)) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
      return true;
    }
    const run = async () => {
      try {
        ready ??= initialize();
        await ready;
        const operation = url.pathname.slice('/__studio/prompt-repo'.length);
        if (req.method === 'GET') {
          if (operation === '') {
            sendJson(res, 200, await describe());
            return;
          }
          if (operation === '/recent') {
            sendJson(res, 200, {
              ok: true,
              projects: [...store.projects.values()].map((repo) => ({
                projectId: repo.projectId,
                name: repo.name,
                branch: repo.branch,
                remote: repo.remote,
              })),
            });
            return;
          }
          if (['/export', '/history', '/file'].includes(operation)) {
            const projectId = url.searchParams.get('projectId');
            const revision = url.searchParams.get('revision');
            if (!projectId || revision === null || !/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision)))
              throw new Error('Supply the project and saved revision.');
            const requested = checkIdentity({ projectId, revision: Number(revision) }, true);
            sendJson(
              res,
              200,
              operation === '/file'
                ? { ok: true, ...(await readProjectFile(requested, url.searchParams.get('path') ?? '')) }
                : operation === '/export'
                  ? { ok: true, ...(await requested.archive()) }
                  : { ok: true, versions: await requested.history(url.searchParams.get('path') ?? undefined) },
            );
            return;
          }
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
          return;
        }
        const raw = await readJson(req);
        if (operation === '/new') {
          const body = nameBody(raw);
          if (body instanceof type.errors) throw new Error('Enter a project name.');
          const repo = new MemoryRepository(body.name.trim());
          if (!repo.name) throw new Error('Enter a project name.');
          await repo.initialize();
          await store.adopt(repo);
          sendJson(res, 200, await describe());
          return;
        }
        if (operation === '/resume') {
          const body = resumeBody(raw);
          if (body instanceof type.errors) throw new Error('Choose a saved project.');
          const repo = store.projects.get(body.projectId);
          if (!repo) throw new Error('That saved project was not found.');
          await store.adopt(repo);
          sendJson(res, 200, await describe());
          return;
        }
        if (operation === '/import') {
          const repo = await MemoryRepository.importArchive(raw);
          await store.adopt(repo);
          sendJson(res, 200, await describe());
          return;
        }
        if (operation === '/open') {
          const body = openBody(raw);
          if (body instanceof type.errors || !!body.url?.trim() === !!body.path?.trim())
            throw new Error('Enter a repository filesystem path or HTTPS URL.');
          compatibilityToken = body.token;
          let repo: MemoryRepository;
          if (body.path) repo = await MemoryRepository.local(body.path, body.branch);
          else if (body.url?.startsWith('file://'))
            repo = await MemoryRepository.local(fileURLToPath(body.url), body.branch);
          else
            repo = await MemoryRepository.clone(
              body.url ?? '',
              options.getToken?.() ?? body.token,
              body.branch,
              options.http,
            );
          compatibilityToken = body.token;
          await store.adopt(repo);
          sendJson(res, 200, await describe());
          return;
        }
        if (operation === '/save' || operation === '/draft') {
          const body = saveBody(raw);
          if (body instanceof type.errors) throw new Error('Supply valid project documents.');
          const repo = checkIdentity(body, operation === '/draft').copy();
          if (body.files?.some((file) => body.documents?.some((document) => document.path === file.path)))
            throw new Error('A file can only be changed once per save.');
          if (body.files) await editProjectFiles(repo, body.files);
          if (body.documents !== undefined || body.definitions !== undefined)
            await repo.patch(body.documents ?? [], body.definitions);
          const commit = operation === '/save' ? await repo.commit(body.message ?? 'Save prompts') : undefined;
          if (body.documents === undefined && body.definitions === undefined) repo.revision++;
          if (operation === '/draft' && body.mutationId)
            repo.lastDraft = { mutationId: body.mutationId, revision: repo.revision };
          await store.adopt(repo);
          sendJson(res, 200, { ...(await describe()), ...(commit ? { commit } : {}) });
          return;
        }
        if (operation === '/tags') {
          const body = parseProjectTag(raw);
          const tagged = await createProjectTag(checkIdentity(body, true), body.name);
          await store.adopt(tagged.repository);
          sendJson(res, 200, { ...(await describe()), tag: tagged.tag, commit: tagged.commit });
          return;
        }
        if (operation === '/restore') {
          const body = restoreBody(raw);
          if (body instanceof type.errors) throw new Error('Choose a version to restore.');
          const repo = checkIdentity(body).copy();
          const restored = await repo.restore(body.path, body.commit);
          await store.adopt(repo);
          sendJson(res, 200, { ...(await describe()), ...restored });
          return;
        }
        if (operation === '/publish') {
          const body = publishBody(raw);
          if (body instanceof type.errors) throw new Error('Enter the new branch and pull request title.');
          const repository = checkIdentity(body, true);
          const token = options.getToken?.() ?? compatibilityToken;
          if (!token) throw new Error('Connect GitHub before publishing.');
          const result = await publishGithubProject({
            ...body,
            repository,
            store,
            token,
            fetch: options.fetch,
            http: options.http,
          });
          syncRuntime();
          sendJson(res, 200, result);
          return;
        }
        if (operation === '/push') throw new Error('Use Publish to create a new branch and open a pull request.');
        sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      } catch (error) {
        const token = options.getToken?.() ?? compatibilityToken;
        const detail = error instanceof Error ? error.message : 'Project operation failed.';
        sendJson(res, error instanceof StaleProject || error instanceof ProjectFileConflict ? 409 : 400, {
          ok: false,
          error: token ? detail.split(token).join('[redacted]') : detail,
        });
      }
    };
    // One mutation queue includes project switching: late saves cannot mutate a newly opened project.
    const pending = queue.then(run);
    queue = pending.catch(() => {});
    await pending;
    return true;
  };
}
