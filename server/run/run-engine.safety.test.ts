// @vitest-environment node
// @module-tag pure
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LlmProvider } from '@prompt-studio/agent';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_MANIFEST } from '../../src/manifest/default-manifest';
import { MemoryRepository } from '../../src/prompt-repo/memory-repository';
import type { RunRequest } from '../../src/run/contracts';
import { untilDone } from '../test-support/until-done';
import { LocalRunStore } from './local-store';
import { createRunEngine } from './run-engine';
import { RunSettingsStore } from './run-settings';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-engine-safety-'));
  directories.push(directory);
  const repository = new MemoryRepository('Safety');
  await repository.initialize();
  await repository.patch([{ path: 'prompts/test.md', text: 'Answer {{topic}}.' }]);
  const settings = new RunSettingsStore(new LocalRunStore(directory));
  await settings.update({ provider: 'zai', model: 'requested-model', apiKey: 'private-key' });
  let finish!: (result: unknown) => void;
  const chat = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const options = {
    runtime: {
      repository,
      repoRoot: directory,
      checkout: null,
      repoName: repository.name,
      resolvedManifest: { status: 'ok' as const, source: 'app' as const, manifest: DEFAULT_MANIFEST },
    },
    settings,
    directory,
    createProvider: () => ({ id: 'zai', name: 'Fixture', chat }) as unknown as LlmProvider,
  };
  const input: RunRequest = {
    runId: crypto.randomUUID(),
    projectId: repository.projectId,
    revision: repository.revision,
    promptPath: 'prompts/test.md',
    source: 'Answer {{topic}}.',
    inputs: { topic: 'Safety' },
    userMessage: 'Go',
    skills: [],
    provider: 'zai',
    model: 'requested-model',
  };
  return {
    options,
    input,
    chat,
    complete: () =>
      finish({
        content: [{ type: 'text', text: 'Captured' }],
        model: 'resolved-model',
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: 'end_turn',
      }),
  };
}

it('rejects conflicting reuse while starting and after completion without repeating the paid call', async () => {
  const { options, input, chat, complete } = await fixture();
  const engine = createRunEngine(options);
  const starting = engine.start(input);
  await expect(engine.start({ ...input, inputs: { topic: 'Different' } })).rejects.toThrow(/different request/i);
  await starting;
  complete();
  expect((await engine.execute(input)).model).toBe('resolved-model');
  await expect(engine.start({ ...input, source: 'Different instructions' })).rejects.toThrow(/different request/i);
  expect((await engine.start(input)).output).toBe('Captured');
  expect(chat).toHaveBeenCalledOnce();
});

it('does not interrupt another live engine and rejects cancellation through an observer', async () => {
  const { options, input, chat, complete } = await fixture();
  const owner = createRunEngine(options);
  await owner.start(input);
  const observer = createRunEngine(options);
  expect((await observer.get(input.projectId, input.runId)).status).toBe('running');
  await expect(observer.cancel(input.projectId, input.runId)).rejects.toThrow(/another.*server/i);
  complete();
  await owner.execute(input);
  expect((await observer.get(input.projectId, input.runId)).output).toBe('Captured');
  expect(chat).toHaveBeenCalledOnce();
});

it('publishes completion only after the captured output can be reopened from disk', async () => {
  const { options, input, complete } = await fixture();
  const engine = createRunEngine(options);
  let unblock!: () => void;
  let markSaving!: () => void;
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const saving = new Promise<void>((resolve) => {
    markSaving = resolve;
  });
  const original = LocalRunStore.prototype.write;
  const write = vi.spyOn(LocalRunStore.prototype, 'write').mockImplementation(async function (
    this: LocalRunStore,
    key,
    value,
    exclusive,
  ) {
    if ((value as { finishedAt?: string }).finishedAt) {
      markSaving();
      await blocked;
    }
    return original.call(this, key, value, exclusive);
  });
  try {
    await engine.start(input);
    complete();
    await saving;
    let settled = false;
    const reading = engine.get(input.projectId, input.runId).then((record) => {
      settled = true;
      return record;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    unblock();
    expect((await reading).status).toBe('completed');
    expect((await createRunEngine(options).get(input.projectId, input.runId)).output).toBe('Captured');
  } finally {
    unblock();
    await engine.execute(input);
    write.mockRestore();
  }
});

it('recovers a receipt from a dead owner as interrupted without retrying its paid call', async () => {
  const { options, input, complete } = await fixture();
  const owner = createRunEngine(options);
  await owner.start(input);
  const store = new LocalRunStore(options.directory);
  const target = path.join(options.directory, store.project(input.projectId), 'runs', `${input.runId}.json`);
  const receipt = JSON.parse(await readFile(target, 'utf8'));
  receipt.ownerPid = 2_147_483_647;
  await writeFile(target, JSON.stringify(receipt));
  const observer = createRunEngine(options);
  expect((await observer.get(input.projectId, input.runId)).status).toBe('interrupted');
  complete();
  await owner.execute(input);
});

it('returns one claimed run to simultaneous servers without duplicating the model call', async () => {
  const { options, input, chat, complete } = await fixture();
  const first = createRunEngine(options);
  const second = createRunEngine(options);
  const results = await Promise.all([first.start(input), second.start(input)]);
  expect(results.map((result) => result.runId)).toEqual([input.runId, input.runId]);
  expect(chat).toHaveBeenCalledOnce();
  complete();
  await untilDone(async () => expect((await first.get(input.projectId, input.runId)).status).toBe('completed'));
});
