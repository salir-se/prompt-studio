import type * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { isInsidePromptRepo } from './layout';

export const METADATA_PATH = '.prompt-studio/project.json';
export const DIR = '/repo';
export const safeHttp: git.HttpClient = {
  async request(request) {
    const response = await http.request({
      ...request,
      fetchOptions: { ...request.fetchOptions, redirect: 'error', signal: AbortSignal.timeout(120_000) },
    });
    const body = response.body;
    return {
      ...response,
      body: (async function* () {
        let bytes = 0;
        if (body)
          for await (const chunk of body) {
            bytes += chunk.byteLength;
            if (bytes > 256 * 1024 * 1024) throw new Error('Repository transfer exceeds 256 MiB.');
            yield chunk;
          }
      })(),
    };
  },
};
export const AUTHOR = { name: 'Prompt Studio', email: 'studio@salir.local' };
export const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_FILES = 10_000;
export interface ProjectArchive {
  format: 'prompt-studio-project-files@1';
  name: string;
  files: { path: string; base64: string; mode?: number }[];
}
export interface Publication {
  branch: string;
  commit: string;
  remote: string;
  base: string;
  pushed?: boolean;
  url?: string;
}
export interface RepositoryData {
  editedFiles?: string[];
  projectId: string;
  name: string;
  revision: number;
  lastDraft?: { mutationId: string; revision: number };
  branch: string;
  remote?: string;
  sourcePath?: string;
  baseCommit?: string;
  publication?: Publication;
  files: Record<string, string>;
  modes?: Record<string, number>;
}
export function writableProjectPath(file: string): boolean {
  return (
    safePath(file) &&
    (file === METADATA_PATH || /^prompts\/[^/]+\.md$/.test(file) || /^skills\/[^/]+\/SKILL\.md$/.test(file))
  );
}
export function safePath(file: string): boolean {
  return (
    isInsidePromptRepo(file) &&
    !file.includes('\\') &&
    !file.includes('\0') &&
    !file.split('/').some((part) => part.toLowerCase() === '.git')
  );
}
export function safeRemote(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Enter an HTTPS repository URL without credentials.');
  return url.href;
}
export function githubRemote(input: string): { owner: string; repo: string } {
  const url = new URL(safeRemote(input));
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
  if (url.hostname !== 'github.com' || !match) throw new Error('Pull requests require a GitHub repository URL.');
  return { owner: match[1], repo: match[2] };
}
