// @vitest-environment node
// @module-tag pure
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LlmChatRequest, LlmProvider } from '@prompt-studio/agent';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_MANIFEST } from '../../src/manifest/default-manifest';
import { MemoryRepository } from '../../src/prompt-repo/memory-repository';
import { loopbackFetch } from '../loopback-fetch';
import { untilDone } from '../test-support/until-done';
import { createRunHandler } from './run-routes';

let directory: string;
let server: Server;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function setup(
  chat = vi.fn(async (_request: LlmChatRequest) => ({
    content: [{ type: 'text' as const, text: 'Captured answer' }],
    usage: { inputTokens: 42, outputTokens: 7 },
    stopReason: 'end_turn',
    model: 'actual-model',
  })),
) {
  directory = await mkdtemp(path.join(tmpdir(), 'studio-run-'));
  const skillsFolder = path.join(directory, 'library');
  await mkdir(path.join(skillsFolder, 'evidence/references'), { recursive: true });
  await writeFile(
    path.join(skillsFolder, 'evidence/SKILL.md'),
    '---\nname: evidence\ndescription: Cite evidence\n---\nUse @references/rules.md.',
  );
  await writeFile(path.join(skillsFolder, 'evidence/references/rules.md'), 'Never invent citations.');
  const repository = new MemoryRepository('Run project');
  await repository.initialize();
  await repository.patch([{ path: 'prompts/test.md', text: 'Summarize {{topic}}. Read @docs/input.md.' }]);
  await repository.fs.promises.mkdir('/repo/docs', { recursive: true });
  await repository.fs.promises.writeFile('/repo/docs/input.md', 'Project evidence');
  const options = {
    runtime: {
      repository,
      repoRoot: directory,
      checkout: null,
      repoName: repository.name,
      resolvedManifest: { status: 'ok' as const, source: 'app' as const, manifest: DEFAULT_MANIFEST },
    },
    directory: path.join(directory, 'runtime'),
    studioToken: 'token',
    allowedOrigins: ['http://localhost:5273'],
    createProvider: () => ({ id: 'zai', name: 'Fixture', chat }) as unknown as LlmProvider,
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
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/__studio/run`;
  const send = async (suffix: string, body?: unknown, headers = {}) => {
    const response = await loopbackFetch(url + suffix, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-studio-token': 'token', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const settings = await send('/settings', {
    skillsFolder,
    provider: 'zai',
    model: 'requested-model',
    apiKey: 'private-key',
  });
  expect(settings.status).toBe(200);
  const skill = settings.body.skills[0];
  const input = {
    runId: crypto.randomUUID(),
    projectId: repository.projectId,
    revision: repository.revision,
    promptPath: 'prompts/test.md',
    source: 'Summarize {{topic}}. Read @docs/input.md.',
    inputs: { topic: 'Sales' },
    userMessage: 'Give a short answer.',
    skills: [skill.id],
    provider: 'zai',
    model: 'requested-model',
  };
  return { send, input, chat, options, skillsFolder };
}

it('runs the actual prompt with folder skills and project references, then reopens the captured result', async () => {
  const { send, input, chat, options } = await setup();
  const started = await send('', input);
  expect(started.status).toBe(202);
  await untilDone(async () =>
    expect((await send(`/${input.runId}?projectId=${input.projectId}`)).body.run.status).toBe('completed'),
  );
  const result = (await send(`/${input.runId}?projectId=${input.projectId}`)).body.run;
  expect(chat).toHaveBeenCalledOnce();
  const request = chat.mock.calls[0][0];
  expect(request.systemPrompt).toContain('Summarize Sales.');
  expect(request.systemPrompt).toContain('Never invent citations.');
  expect(request.systemPrompt).toContain('Project evidence');
  expect(request.messages).toEqual([{ role: 'user', content: 'Give a short answer.' }]);
  expect(request.tools).toEqual([]);
  expect(result.output).toBe('Captured answer');
  expect(result.model).toBe('actual-model');
  expect(result.source).toBe(input.source);
  expect(result.skills[0].files).toHaveLength(2);
  expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
  expect(await readFile(path.join(directory, 'runtime/settings.json'), 'utf8')).not.toContain('private-key');
  const reopened = createRunHandler(options);
  const old = server;
  old.closeAllConnections();
  await new Promise<void>((resolve) => old.close(() => resolve()));
  server = createServer((req, res) => {
    void reopened(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const response = await loopbackFetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/__studio/run/${input.runId}?projectId=${input.projectId}`,
    { headers: { 'x-studio-token': 'token' } },
  );
  expect((await response.json()).run.output).toBe('Captured answer');
});

