// @vitest-environment node
// @module-tag pure
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LlmProvider } from '@prompt-studio/agent';
import * as git from 'isomorphic-git';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRepository } from '../../src/prompt-repo/memory-repository';
import type { Evaluation, RunRecord, RunRequest } from '../../src/run/contracts';
import { untilDone } from '../test-support/until-done';
import { createEvaluationService } from './evaluation-service';
import type { RunEngine, RunWorld } from './run-engine';

let directory = '';
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture(output: (request: RunRequest) => Promise<string> = async () => 'A useful answer') {
  directory = await mkdtemp(path.join(tmpdir(), 'studio-eval-'));
  const repository = new MemoryRepository('Evaluations');
  await repository.initialize();
  await repository.patch([{ path: 'prompts/test.md', text: 'Answer {{topic}}' }]);
  const commit = await repository.commit('First version');
  await git.tag({ fs: repository.fs, dir: '/repo', ref: 'v1', object: commit });
  const world = {
    repository: repository.copy(),
    provider: {} as LlmProvider,
    providerId: 'zai' as const,
    model: 'test-model',
    skills: [],
  };
  const records: RunRecord[] = [];
  const engine: RunEngine = {
    assertProject: vi.fn(async (id, revision) => {
      if (id !== repository.projectId || (revision !== undefined && revision !== repository.revision))
        throw new Error('Project changed');
      return repository;
    }),
    settings: vi.fn(),
    freeze: vi.fn(async () => world),
    prepare: vi.fn(async (request) => {
      if (request.source.includes('@missing.md') || (request.source.includes('{{topic}}') && !request.inputs.topic))
        throw new Error('Unresolved input or reference');
      return {
        ...request,
        sourceHash: 'hash',
        systemPrompt: request.source,
        skills: [],
        files: [],
        startedAt: new Date().toISOString(),
        status: 'running',
        output: '',
      };
    }),
    execute: vi.fn(async (request, frozen) => {
      const result = {
        ...(await engine.prepare(request, frozen as RunWorld)),
        status: 'completed' as const,
        output: await output(request),
      };
      records.push(result);
      return result;
    }),
    start: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    cancel: vi.fn(async () => {}),
  };
  const service = createEvaluationService({ engine, directory });
  const url = (query = '') => new URL(`http://localhost/__studio/run${query}`);
  const handle = (operation: string, method = 'GET', body?: unknown, query = '') =>
    service.handle(operation, method, url(query), body);
  const suite = {
    id: 'suite',
    name: 'Saved tests',
    promptPath: 'prompts/test.md',
    cases: [
      {
        id: 'case-one',
        name: 'Useful',
        inputs: { topic: 'sales' },
        userMessage: 'Please answer',
        checks: { contains: ['useful'] },
      },
      { id: 'case-two', name: 'Unscored', inputs: { topic: 'growth' }, userMessage: 'Please answer', checks: {} },
    ],
  };
  const identity = { projectId: repository.projectId, revision: repository.revision };
  const request = {
    ...identity,
    id: crypto.randomUUID(),
    suiteId: suite.id,
    candidates: [{ id: 'working', label: 'Working copy', source: 'Answer {{topic}}' }],
    provider: 'zai',
    model: 'test-model',
    skills: [],
  };
  const save = () => handle('/suites', 'POST', { ...identity, suite });
  const get = async (id = request.id): Promise<Evaluation> => {
    const result = await handle(`/evaluations/${id}`, 'GET', undefined, `?projectId=${repository.projectId}`);
    return (result?.body as { evaluation: Evaluation }).evaluation;
  };
  const finished = async (id = request.id) => {
    await untilDone(async () => expect((await get(id)).status).not.toBe('running'));
    return get(id);
  };
  return { service, handle, save, get, finished, request, identity, suite, repository, engine, records, world, commit };
}

