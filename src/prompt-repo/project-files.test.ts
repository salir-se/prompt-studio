// @vitest-environment node
// @module-tag pure
import * as git from 'isomorphic-git';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from './memory-repository';
import { editProjectFiles, projectFileIndex, readProjectFile } from './project-files';

describe('referenced project text files', () => {
  it('edits an existing text asset, preserves binary bytes, and refuses stale buffers and symlinks', async () => {
    const repo = new MemoryRepository('References');
    await repo.initialize();
    await repo.fs.promises.mkdir('/repo/docs');
    await repo.fs.promises.writeFile('/repo/docs/rules.md', 'Original');
    await repo.fs.promises.writeFile('/repo/docs/image.bin', Buffer.from([0, 255, 10]));
    expect(await projectFileIndex(repo)).toEqual(['docs/image.bin', 'docs/rules.md']);
    const opened = await readProjectFile(repo, 'docs/rules.md');
    await editProjectFiles(repo, [{ path: opened.path, text: 'Revised', expectedHash: opened.hash }]);
    expect((await readProjectFile(repo, opened.path)).text).toBe('Revised');
    const restored = MemoryRepository.fromSnapshot(repo.snapshot());
    const commit = await restored.commit('Save referenced text');
    expect(
      new TextDecoder().decode(
        (await git.readBlob({ fs: restored.fs, dir: '/repo', oid: commit, filepath: opened.path })).blob,
      ),
    ).toBe('Revised');
    await expect(
      editProjectFiles(repo, [{ path: opened.path, text: 'Old edit', expectedHash: opened.hash }]),
    ).rejects.toThrow('changed');
    await expect(readProjectFile(repo, 'docs/image.bin')).rejects.toThrow('UTF-8');
    await expect(readProjectFile(repo, '.prompt-studio/project.json')).rejects.toThrow('private');
    await expect(readProjectFile(repo, '../outside')).rejects.toThrow('project');
    await repo.fs.promises.symlink('rules.md', '/repo/docs/link.md');
    await expect(readProjectFile(repo, 'docs/link.md')).rejects.toThrow('symbolic');
    expect(await repo.fs.promises.readFile('/repo/docs/image.bin')).toEqual(Buffer.from([0, 255, 10]));
  });
});
