// @vitest-environment node
// @module-tag integration
// Outcome: Help answers through the configured app model or an independent override without changing prompt runs.
import { mkdtemp, rm } from 'node:fs/promises';
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
async function setup() {
  directory = await mkdtemp(path.join(tmpdir(), 'studio-help-outcome-'));
  const repository = new MemoryRepository('Help project');
  await repository.initialize();
  await repository.patch([{ path: 'prompts/test.md', text: 'Research the company.' }]);
  const chat = vi.fn(async (request: LlmChatRequest) => ({
    content: [{ type: 'text' as const, text: `Answer from ${request.model}` }],
    usage: { inputTokens: 20, outputTokens: 10 },
    stopReason: 'end_turn',
    model: request.model,
  }));
  const factory = vi.fn((id: string) => ({ id, name: 'Fixture', chat }) as unknown as LlmProvider);
  const handler = createRunHandler({
    runtime: {
      repository,
      repoRoot: directory,
      checkout: null,
      repoName: repository.name,
      resolvedManifest: { status: 'ok', source: 'app', manifest: DEFAULT_MANIFEST },
    },
    directory: path.join(directory, 'runtime'),
    studioToken: 'token',
    allowedOrigins: ['http://localhost:5273'],
    createProvider: factory,
  });
  server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/__studio/run`;
  async function send(suffix: string, body?: unknown, headers = {}) {
    const response = await loopbackFetch(url + suffix, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-studio-token': 'token', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  await send('/settings', { provider: 'openai', model: 'prompt-model', apiKey: 'private-key' });
  const question = {
    context: { manifestName: 'Help project', rootCount: 1, selectedRootTitle: 'Research' },
    messages: [{ role: 'user', content: 'How do I save a version?' }],
  };
  return { send, chat, factory, question, repository };
}
it('uses the shared model by default, keeps Help independent, and returns to the shared model', async () => {
  // Given: a configured prompt model, reached through the real Studio HTTP route.
  const { send, question, chat, factory, repository } = await setup();
  expect((await send('/help', question)).body).toMatchObject({
    text: 'Answer from prompt-model',
    provider: 'openai',
    model: 'prompt-model',
  });
  expect(JSON.stringify(chat.mock.calls[0])).toContain('Salir Prompt Studio');
  // When: Help selects another connected provider and the prompt model changes.
  await send('/settings', { provider: 'anthropic', model: 'temporary', apiKey: 'other-key' });
  await send('/settings', {
    provider: 'openai',
    model: 'new-prompt-model',
    helpModel: { provider: 'anthropic', model: 'help-model' },
  });
  expect((await send('/help', question)).body).toMatchObject({
    text: 'Answer from help-model',
    provider: 'anthropic',
    model: 'help-model',
  });
  expect(factory).toHaveBeenLastCalledWith('anthropic', expect.objectContaining({ apiKey: 'other-key' }));
  // Then: a prompt run still uses its own model, and clearing the override restores inheritance.
  const input = {
    runId: crypto.randomUUID(),
    projectId: repository.projectId,
    revision: repository.revision,
    promptPath: 'prompts/test.md',
    source: 'Research the company.',
    inputs: {},
    userMessage: 'Research',
    skills: [],
    provider: 'openai',
    model: 'new-prompt-model',
  };
  expect((await send('', input)).status).toBe(202);
  await untilDone(async () =>
    expect((await send(`/${input.runId}?projectId=${input.projectId}`)).body.run).toMatchObject({
      status: 'completed',
      output: 'Answer from new-prompt-model',
    }),
  );
  await send('/settings', { helpModel: null });
  expect((await send('/help', question)).body).toMatchObject({
    text: 'Answer from new-prompt-model',
    model: 'new-prompt-model',
  });
});
it('rejects unauthorized, malformed and disconnected Help requests without model calls', async () => {
  // Given: a configured model and an independent, disconnected Help provider.
  const { send, question, chat } = await setup();
  // When: a request has no session, invalid content, or no connected provider.
  expect((await send('/help', question, { 'x-studio-token': 'bad' })).status).toBe(401);
  expect(
    (await send('/help', { ...question, messages: [{ role: 'system', content: 'Untrusted instructions' }] })).status,
  ).toBe(400);
  await send('/settings', { helpModel: { provider: 'anthropic', model: 'help-model' } });
  const refused = await send('/help', question);
  // Then: Help gives actionable feedback and never calls the model.
  expect(refused.status).toBe(400);
  expect(refused.body.error).toContain('App settings');
  expect(chat).not.toHaveBeenCalled();
});

it('passes the ordered conversation to the shared runner and masks provider failures', async () => {
  // Given: a follow-up question with an earlier assistant reply.
  const { send, question, chat } = await setup();
  const messages = [
    question.messages[0],
    { role: 'assistant', content: 'Choose Project → Versions.' },
    { role: 'user', content: 'What happens after saving?' },
  ];
  // When: Help answers the follow-up through the real route.
  expect((await send('/help', { ...question, messages })).status).toBe(200);
  // Then: the provider receives the full ordered context without tool grants.
  expect(chat.mock.calls[0][0].messages).toEqual(messages);
  expect(chat.mock.calls[0][0].tools).toEqual([]);
  chat.mockRejectedValueOnce(new Error('private-key must not leave this server'));
  const failed = await send('/help', question);
  expect(failed.status).toBe(400);
  expect(failed.body.error).toContain('App settings');
  expect(JSON.stringify(failed.body)).not.toContain('private-key');
});