it('retains actual per-case outputs and honest checks, then reloads the captured evaluation', async () => {
  const f = await fixture();
  await f.save();
  expect((await f.handle('/evaluations', 'POST', f.request))?.status).toBe(202);
  const result = await f.finished();
  expect(result.status).toBe('completed');
  expect(result.results.map(({ output, status }) => ({ output, status }))).toEqual([
    { output: 'A useful answer', status: 'passed' },
    { output: 'A useful answer', status: 'unscored' },
  ]);
  expect(f.engine.freeze).toHaveBeenCalledOnce();
  expect(vi.mocked(f.engine.execute).mock.calls.every(([, world]) => world === f.world)).toBe(true);
  const reopened = createEvaluationService({ engine: f.engine, directory });
  const read = await reopened.handle(
    `/evaluations/${result.id}`,
    'GET',
    new URL(`http://localhost?projectId=${f.identity.projectId}`),
    undefined,
  );
  expect((read?.body as { evaluation: Evaluation }).evaluation).toEqual(result);
  expect((await stat(path.join(directory, 'evaluations'))).mode & 0o077).toBe(0);
});

it('preflights every saved case and candidate before making any paid call', async () => {
  const f = await fixture();
  f.suite.cases[1].inputs = { topic: '' };
  await f.save();
  await expect(f.handle('/evaluations', 'POST', f.request)).rejects.toThrow('Unresolved');
  expect(f.engine.execute).not.toHaveBeenCalled();
  expect(
    (await f.handle('/evaluations', 'GET', undefined, `?projectId=${f.identity.projectId}&promptPath=prompts/test.md`))
      ?.body,
  ).toEqual({ evaluations: [] });
});

it('rejects stale identities, duplicate cases, malformed IDs, unknown fields and spoofed tags without spending', async () => {
  const f = await fixture();
  await f.save();
  for (const changes of [
    { revision: 999 },
    { id: '../../outside' },
    { candidates: [{ id: 'other', label: 'Other', source: 'Answer' }] },
    { candidates: [{ id: 'tag:v1', label: 'v1', commit: f.commit, source: 'Spoofed source' }] },
    { judge: { model: 'judge', rubric: 'Accuracy' } },
    { unrecognized: true },
  ])
    await expect(f.handle('/evaluations', 'POST', { ...f.request, ...changes })).rejects.toThrow();
  await expect(
    f.handle('/suites', 'POST', { ...f.identity, suite: { ...f.suite, cases: [f.suite.cases[0], f.suite.cases[0]] } }),
  ).rejects.toThrow('unique');
  expect(f.engine.execute).not.toHaveBeenCalled();
});

it('uses actual Git tag commits and preserves the current working source', async () => {
  const f = await fixture();
  await f.repository.patch([{ path: 'prompts/test.md', text: 'Improved {{topic}}' }]);
  const second = await f.repository.commit('Second version');
  await git.annotatedTag({
    fs: f.repository.fs,
    dir: '/repo',
    ref: 'v2',
    object: second,
    message: 'Second',
    tagger: { name: 'Studio', email: 'studio@example.test' },
  });
  const versions = (
    await f.handle('/versions', 'GET', undefined, `?projectId=${f.identity.projectId}&promptPath=prompts/test.md`)
  )?.body as { versions: { id: string; label: string; source: string; commit: string }[] };
  expect(versions.versions).toEqual([
    { id: 'tag:v1', label: 'v1', source: 'Answer {{topic}}', commit: f.commit },
    { id: 'tag:v2', label: 'v2', source: 'Improved {{topic}}', commit: second },
  ]);
  expect(await f.repository.read('prompts/test.md')).toBe('Improved {{topic}}');
});

