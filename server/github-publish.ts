import type http from 'isomorphic-git/http/web';
import {
  githubRemote,
  MemoryRepository,
  type RepositoryStore,
  writableProjectPath,
} from '../src/prompt-repo/memory-repository';
import { writableReferencePath } from '../src/prompt-repo/reference-path';

export async function publishGithubProject(options: {
  repository: MemoryRepository;
  store: RepositoryStore;
  token: string;
  branch: string;
  title: string;
  body?: string;
  url?: string;
  fetch?: typeof fetch;
  http?: typeof http;
}) {
  const { store, token, branch } = options;
  const request = options.fetch ?? fetch;
  let repository = options.repository.copy();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$/.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock') ||
    branch.split('/').some((part) => part.startsWith('.'))
  )
    throw new Error('Choose a valid new branch name.');
  if (!options.title.trim()) throw new Error('Enter a pull request title.');
  const remote = options.url ?? repository.remote;
  if (!remote) throw new Error('Enter the GitHub repository URL.');
  const { owner, repo } = githubRemote(remote);
  async function api(suffix: string, init: RequestInit = {}) {
    const response = await request(`https://api.github.com/repos/${owner}/${repo}${suffix}`, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Salir-Prompt-Studio',
        ...init.headers,
      },
    });
    if (response.status === 401 || response.status === 403)
      throw new Error('GitHub did not grant write access. Connect an account with access to this repository.');
    return response;
  }
  if (repository.remote !== remote) {
    const base = await MemoryRepository.clone(remote, token, undefined, options.http);
    const archive = await repository.archive();
    const patch = [];
    const existing = new Set(await base.allFiles());
    for (const file of archive.files) {
      if (!(writableProjectPath(file.path) || writableReferencePath(file.path))) continue;
      const text = Buffer.from(file.base64, 'base64').toString('utf8');
      if (existing.has(file.path) && (await base.read(file.path)) !== text)
        throw new Error(
          `The remote already contains different content at ${file.path}. Open that repository and resolve the conflict before publishing.`,
        );
      if (file.path !== '.prompt-studio/project.json') patch.push({ path: file.path, text });
    }
    await base.patch(patch, await repository.definitions());
    base.projectId = repository.projectId;
    base.revision = repository.revision;
    repository = base;
  }
  const baseRef = await api(`/git/ref/heads/${repository.branch.split('/').map(encodeURIComponent).join('/')}`);
  if (!baseRef.ok) throw new Error('The source branch could not be read. Reopen the repository before publishing.');
  const baseInfo = (await baseRef.json()) as { object?: { sha?: string } };
  if (branch === repository.branch) throw new Error('Choose a new branch, different from the source branch.');
  const commit = await repository.commit(options.title);
  const prior = repository.publication;
  const retry = prior?.branch === branch && prior.remote === remote && prior.commit === commit;
  if (prior?.pushed && prior.branch === branch && !retry)
    throw new Error('This published branch has newer local changes. Choose another new branch.');
  const reference = await api(`/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`);
  if (reference.ok) {
    const ref = (await reference.json()) as { object?: { sha?: string } };
    if (!retry || ref.object?.sha !== commit)
      throw new Error('That branch already exists or changed remotely. Choose a new branch.');
  } else if (reference.status !== 404) throw new Error('Could not check the remote branch. Try again.');
  if (retry && prior?.pushed && !reference.ok)
    throw new Error('The published branch was removed remotely. Choose a new branch.');
  // A verified, already-pushed commit only needs its PR; advancing the base cannot overwrite it.
  if (repository.baseCommit && baseInfo.object?.sha !== repository.baseCommit && !(retry && reference.ok))
    throw new Error(
      'The source branch changed remotely. Export your work, reopen the latest repository, and reconcile changes before publishing.',
    );
  repository.publication = { branch, commit, remote, base: repository.branch, ...(retry ? prior : {}) };
  // Record intent before the remote mutation so a lost response can be retried safely.
  await store.adopt(repository);
  if (!reference.ok) {
    await repository.push(branch, token, options.http);
  }
  repository.publication.pushed = true;
  await store.adopt(repository);
  const query = new URLSearchParams({ state: 'open', head: `${owner}:${branch}`, base: repository.branch });
  const existing = await api(`/pulls?${query}`);
  if (!existing.ok) throw new Error('Branch saved to GitHub. Retry to open the pull request.');
  const pulls = (await existing.json()) as { html_url?: string }[];
  let url = pulls[0]?.html_url;
  if (!url) {
    const response = await api('/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title: options.title.trim(),
        body: options.body ?? '',
        head: branch,
        base: repository.branch,
      }),
    });
    if (!response.ok) throw new Error('Branch saved to GitHub. Retry to open the pull request.');
    url = ((await response.json()) as { html_url?: string }).html_url;
  }
  if (!url?.startsWith(`https://github.com/${owner}/${repo}/pull/`))
    throw new Error('GitHub returned an invalid pull request address.');
  repository.publication.url = url;
  await store.adopt(repository);
  return { ...(await repository.describe()), branch, url, commit };
}
