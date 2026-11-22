// @vitest-environment node
// @module-tag pure

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as git from 'isomorphic-git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRepository, RepositoryStore } from './memory-repository';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const cleanup: string[] = [];
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { force: true, recursive: true });
});
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-memory-'));
  cleanup.push(dir);
  await mkdir(path.join(dir, 'prompts'));
  await git.init({ fs, dir, defaultBranch: 'main' });
  await writeFile(path.join(dir, 'prompts/hello.md'), 'Original');
  await writeFile(path.join(dir, 'binary.bin'), Buffer.from([0, 255, 13, 128]));
  await writeFile(path.join(dir, 'script.sh'), '#!/bin/sh\necho hi\n');
  await chmod(path.join(dir, 'script.sh'), 0o755);
  for (const filepath of ['prompts/hello.md', 'binary.bin', 'script.sh']) await git.add({ fs, dir, filepath });
  await git.commit({ fs, dir, message: 'Start', author: { name: 'Test', email: 'test@example.com' } });
  return dir;
}
describe('isolated project repository', () => {
  it('saves supplied skill references in a version and archive, rejecting traversal before any write', async () => {
    const repo = new MemoryRepository('Adopt');
    await repo.initialize();
    await repo.patch([
      { path: 'skills/summary/SKILL.md', text: 'Use @references/rules.md' },
      { path: 'skills/summary/references/rules.md', text: 'Rules\r\n' },
    ]);
    await repo.commit('Adopt skill and references');
    const archive = await repo.archive();
    expect(archive.files.find((file) => file.path === 'skills/summary/references/rules.md')?.base64).toBe(
      Buffer.from('Rules\r\n').toString('base64'),
    );
    await expect(
      repo.patch([
        { path: 'skills/summary/SKILL.md', text: 'Changed' },
        { path: 'skills/summary/../secret.md', text: 'Secret' },
      ]),
    ).rejects.toThrow();
    expect(await repo.read('skills/summary/SKILL.md')).toBe('Use @references/rules.md');
  });

  it('round-trips a valid 4 MB archive file on the Node runtime', async () => {
    const base64 = Buffer.alloc(4_000_000, 123).toString('base64');
    const repo = await MemoryRepository.importArchive({
      format: 'prompt-studio-project-files@1',
      name: 'Large asset',
      files: [{ path: 'asset.bin', base64 }],
    });
    expect((await repo.archive()).files).toEqual([{ path: 'asset.bin', base64, mode: 0o100644 }]);
  });

  it.each(['A', 'AA=', 'AA===', 'AA==\n', 'AA-_', 'AB==', 'AAB='])(
    'rejects malformed or noncanonical base64 %j',
    async (base64) => {
      await expect(
        MemoryRepository.importArchive({
          format: 'prompt-studio-project-files@1',
          name: 'Invalid',
          files: [{ path: 'asset.bin', base64 }],
        }),
      ).rejects.toThrow('Invalid or duplicate project file.');
    },
  );

  it('rejects a detached checkout instead of silently replacing its tracked tree', async () => {
    const dir = await fixture();
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    await writeFile(path.join(dir, '.git/HEAD'), `${head}\n`);
    await rm(path.join(dir, '.git/refs/heads/main'));
    await expect(MemoryRepository.local(dir)).rejects.toThrow(/check out a branch/i);
    expect(await readFile(path.join(dir, 'binary.bin'))).toEqual(Buffer.from([0, 255, 13, 128]));
  });
  it('imports untracked project definitions without importing unrelated private files', async () => {
    const dir = await fixture();
    await mkdir(path.join(dir, '.prompt-studio'));
    const definitions = {
      format: 'prompt-studio-project@1',
      name: 'Authored project',
      variables: [],
      tools: [{ name: 'search', description: 'Find facts', inputSchema: {} }],
    };
    await writeFile(path.join(dir, '.prompt-studio/project.json'), JSON.stringify(definitions));
    await writeFile(path.join(dir, '.prompt-studio/private.txt'), 'private');
    const repository = await MemoryRepository.local(dir);
    expect(await repository.definitions()).toEqual(definitions);
    expect(await repository.allFiles()).not.toContain('.prompt-studio/private.txt');
    await writeFile(path.join(dir, '.prompt-studio/project.json'), '{invalid');
    await expect(MemoryRepository.local(dir)).rejects.toThrow();
    await rm(path.join(dir, '.prompt-studio/project.json'));
    await fs.promises.symlink(path.join(dir, 'prompts/hello.md'), path.join(dir, '.prompt-studio/project.json'));
    await expect(MemoryRepository.local(dir)).rejects.toThrow(/symbolic links/);
  });
  it('rejects a stale recovery writer instead of replacing another instance saved draft', async () => {
    const dir = await fixture();
    const first = new RepositoryStore(path.join(dir, 'recovery'));
    await first.adopt(await MemoryRepository.local(dir));
    const second = new RepositoryStore(path.join(dir, 'recovery'));
    await second.load();
    const a = first.active!.copy();
    await a.patch([{ path: 'prompts/a.md', text: 'A saved first' }]);
    await first.adopt(a);
    const b = second.active!.copy();
    await b.patch([{ path: 'prompts/b.md', text: 'B stale' }]);
    await expect(second.adopt(b)).rejects.toThrow(/another.*instance|changed on disk/i);
    const recovered = new RepositoryStore(path.join(dir, 'recovery'));
    await recovered.load();
    expect(await recovered.active!.read('prompts/a.md')).toBe('A saved first');
    expect(await recovered.active!.allFiles()).not.toContain('prompts/b.md');
    second.projects.set('stale-project', new MemoryRepository('Stale'));
    await second.load();
    expect(second.projects.has('stale-project')).toBe(false);
    expect(await second.active!.read('prompts/a.md')).toBe('A saved first');
  });
  it('allows only one of two simultaneous processes to replace the same recovery revision', async () => {
    const dir = await fixture();
    const recovery = path.join(dir, 'recovery');
    const store = new RepositoryStore(recovery);
    await store.adopt(await MemoryRepository.local(dir));
    const worker = path.join(dir, 'writer.ts');
    const modulePath = fileURLToPath(new URL('./memory-repository.ts', import.meta.url));
    await writeFile(
      worker,
      `
      import { RepositoryStore } from ${JSON.stringify(modulePath)};
      const store = new RepositoryStore(process.argv[2]);
      await store.load();
      const next = store.active.copy();
      await next.patch([{ path: 'prompts/' + process.argv[3] + '.md', text: process.argv[3] }]);
      console.log('READY');
      await new Promise(resolve => process.stdin.once('data', resolve));
      try { await store.adopt(next); console.log('SAVED'); }
      catch(error) { console.log('REJECTED ' + error.message); }
      process.exit(0);
    `,
    );
    function writer(name: string) {
      const child = spawn('bun', [worker, recovery, name], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      const ready = new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('READY')) resolve();
        });
        child.once('exit', () => {
          if (!output.includes('READY')) reject(new Error(output));
        });
      });
      const done = new Promise<string>((resolve, reject) => {
        child.on('error', reject);
        child.stderr.on('data', (chunk) => {
          output += chunk;
        });
        child.once('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(output))));
      });
      return { child, ready, done };
    }
    const a = writer('a');
    const b = writer('b');
    try {
      await Promise.all([a.ready, b.ready]);
      a.child.stdin.end('go');
      b.child.stdin.end('go');
      const outputs = await Promise.all([a.done, b.done]);
      expect(outputs.filter((output) => output.includes('SAVED'))).toHaveLength(1);
      expect(outputs.filter((output) => output.includes('REJECTED'))).toHaveLength(1);
      const loaded = new RepositoryStore(recovery);
      await loaded.load();
      const winner = outputs[0].includes('SAVED') ? 'a' : 'b';
      expect(await loaded.active!.read(`prompts/${winner}.md`)).toBe(winner);
    } finally {
      a.child.kill();
      b.child.kill();
    }
  });
  it('cleans its lock and temporary file after replacement failure and preserves an orphan lock', async () => {
    const dir = await fixture();
    const recovery = path.join(dir, 'recovery');
    const store = new RepositoryStore(recovery);
    await store.adopt(await MemoryRepository.local(dir));
    const before = await readFile(path.join(recovery, 'projects.json'));
    const changed = store.active!.copy();
    await changed.patch([{ path: 'prompts/hello.md', text: 'After failure' }]);
    const rename = vi
      .spyOn(await import('node:fs/promises'), 'rename')
      .mockRejectedValueOnce(new Error('disk failure'));
    try {
      await expect(store.adopt(changed)).rejects.toThrow('disk failure');
    } finally {
      rename.mockRestore();
    }
    expect(await readFile(path.join(recovery, 'projects.json'))).toEqual(before);
    expect(await fs.promises.readdir(recovery)).toEqual(['projects.json']);
    await writeFile(path.join(recovery, 'projects.lock'), 'orphan');
    await expect(store.adopt(changed)).rejects.toThrow(/close all Prompt Studio processes/);
    expect(await readFile(path.join(recovery, 'projects.lock'), 'utf8')).toBe('orphan');
    await rm(path.join(recovery, 'projects.lock'));
    await store.adopt(changed);
    const loaded = new RepositoryStore(recovery);
    await loaded.load();
    expect(await loaded.active!.read('prompts/hello.md')).toBe('After failure');
  });
  it('preserves binary files and executable modes through save/recovery, excludes credentials and source staging', async () => {
    const dir = await fixture();
    await writeFile(path.join(dir, '.env'), 'SECRET=untracked');
    await writeFile(path.join(dir, '.git/hooks/private-hook'), 'private-hook-secret');
    await git.setConfig({ fs, dir, path: 'http.extraHeader', value: 'Authorization: private-config-secret' });
    await writeFile(path.join(dir, 'binary.bin'), Buffer.from([5, 6, 7]));
    await git.add({ fs, dir, filepath: 'binary.bin' });
    const index = await readFile(path.join(dir, '.git/index'));
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    const repository = await MemoryRepository.local(dir);
    await repository.patch([{ path: 'prompts/hello.md', text: 'Edited' }]);
    const commit = await repository.commit('Change prompt only');
    expect(await readFile(path.join(dir, 'prompts/hello.md'), 'utf8')).toBe('Original');
    expect(await readFile(path.join(dir, '.git/index'))).toEqual(index);
    expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(head);
    expect((await git.readBlob({ fs: repository.fs, dir: '/repo', oid: commit, filepath: 'binary.bin' })).blob).toEqual(
      new Uint8Array([0, 255, 13, 128]),
    );
    const snapshot = Object.values(repository.snapshot().files)
      .map((file) => Buffer.from(file, 'base64').toString())
      .join('');
    expect(snapshot).not.toContain('private-hook-secret');
    expect(snapshot).not.toContain('private-config-secret');
    const store = new RepositoryStore(path.join(dir, 'recovery'));
    await store.adopt(repository);
    const second = new RepositoryStore(path.join(dir, 'recovery'));
    await second.load();
    expect(await second.active?.read('prompts/hello.md')).toBe('Edited');
    expect(Number(second.active?.vol.statSync('/repo/script.sh').mode) & 0o111).toBe(0o111);
    const exported = await second.active!.archive();
    expect(exported.files.some((file) => file.path === '.env')).toBe(false);
    const imported = await MemoryRepository.importArchive(exported);
    expect(imported.vol.readFileSync('/repo/binary.bin')).toEqual(Buffer.from([5, 6, 7]));
    expect(Number(imported.vol.statSync('/repo/script.sh').mode) & 0o111).toBe(0o111);
  });
  it('rejects invalid archives before adopting data', async () => {
    await expect(
      MemoryRepository.importArchive({
        format: 'prompt-studio-project-files@1',
        name: 'Bad',
        files: [{ path: '../escape', base64: '' }],
      }),
    ).rejects.toThrow();
    await expect(
      MemoryRepository.importArchive({
        format: 'prompt-studio-project-files@1',
        name: 'Bad',
        files: [{ path: '.git/config', base64: '' }],
      }),
    ).rejects.toThrow();
  });
});