it('makes retries idempotent, including concurrent requests, and rejects ID reuse with different inputs', async () => {
  let release!: (value: string) => void;
  const f = await fixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await f.save();
  const [one, two] = await Promise.all([
    f.handle('/evaluations', 'POST', f.request),
    f.handle('/evaluations', 'POST', f.request),
  ]);
  expect((one?.body as { evaluation: Evaluation }).evaluation.id).toBe(
    (two?.body as { evaluation: Evaluation }).evaluation.id,
  );
  expect(f.engine.execute).toHaveBeenCalledOnce();
  await expect(f.handle('/evaluations', 'POST', { ...f.request, model: 'different' })).rejects.toThrow(
    'different request',
  );
  await f.handle(`/evaluations/${f.request.id}/cancel`, 'POST', { projectId: f.identity.projectId });
  release('Partial answer');
  await untilDone(async () => expect((await f.get()).finishedAt).toBeTruthy());
  expect((await f.get()).results).toHaveLength(1);
  expect((await f.get()).status).toBe('cancelled');
  expect(f.engine.execute).toHaveBeenCalledOnce();
  expect(f.engine.cancel).toHaveBeenCalledWith(
    f.identity.projectId,
    (f.engine.execute as ReturnType<typeof vi.fn>).mock.calls[0][0].runId,
  );
  await f.handle('/evaluations', 'POST', f.request);
  expect(f.engine.execute).toHaveBeenCalledOnce();
});

it('records failed checks and provider errors without calling them passes', async () => {
  const f = await fixture(async () => 'Wrong');
  await f.save();
  vi.mocked(f.engine.execute)
    .mockImplementationOnce(async (request, world) => ({
      ...(await f.engine.prepare(request, world as RunWorld)),
      status: 'completed',
      output: 'Wrong',
    }))
    .mockImplementationOnce(async (request, world) => ({
      ...(await f.engine.prepare(request, world as RunWorld)),
      status: 'failed',
      output: 'Partial',
      error: 'Provider unavailable',
    }));
  await f.handle('/evaluations', 'POST', f.request);
  const result = await f.finished();
  expect(result.results.map((item) => item.status)).toEqual(['failed', 'error']);
  expect(result.results[1]).toMatchObject({ output: 'Partial', error: 'Provider unavailable' });
  expect(result.status).toBe('completed');
});

it('judges blinded outputs explicitly without inheriting candidate skills and saves judge evidence', async () => {
  const f = await fixture(async (request) =>
    request.model === 'judge' ? '{"verdict":"B","reason":"More accurate"}' : 'A useful answer',
  );
  await f.save();
  const tag = { id: 'tag:v1', label: 'v1', source: 'Answer {{topic}}', commit: f.commit };
  vi.mocked(f.engine.freeze).mockImplementation(async (request) => ({
    ...f.world,
    model: request.model,
    skills: request.skills.length ? [{ id: 'skill', name: 'Skill', files: [] }] : [],
  }));
  await f.handle('/evaluations', 'POST', {
    ...f.request,
    skills: ['skill'],
    candidates: [f.request.candidates[0], tag],
    judge: { model: 'judge', rubric: 'Prefer accurate answers.' },
  });
  const result = await f.finished();
  expect(f.engine.execute).toHaveBeenCalledTimes(6);
  expect(result.results).toHaveLength(4);
  expect(result.judge?.results).toHaveLength(2);
  expect(result.judge?.results[0]).toMatchObject({
    verdict: 'B',
    reason: 'More accurate',
    model: 'judge',
    output: '{"verdict":"B","reason":"More accurate"}',
  });
  expect(result.judge?.results[0].runId).toBeTruthy();
  const judges = vi.mocked(f.engine.execute).mock.calls.filter(([request]) => request.model === 'judge');
  expect(judges.every(([request, world]) => request.skills.length === 0 && world?.skills.length === 0)).toBe(true);
  expect(judges[0][0].userMessage).not.toContain('v1');
  expect(JSON.parse(judges[0][0].userMessage)).toMatchObject({ A: 'A useful answer', B: 'A useful answer' });
});

it('retains invalid judge responses as errors rather than ties or passes', async () => {
  const f = await fixture(async (request) => (request.model === 'judge' ? '{"verdict":"tie"}' : 'A useful answer'));
  await f.save();
  await f.handle('/evaluations', 'POST', {
    ...f.request,
    candidates: [f.request.candidates[0], { id: 'tag:v1', label: 'v1', source: 'Answer {{topic}}', commit: f.commit }],
    judge: { model: 'judge', rubric: 'Accuracy' },
  });
  const result = await f.finished();
  expect(result.judge?.results.every((item) => item.verdict === 'error')).toBe(true);
  expect(result.judge?.results[0].output).toBe('{"verdict":"tie"}');
});

