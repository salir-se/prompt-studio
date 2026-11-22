// @vitest-environment node
// @module-tag pure
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LlmChatRequest, LlmProvider } from '@prompt-studio/agent';
import * as git from 'isomorphic-git';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_MANIFEST } from '../../src/manifest/default-manifest';
import { MemoryRepository } from '../../src/prompt-repo/memory-repository';
import type { Evaluation } from '../../src/run/contracts';
import { loopbackFetch } from '../loopback-fetch';
import { untilDone } from '../test-support/until-done';
import { createRunHandler } from './run-routes';

let directory = '';
let server: Server;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function setup(
  chat: (request: LlmChatRequest) => Promise<{ content: { type: 'text'; text: string }[]; model: string }>,
) {
  directory = await mkdtemp(path.join(tmpdir(), 'studio-evaluation-routes-'));
  const repository = new MemoryRepository('Evaluation project');
  await repository.initialize();
  await repository.patch([{ path: 'prompts/test.md', text: 'Answer {{topic}}. Read @references/evidence.md' }]);
  await repository.fs.promises.mkdir('/repo/references', { recursive: true });
  await repository.fs.promises.writeFile('/repo/references/evidence.md', 'Original project evidence');
  repository.editedFiles.push('references/evidence.md');
  const oid = await repository.commit('Version one');
  await git.tag({ fs: repository.fs, dir: '/repo', ref: 'v1', object: oid });
  const skillsFolder = path.join(directory, 'skills');
  await mkdir(path.join(skillsFolder, 'evidence'), { recursive: true });
  await writeFile(
    path.join(skillsFolder, 'evidence/SKILL.md'),
    '---\nname: evidence\ndescription: Check evidence\n---\nOriginal skill instructions',
  );
  const options = {
    runtime: {
      repository,
      repoRoot: directory,
      checkout: null,
      repoName: repository.name,
      resolvedManifest: { status: 'ok' as const, source: 'app' as const, manifest: DEFAULT_MANIFEST },
    },
    directory: path.join(directory, 'runs'),
    studioToken: 'token',
    allowedOrigins: ['http://localhost'],
    createProvider: () =>
      ({
        id: 'zai',
        name: 'Fixture',
        chat: async (request: LlmChatRequest) => ({
          usage: { inputTokens: 1, outputTokens: 1 },
          stopReason: 'end_turn',
          ...(await chat(request)),
        }),
      }) as unknown as LlmProvider,
  };
  const handler = createRunHandler(options);
  server = createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const send = async (suffix: string, body?: unknown) => {
    const response = await loopbackFetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/__studio/run${suffix}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-studio-token': 'token' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  const settings = await send('/settings', {
    skillsFolder,
    provider: 'zai',
    model: 'model',
    apiKey: 'private-provider-key',
  });
  expect(settings.status).toBe(200);
  const suite = {
    id: 'suite',
    name: 'Saved acceptance cases',
    promptPath: 'prompts/test.md',
    cases: [
      {
        id: 'one',
        name: 'Sales',
        inputs: { topic: 'sales' },
        userMessage: 'One sentence',
        checks: { contains: ['evidence'] },
      },
      { id: 'two', name: 'Growth', inputs: { topic: 'growth' }, userMessage: 'One sentence', checks: {} },
    ],
  };
  const identity = { projectId: repository.projectId, revision: repository.revision };
  expect((await send('/suites', { ...identity, suite })).status).toBe(200);
  const request = {
    ...identity,
    id: crypto.randomUUID(),
    suiteId: suite.id,
    candidates: [{ id: 'working', label: 'Working copy', source: await repository.read(suite.promptPath) }],
    provider: 'zai',
    model: 'model',
    skills: [settings.body.skills[0].id],
  };
  const get = async (): Promise<Evaluation> =>
    (await send(`/evaluations/${request.id}?projectId=${repository.projectId}`)).body.evaluation;
  const finish = async () => {
    await untilDone(async () => expect((await get()).finishedAt).toBeTruthy());
    return get();
  };
  return { send, request, get, finish, repository, skillsFolder, suite };
}