it('rejects stale projects, unresolved input and missing references before calling the model', async () => {
  const { send, input, chat } = await setup();
  for (const change of [{ revision: 999 }, { inputs: {} }, { source: 'Read @missing/file.md' }]) {
    expect((await send('', { ...input, ...change })).status).toBe(400);
  }
  expect(chat).not.toHaveBeenCalled();
});

it('keeps discovery inside the configured folder and rejects a skill symlink escape', async () => {
  const { send, input, chat, skillsFolder } = await setup();
  await writeFile(path.join(directory, 'outside.md'), 'PRIVATE');
  await symlink(path.join(directory, 'outside.md'), path.join(skillsFolder, 'evidence/references/escape.md'));
  await writeFile(path.join(skillsFolder, 'evidence/SKILL.md'), 'Read @references/escape.md.');
  expect((await send('', input)).status).toBe(400);
  expect(chat).not.toHaveBeenCalled();
  expect((await send('/settings', { skillsFolder: path.join(directory, 'absent') })).status).toBe(400);
  expect((await send('/settings', undefined, { origin: 'https://evil.example' })).status).toBe(403);
});

it('captures a truncated one-shot response as failed with its partial output and actual wire metadata', async () => {
  const chat = vi.fn(async (_request: LlmChatRequest) => ({
    content: [{ type: 'text' as const, text: 'Partial answer' }],
    usage: { inputTokens: 10, outputTokens: 8192 },
    stopReason: 'max_tokens',
    model: 'actual-model',
  }));
  const { send, input } = await setup(chat);
  expect((await send('', input)).status).toBe(202);
  await untilDone(async () =>
    expect((await send(`/${input.runId}?projectId=${input.projectId}`)).body.run.status).toBe('failed'),
  );
  const result = (await send(`/${input.runId}?projectId=${input.projectId}`)).body.run;
  expect(result).toMatchObject({
    output: 'Partial answer',
    model: 'actual-model',
    usage: { inputTokens: 10, outputTokens: 8192 },
    stopReason: 'max_tokens',
  });
  expect(chat).toHaveBeenCalledOnce();
});

it('captures a provider error without repeating the model request', async () => {
  const { send, input, chat } = await setup();
  chat.mockRejectedValueOnce(new Error('Fixture upstream failure'));
  expect((await send('', input)).status).toBe(202);
  await untilDone(async () =>
    expect((await send(`/${input.runId}?projectId=${input.projectId}`)).body.run.status).toBe('failed'),
  );
  expect(chat).toHaveBeenCalledOnce();
});

it('preserves legacy tool-free receipt identity when optional tool bindings are introduced', async () => {
  const { send, input, chat } = await setup();
  await send('', input);
  await untilDone(async () =>
    expect((await send(`/${input.runId}?projectId=${input.projectId}`)).body.run.status).toBe('completed'),
  );
  const legacy = {
    projectId: input.projectId,
    revision: input.revision,
    promptPath: input.promptPath,
    source: input.source,
    inputs: Object.fromEntries(Object.entries(input.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    userMessage: input.userMessage,
    skills: input.skills,
    provider: input.provider,
    model: input.model,
  };
  const { fingerprint } = await import('./local-store');
  const stored = JSON.parse(
    await readFile(
      path.join(directory, 'runtime', 'projects', fingerprint(input.projectId), 'runs', `${input.runId}.json`),
      'utf8',
    ),
  );
  expect(stored.requestHash).toBe(fingerprint(JSON.stringify(legacy)));
  expect((await send('', { ...input, tools: [] })).status).toBe(202);
  expect(chat).toHaveBeenCalledOnce();
});