it('preserves completed suite snapshots when later edits create a new suite version', async () => {
  const f = await fixture();
  await f.save();
  await f.save();
  await f.handle('/evaluations', 'POST', f.request);
  const original = await f.finished();
  f.suite.name = 'Updated suite';
  f.suite.cases[0].checks.contains = ['different expectation'];
  await f.save();
  const { createEvalStore } = await import('./eval-store');
  const saved = await createEvalStore(directory).read<import('./eval-store').StoredSuite>(
    f.identity.projectId,
    'suites',
    f.suite.id,
  );
  expect(saved?.versions).toHaveLength(2);
  expect(saved?.versions[0].cases[0].checks.contains).toEqual(['useful']);
  expect((await f.get()).suite).toEqual(original.suite);
  expect((await f.get()).results[0].status).toBe('passed');
});

it.each(['running', 'cancelled'] as const)(
  'recovers a %s batch after its owner exits and retains partial outputs',
  async (status) => {
    const f = await fixture();
    await f.save();
    await f.handle('/evaluations', 'POST', f.request);
    const completed = await f.finished();
    const { createEvalStore } = await import('./eval-store');
    const store = createEvalStore(directory);
    const saved = await store.read<import('./eval-store').StoredEvaluation>(
      f.identity.projectId,
      'evaluations',
      f.request.id,
    );
    if (!saved) throw new Error('Expected saved evaluation');
    saved.evaluation.status = status;
    saved.ownerPid = 2_147_483_647;
    delete saved.evaluation.finishedAt;
    saved.evaluation.results.pop();
    await store.write(f.identity.projectId, 'evaluations', f.request.id, saved);
    const reopened = createEvaluationService({ engine: f.engine, directory });
    const response = await reopened.handle(
      `/evaluations/${f.request.id}`,
      'GET',
      new URL(`http://localhost?projectId=${f.identity.projectId}`),
      undefined,
    );
    const interrupted = (response?.body as { evaluation: Evaluation }).evaluation;
    expect(interrupted.status).toBe(status === 'cancelled' ? 'cancelled' : 'interrupted');
    expect(interrupted.results).toEqual([completed.results[0]]);
    expect(interrupted.finishedAt).toBeTruthy();
    expect(interrupted.error).toContain('Partial results were preserved');
    expect(f.engine.execute).toHaveBeenCalledTimes(2);
  },
);

it('unwraps native prompt metadata from tagged files and skips tags predating the prompt', async () => {
  const f = await fixture();
  const { createWorkspacePrompt } = await import('../../src/prompt-repo/workspace-document');
  const created = createWorkspacePrompt({
    id: 'test',
    title: 'Native',
    configuration: 'Default',
    tool: '',
    variable: '',
  });
  await f.repository.patch([created.document]);
  const native = await f.repository.commit('Native prompt');
  await git.tag({ fs: f.repository.fs, dir: '/repo', ref: 'native', object: native });
  const oldest = (await f.repository.history()).at(-1);
  await git.tag({ fs: f.repository.fs, dir: '/repo', ref: 'before-prompt', object: oldest?.commit });
  const response = await f.handle(
    '/versions',
    'GET',
    undefined,
    `?projectId=${f.identity.projectId}&promptPath=prompts/test.md`,
  );
  const versions = (response?.body as { versions: { id: string; source: string; commit: string }[] }).versions;
  expect(versions.find((item) => item.id === 'tag:native')).toMatchObject({ source: created.text, commit: native });
  expect(versions.some((item) => item.id === 'tag:before-prompt')).toBe(false);
  expect(versions.find((item) => item.id === 'tag:native')?.source).not.toContain('prompt-studio-design:');
});