it('runs saved tests against real tagged versions with one frozen context and captures independent LLM judge evidence', async () => {
  const calls: LlmChatRequest[] = [];
  const f = await setup(async (request) => {
    calls.push(request);
    if (calls.length === 1) {
      await f.repository.fs.promises.writeFile('/repo/references/evidence.md', 'Changed after batch started');
      await writeFile(path.join(f.skillsFolder, 'evidence/SKILL.md'), 'Changed skill after batch started');
    }
    return {
      content: [
        {
          type: 'text',
          text: request.model === 'judge' ? '{"verdict":"A","reason":"Uses evidence."}' : 'Original evidence answer',
        },
      ],
      model: request.model,
    };
  });
  const versions = await f.send(`/versions?projectId=${f.repository.projectId}&promptPath=prompts/test.md`);
  expect(versions.status).toBe(200);
  expect(versions.body.versions[0].commit).toMatch(/^[a-f0-9]{40}$/);
  const started = await f.send('/evaluations', {
    ...f.request,
    candidates: [f.request.candidates[0], versions.body.versions[0]],
    judge: { model: 'judge', rubric: 'Accuracy and evidence' },
  });
  expect(started.status).toBe(202);
  const result = await f.finish();
  expect(result.status).toBe('completed');
  expect(result.results.map((item) => item.status)).toEqual(['passed', 'passed', 'unscored', 'unscored']);
  expect(result.results.every((item) => item.output === 'Original evidence answer')).toBe(true);
  expect(result.judge?.results.map((item) => item.verdict)).toEqual(['A', 'A']);
  expect(result.judge?.results.every((item) => item.runId && item.output)).toBe(true);
  expect(calls).toHaveLength(6);
  for (const call of calls.filter((call) => call.model === 'model')) {
    expect(call.systemPrompt).toContain('Original project evidence');
    expect(call.systemPrompt).toContain('Original skill instructions');
    expect(call.systemPrompt).not.toContain('Changed');
  }
  for (const call of calls.filter((call) => call.model === 'judge')) {
    expect(call.systemPrompt).not.toContain('skill instructions');
    expect(call.systemPrompt).not.toContain('Preloaded project files');
    expect(JSON.stringify(call.messages)).not.toContain('Working copy');
  }
  const readRun = await f.send(`/${result.results[0].runId}?projectId=${f.repository.projectId}`);
  expect(readRun.body.run.files[0].text).toBe('Original project evidence');
  expect(readRun.body.run.skills[0].files[0].text).toContain('Original skill instructions');
});

it('rejects an invalid later test before invoking the real model provider', async () => {
  const chat = vi.fn(async (request: LlmChatRequest) => ({
    content: [{ type: 'text' as const, text: 'evidence' }],
    model: request.model,
  }));
  const f = await setup(chat);
  f.suite.cases[1].inputs = {} as { topic: string };
  expect(
    (await f.send('/suites', { projectId: f.repository.projectId, revision: f.repository.revision, suite: f.suite }))
      .status,
  ).toBe(200);
  expect((await f.send('/evaluations', f.request)).status).toBe(400);
  expect(chat).not.toHaveBeenCalled();
});

it('cancels the active provider call and preserves its case result without starting the next test', async () => {
  const chat = vi.fn(
    async (_request: LlmChatRequest) =>
      new Promise<{ content: { type: 'text'; text: string }[]; model: string }>(() => {}),
  );
  const f = await setup(chat);
  expect((await f.send('/evaluations', f.request)).status).toBe(202);
  await untilDone(() => expect(chat).toHaveBeenCalledOnce());
  expect((await f.send(`/evaluations/${f.request.id}/cancel`, { projectId: f.repository.projectId })).status).toBe(200);
  const result = await f.finish();
  expect(result.status).toBe('cancelled');
  expect(result.results).toHaveLength(1);
  expect(result.results[0]).toMatchObject({ status: 'error', error: 'Run cancelled.' });
  expect(chat).toHaveBeenCalledOnce();
});

it('judges full captured outputs at the run output limit without truncating either answer', async () => {
  const answer = 'x'.repeat(128 * 1024);
  const calls: LlmChatRequest[] = [];
  const f = await setup(async (request) => {
    calls.push(request);
    return {
      content: [
        {
          type: 'text',
          text: request.model === 'judge' ? '{"verdict":"tie","reason":"Answers are identical."}' : answer,
        },
      ],
      model: request.model,
    };
  });
  const versions = await f.send(`/versions?projectId=${f.repository.projectId}&promptPath=prompts/test.md`);
  expect(
    (
      await f.send('/evaluations', {
        ...f.request,
        candidates: [f.request.candidates[0], versions.body.versions[0]],
        judge: { model: 'judge', rubric: 'Compare the full answers.' },
      })
    ).status,
  ).toBe(202);
  const result = await f.finish();
  expect(result.status).toBe('completed');
  expect(result.judge?.results.map((item) => item.verdict)).toEqual(['tie', 'tie']);
  const judge = calls.find((request) => request.model === 'judge');
  expect(judge).toBeTruthy();
  const messages = judge?.messages;
  if (!Array.isArray(messages)) throw new Error('Expected judge messages');
  const first = messages[0];
  if (!first || typeof first !== 'object' || !('content' in first)) throw new Error('Expected a judge message');
  const raw = first.content;
  if (typeof raw !== 'string') throw new Error('Expected captured judge JSON');
  expect(JSON.parse(raw)).toMatchObject({ A: answer, B: answer });
});
