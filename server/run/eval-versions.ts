import * as git from 'isomorphic-git';
import type { MemoryRepository } from '../../src/prompt-repo/memory-repository';
import { DIR, writableProjectPath } from '../../src/prompt-repo/repository-policy';
import { readWorkspacePrompt } from '../../src/prompt-repo/workspace-document';
import type { PromptCandidate } from '../../src/run/contracts';

export function assertPromptPath(promptPath: string) {
  if (!writableProjectPath(promptPath) || promptPath === '.prompt-studio/project.json')
    throw new Error('Choose a prompt inside this project.');
}
export async function taggedVersions(repository: MemoryRepository, promptPath: string): Promise<PromptCandidate[]> {
  assertPromptPath(promptPath);
  const versions: PromptCandidate[] = [];
  const tags = await git.listTags({ fs: repository.fs, dir: DIR });
  if (tags.length > 500)
    throw new Error('This project has more than 500 tags. Narrow the project before comparing versions.');
  for (const tag of tags) {
    // Annotated tags may point to another annotated tag; log peels them to the actual commit.
    const [entry] = await git.log({ fs: repository.fs, dir: DIR, ref: `refs/tags/${tag}`, depth: 1 });
    if (!entry) continue;
    try {
      const { blob } = await git.readBlob({ fs: repository.fs, dir: DIR, oid: entry.oid, filepath: promptPath });
      const file = new TextDecoder('utf-8', { fatal: true }).decode(blob);
      versions.push({
        id: `tag:${tag}`,
        label: tag,
        source: readWorkspacePrompt(file)?.text ?? file,
        commit: entry.oid,
      });
    } catch (error) {
      if (['NotFoundError', 'NotFound', 'ReadObjectFail'].includes((error as { code?: string }).code ?? '')) continue;
      throw error;
    }
  }
  return versions;
}
