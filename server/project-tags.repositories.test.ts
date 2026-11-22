// @vitest-environment node
// @module-tag pure
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { afterEach, expect, it } from 'vitest';
import { MemoryRepository } from '../src/prompt-repo/memory-repository';
import { taggedVersions } from './run/eval-versions';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
function command(args: string[], input?: Buffer) {
  const result = spawnSync('git', args, { input, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}
function packet(text: string) {
  return Buffer.from(`${(Buffer.byteLength(text) + 4).toString(16).padStart(4, '0')}${text}`);
}

it('retains packed lightweight and annotated tags when opening a local checkout or cloning real Git protocol data', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'studio-imported-tags-'));
  const source = path.join(directory, 'source');
  const bare = path.join(directory, 'remote.git');
  await mkdir(path.join(source, 'prompts'), { recursive: true });
  await git.init({ fs, dir: source, defaultBranch: 'main' });
  await writeFile(path.join(source, 'prompts/test.md'), 'Version one');
  await git.add({ fs, dir: source, filepath: 'prompts/test.md' });
  const author = { name: 'Test', email: 'test@example.test' };
  const first = await git.commit({ fs, dir: source, message: 'First', author });
  await git.tag({ fs, dir: source, ref: 'v1', object: first });
  await writeFile(path.join(source, 'prompts/test.md'), 'Version two');
  await git.add({ fs, dir: source, filepath: 'prompts/test.md' });
  const second = await git.commit({ fs, dir: source, message: 'Second', author });
  await git.annotatedTag({ fs, dir: source, ref: 'v2', object: second, message: 'Second version', tagger: author });
  command(['-C', source, 'pack-refs', '--all']);
  command(['clone', '--bare', source, bare]);
  const local = await MemoryRepository.local(source);
  expect(await taggedVersions(local, 'prompts/test.md')).toEqual([
    { id: 'tag:v1', label: 'v1', source: 'Version one', commit: first },
    { id: 'tag:v2', label: 'v2', source: 'Version two', commit: second },
  ]);
  let pushes = 0;
  const transport: git.HttpClient = {
    async request(request) {
      const target = new URL(request.url);
      expect(target.origin).toBe('https://github.com');
      const advertise = target.pathname.endsWith('/info/refs');
      const service = advertise ? target.searchParams.get('service')! : path.basename(target.pathname);
      if (service === 'git-receive-pack') pushes++;
      const input: Buffer[] = [];
      if (request.body) for await (const chunk of request.body) input.push(Buffer.from(chunk));
      const result = command(
        [service.replace('git-', ''), '--stateless-rpc', ...(advertise ? ['--advertise-refs'] : []), bare],
        Buffer.concat(input),
      );
      const body = advertise ? Buffer.concat([packet(`# service=${service}\n`), Buffer.from('0000'), result]) : result;
      return {
        url: request.url,
        method: request.method,
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': `application/x-${service}-${advertise ? 'advertisement' : 'result'}` },
        body: (async function* () {
          yield body;
        })(),
      };
    },
  };
  const cloned = await MemoryRepository.clone('https://github.com/team/prompts.git', undefined, undefined, transport);
  expect(await taggedVersions(cloned, 'prompts/test.md')).toEqual(await taggedVersions(local, 'prompts/test.md'));
  expect(pushes).toBe(0);
  expect(command(['-C', source, 'show', 'v1:prompts/test.md']).toString()).toBe('Version one');
});