it('checks the active project even for an idempotent retry of an existing evaluation', async () => {
  const f = await fixture();
  await f.save();
  await f.handle('/evaluations', 'POST', f.request);
  await f.finished();
  vi.mocked(f.engine.assertProject).mockRejectedValue(new Error('Project unavailable'));
  await expect(f.handle('/evaluations', 'POST', f.request)).rejects.toThrow('Project unavailable');
  expect(f.engine.execute).toHaveBeenCalledTimes(2);
});

it('retains a judge execution error per case and continues capturing the remaining tested cases', async () => {
  const f = await fixture();
  await f.save();
  vi.mocked(f.engine.execute).mockImplementation(async (request, world) => {
    if (request.model === 'judge') throw new Error('Judge storage unavailable');
    return { ...(await f.engine.prepare(request, world as RunWorld)), status: 'completed', output: 'A useful answer' };
  });
  await f.handle('/evaluations', 'POST', {
    ...f.request,
    candidates: [f.request.candidates[0], { id: 'tag:v1', label: 'v1', source: 'Answer {{topic}}', commit: f.commit }],
    judge: { model: 'judge', rubric: 'Accuracy' },
  });
  const result = await f.finished();
  expect(result.status).toBe('completed');
  expect(result.results).toHaveLength(4);
  expect(result.judge?.results).toHaveLength(2);
  expect(
    result.judge?.results.every((item) => item.verdict === 'error' && item.reason === 'Judge storage unavailable'),
  ).toBe(true);
});

it('does not mistake another live server owner for a restart or cancel its active evaluation', async () => {
  let release!: (value: string) => void;
  const f = await fixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await f.save();
  await f.handle('/evaluations', 'POST', f.request);
  const other = createEvaluationService({ engine: f.engine, directory });
  const url = new URL(`http://localhost?projectId=${f.identity.projectId}`);
  const read = await other.handle(`/evaluations/${f.request.id}`, 'GET', url, undefined);
  expect((read?.body as { evaluation: Evaluation }).evaluation.status).toBe('running');
  await expect(
    other.handle(`/evaluations/${f.request.id}/cancel`, 'POST', url, { projectId: f.identity.projectId }),
  ).rejects.toThrow('another');
  expect(f.engine.cancel).not.toHaveBeenCalled();
  await f.handle(`/evaluations/${f.request.id}/cancel`, 'POST', { projectId: f.identity.projectId });
  release('Partial');
  await untilDone(async () => expect((await f.get()).finishedAt).toBeTruthy());
});

it.each([false, true])('keeps session results when persistence fails (terminal only: %s)', async (terminalOnly) => {
  const f = await fixture();
  await f.save();
  const { LocalRunStore } = await import('./local-store');
  const original = LocalRunStore.prototype.write;
  const writes = vi.spyOn(LocalRunStore.prototype, 'write').mockImplementation(async function (
    this: import('./local-store').LocalRunStore,
    key,
    value,
    exclusive,
  ) {
    if (
      key.startsWith('evaluations/') &&
      !exclusive &&
      (!terminalOnly || (value as { evaluation: Evaluation }).evaluation.finishedAt)
    )
      throw new Error('Disk unavailable');
    return original.call(this, key, value, exclusive);
  });
  try {
    await f.handle('/evaluations', 'POST', f.request);
    await untilDone(async () => expect((await f.get()).error).toContain('could not be saved'));
    const failed = await f.get();
    expect(failed.status).toBe('failed');
    expect(failed.results).toHaveLength(terminalOnly ? 2 : 1);
    expect(failed.results[0].output).toBe('A useful answer');
    const list = await f.handle(
      '/evaluations',
      'GET',
      undefined,
      `?projectId=${f.identity.projectId}&promptPath=prompts/test.md`,
    );
    expect((list?.body as { evaluations: Evaluation[] }).evaluations).toEqual([failed]);
    expect(
      (await f.handle(`/evaluations/${f.request.id}/cancel`, 'POST', { projectId: f.identity.projectId }))?.status,
    ).toBe(200);
    expect((await f.get()).status).toBe('failed');
  } finally {
    writes.mockRestore();
  }
});
