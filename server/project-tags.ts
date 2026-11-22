import { type } from 'arktype';
import * as git from 'isomorphic-git';
import type { MemoryRepository } from '../src/prompt-repo/memory-repository';
import { DIR } from '../src/prompt-repo/repository-policy';

const request = type({ '+': 'reject', projectId: 'string > 0', revision: 'number.integer >= 0', name: 'string > 0' });
export function parseProjectTag(input: unknown) {
  const result = request(input);
  if (result instanceof type.errors) throw new Error('Supply the project, saved revision and a new tag name.');
  return result;
}
export async function createProjectTag(repository: MemoryRepository, name: string) {
  if (name.length > 150 || name !== name.trim() || name.startsWith('refs/') || name.startsWith('-'))
    throw new Error('Choose a Git tag name up to 150 characters, such as v1 or experiments/concise.');
  const copy = repository.copy();
  const commit = await copy.commit(`Save prompt version ${name}`);
  try {
    // writeRef validates Git's ref syntax and refuses to overwrite an existing tag.
    await git.writeRef({ fs: copy.fs, dir: DIR, ref: `refs/tags/${name}`, value: commit, force: false });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'AlreadyExistsError') throw new Error('That tag already exists. Choose a new name.', { cause: error });
    if (code === 'InvalidRefNameError' || code === 'ENOTDIR' || code === 'EISDIR')
      throw new Error('Choose a valid Git tag name, such as v1 or experiments/concise.', { cause: error });
    throw error;
  }
  return { repository: copy, tag: name, commit };
}
