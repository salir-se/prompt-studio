import { type } from 'arktype';
import type { PromptRepoDocument } from './layout';
import type { ProjectDefinitions } from './project-definitions';
/**
 * Browser client for the person's prompt repository. The studio server is the
 * entrypoint; this only sends the requests the Your prompts panel makes.
 */

export interface PromptDocument {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly group?: PromptRepoDocument['group'];
  readonly text: string;
}

export interface OpenPromptRepo {
  readonly ok: boolean;
  readonly open: boolean;
  readonly name?: string;
  readonly projectId?: string;
  readonly revision?: number;
  readonly branch?: string;
  readonly remote?: string;
  readonly definitions?: ProjectDefinitions;
  readonly documents?: readonly PromptDocument[];
  readonly error?: string;
}

const TOKEN_HEADER = 'x-studio-token';

function studioToken(): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? '';
}

const sessionResponse = type({ ok: 'true', token: /^[\x21-\x7e]+$/, '+': 'reject' });
const recoveryAdvice = 'Retry saving. If it still fails, export recovered changes before reopening Studio.';

export async function studioJson<T = unknown>(
  pathname: string,
  init: { method?: string; body?: string } = {},
): Promise<T> {
  const { method = 'GET', body } = init;
  const send = () =>
    fetch(pathname, {
      method,
      body,
      headers: { 'content-type': 'application/json', [TOKEN_HEADER]: studioToken() },
    });
  let response = await send();
  const recovering = response.status === 401;
  if (recovering) {
    try {
      const refresh = await fetch('/__studio/session', {
        method: 'POST',
        mode: 'same-origin',
        cache: 'no-store',
      });
      if (!refresh.ok) throw new Error('Session unavailable.');
      const session = sessionResponse(await refresh.json());
      if (session instanceof type.errors) throw new Error('Invalid session.');
      const meta = document.querySelector('meta[name="studio-token"]');
      if (!meta) throw new Error('Session missing.');
      meta.setAttribute('content', session.token);
      response = await send();
    } catch {
      throw new Error(`Studio session recovery failed. ${recoveryAdvice}`);
    }
  }
  try {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
    return result as T;
  } catch (error) {
    if (recovering) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      throw new Error(`${message} ${recoveryAdvice}`, { cause: error });
    }
    throw error;
  }
}

export async function loadPromptRepository(): Promise<OpenPromptRepo> {
  return (await studioJson('/__studio/prompt-repo')) as OpenPromptRepo;
}

export async function openPromptRepository(url: string, token: string): Promise<OpenPromptRepo> {
  return (await studioJson('/__studio/prompt-repo/open', {
    method: 'POST',
    body: JSON.stringify({ url, ...(token.trim().length > 0 ? { token: token.trim() } : {}) }),
  })) as OpenPromptRepo;
}

export async function savePromptVersion(
  documents: readonly { readonly path: string; readonly text: string }[],
  message: string,
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  return (await studioJson('/__studio/prompt-repo/save', {
    method: 'POST',
    body: JSON.stringify({ message, documents }),
  })) as { ok: boolean; error?: string };
}

export async function listPromptVersions(
  project: Pick<WorkspaceProject, 'projectId' | 'revision'>,
  relativePath: string,
): Promise<{
  readonly ok: boolean;
  readonly versions: readonly { readonly commit: string; readonly message: string }[];
}> {
  const query = new URLSearchParams({
    projectId: project.projectId,
    revision: String(project.revision),
    path: relativePath,
  });
  return studioJson(`/__studio/prompt-repo/history?${query}`);
}

export async function restorePromptVersion(
  relativePath: string,
  commit: string,
): Promise<{ readonly ok: boolean; readonly text?: string; readonly error?: string }> {
  return (await studioJson('/__studio/prompt-repo/restore', {
    method: 'POST',
    body: JSON.stringify({ path: relativePath, commit }),
  })) as { ok: boolean; text?: string; error?: string };
}

export async function sendPromptRepository(): Promise<{ readonly ok: boolean; readonly error?: string }> {
  return (await studioJson('/__studio/prompt-repo/push', { method: 'POST' })) as { ok: boolean; error?: string };
}

export interface WorkspaceProject {
  readonly files?: readonly string[];
  readonly ok: true;
  readonly open: true;
  readonly projectId: string;
  readonly revision: number;
  readonly lastDraft?: { readonly mutationId: string; readonly revision: number };
  readonly name: string;
  readonly branch: string;
  readonly remote?: string;
  readonly documents: readonly PromptDocument[];
  readonly definitions: ProjectDefinitions;
}
export interface ProjectArchive {
  readonly format: 'prompt-studio-project-files@1';
  readonly name: string;
  readonly files: readonly { readonly path: string; readonly base64: string; readonly mode?: number }[];
}
export async function projectCommand<T = WorkspaceProject>(command: string, body: unknown): Promise<T> {
  const result = await studioJson<T & { ok?: boolean; error?: string }>(`/__studio/prompt-repo/${command}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (result.ok === false) throw new Error(result.error ?? 'The project could not be saved.');
  return result;
}
