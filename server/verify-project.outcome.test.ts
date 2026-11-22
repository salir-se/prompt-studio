// @vitest-environment node
// @module-tag pure
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LlmChatRequest, LlmProvider } from '@prompt-studio/agent';
import { afterEach, expect, it, vi } from 'vitest';
import { authoredPromptRootsFromHeads, promptDesignProviderKey } from '../src/design/prompt-design-project';
import { DEFAULT_MANIFEST } from '../src/manifest/default-manifest';
import { MemoryRepository } from '../src/prompt-repo/memory-repository';
import { createWorkspacePrompt, workspaceFileForDesign } from '../src/prompt-repo/workspace-document';
import { loopbackFetch } from './loopback-fetch';
import type { PromptRepoRuntime } from './prompt-repo-routes';
import { fingerprint, LocalRunStore } from './run/local-store';
import { RunSettingsStore } from './run/run-settings';
import { untilDone } from './test-support/until-done';
import { createVerifyHandler } from './verify';

let server: Server;
let directory: string;
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
async function setup(budget = 20, connected = true) {
  directory = await mkdtemp(path.join(tmpdir(), 'studio-project-review-'));
  const saved = createWorkspacePrompt({
    id: 'review-test',
    title: 'Review test',
    configuration: '',
    tool: '',
    variable: '',
  });
  const text = '# Mission\n<mission>\nReturn prose instead of JSON.\n</mission>\n';
  const design = {
    ...saved.design,
    verificationProfiles: saved.design.verificationProfiles.map((profile) => ({
      ...profile,
      principles: [
        {
          id: 'return-json',
          version: 1,
          owner: 'configuration' as const,
          severity: 'error' as const,
          statement: 'Return valid JSON.',
          allowedCustomization: 'Change wording while retaining JSON.',
          sectionIds: ['review-test.mission'],
        },
      ],
    })),
  };
  const repository = new MemoryRepository('Review project');
  await repository.initialize();
  await repository.patch([workspaceFileForDesign(design, text, '')]);
  const runtime: PromptRepoRuntime = {
    repository,
    repoRoot: directory,
    checkout: null,
    repoName: repository.name,
    resolvedManifest: { status: 'ok', source: 'app', manifest: DEFAULT_MANIFEST },
  };
  const settings = new RunSettingsStore(new LocalRunStore(path.join(directory, 'run-data')));
  await settings.update({
    provider: 'openai',
    model: 'review-model',
    ...(connected ? { apiKey: 'secret-review-key' } : {}),
  });
  const chat = vi.fn(async (_request: LlmChatRequest) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify([
          {
            message: 'Output contradicts JSON.',
            principleId: 'return-json',
            evidenceQuote: 'Return prose',
            proposedCorrection: 'Return JSON.',
          },
        ]),
      },
    ],
    usage: { inputTokens: 10, outputTokens: 10 },
    stopReason: 'end_turn',
    model: 'wire-model',
  }));
  const provider = { id: 'openai', name: 'Fixture', chat } as unknown as LlmProvider;
  const factory = vi.fn(() => provider);
  const handler = createVerifyHandler(
    {
      repoRoot: directory,
      staticDir: directory,
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: ['http://localhost:5273'],
      verifyBudget: budget,
    },
    'token',
    undefined,
    { runtime, settings, createProvider: factory },
  );
  server = createServer(
    (req, res) =>
      void handler(req, res).catch(() => {
        res.statusCode = 500;
        res.end('{}');
      }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/verify`;
  const send = async (body: unknown, headers: Record<string, string> = {}) => {
    const response = await loopbackFetch(url, {
      method: 'POST',
      headers: { 'x-studio-token': 'token', origin: 'http://localhost:5273', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const root = authoredPromptRootsFromHeads(
    new Map([
      [design.id, text],
      [promptDesignProviderKey(design.id), JSON.stringify(design)],
    ]),
  ).roots[0];
  const input = (scope: 'section' | 'consolidated') => {
    const profile = root.verification!.profiles.find((item) => item.scope === scope)!;
    return {
      mode: 'project',
      projectId: repository.projectId,
      revision: repository.revision,
      promptPath: `prompts/${design.id}.md`,
      profile: { id: profile.id, version: profile.version },
    };
  };
  return { send, input, text, chat, factory, repository, settings, root, design };
}

it.each(['section', 'consolidated'] as const)(
  'reviews saved authored %s criteria through HTTP and captures authoritative provenance',
  async (scope) => {
    const { send, input, text, chat, factory, root } = await setup();
    const request = input(scope);
    const result = await send(request);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      model: 'wire-model',
      provider: 'openai',
      scope,
      projectId: request.projectId,
      revision: request.revision,
      promptPath: request.promptPath,
      profile: request.profile,
      sourceHash: fingerprint(text),
      findings: [{ source: 'semantic', scope, principleId: 'return-json' }],
    });
    expect(result.body.profileHash).toBe(
      fingerprint(JSON.stringify(root.verification!.profiles.find((profile) => profile.id === request.profile.id))),
    );
    expect(factory).toHaveBeenCalledWith('openai', expect.objectContaining({ apiKey: 'secret-review-key' }));
    expect(chat).toHaveBeenCalledOnce();
    expect(chat.mock.calls[0][0].model).toBe('review-model');
    expect(chat.mock.calls[0][0].systemPrompt).toContain('Return valid JSON.');
    expect(JSON.stringify(chat.mock.calls[0][0].messages)).toContain('Return prose');
    expect(JSON.stringify(result.body)).not.toContain('secret-review-key');
  },
);

it('rejects stale project/profile identities and client-supplied text or criteria before spending', async () => {
  const { send, input, chat } = await setup();
  const request = input('section');
  for (const body of [
    { ...request, revision: request.revision + 1 },
    { ...request, projectId: 'another-project' },
    { ...request, profile: { ...request.profile, version: request.profile.version + 1 } },
  ])
    expect((await send(body)).status).toBe(409);
  expect((await send({ ...request, text: 'Forged source', principles: [] })).status).toBe(400);
  expect((await send({ ...request, promptPath: '../outside.md' })).status).toBe(400);
  expect(chat).not.toHaveBeenCalled();
});

it('shares configured credentials and blocks reviews when the connection or model is missing', async () => {
  const { send, input, chat, settings } = await setup(20, false);
  const response = await send(input('consolidated'));
  expect(response.status).toBe(503);
  expect(response.body.error).toContain('Run Settings');
  expect(chat).not.toHaveBeenCalled();
  await settings.update({ apiKey: 'connected-now', model: 'changed-review-model' });
  expect((await send(input('consolidated'))).status).toBe(200);
  expect(chat.mock.calls[0][0].model).toBe('changed-review-model');
});

it('rejects modified platform-owned criteria in saved project metadata', async () => {
  const { send, input, repository, chat } = await setup();
  const { readWorkspacePrompt } = await import('../src/prompt-repo/workspace-document');
  const file = await repository.fs.promises.readFile('/repo/prompts/review-test.md', 'utf8');
  const saved = readWorkspacePrompt(String(file))!;
  const design = {
    ...saved.design,
    verificationProfiles: saved.design.verificationProfiles.map((profile) => ({
      ...profile,
      principles: profile.principles.map((principle) => ({ ...principle, owner: 'platform' as const })),
    })),
  };
  await repository.patch([workspaceFileForDesign(design, saved.text, '')]);
  const response = await send({ ...input('section'), revision: repository.revision });
  expect(response.status).toBe(400);
  expect(response.body.error).toContain('platform criteria');
  expect(chat).not.toHaveBeenCalled();
});

it('bounds model spend after provider failure instead of returning successful empty findings', async () => {
  const { send, input, chat } = await setup(1);
  chat.mockRejectedValue(new Error('Provider rejected secret-review-key'));
  const failed = await send(input('consolidated'));
  expect(failed.status).toBe(502);
  expect(failed.body.ok).toBe(false);
  expect(JSON.stringify(failed.body)).not.toContain('secret-review-key');
  expect(await send(input('consolidated'))).toMatchObject({ status: 429, body: { code: 'REVIEW_BUDGET' } });
  expect(chat).toHaveBeenCalledOnce();
});

it.each([
  { principleId: 'invented-principle', evidenceQuote: 'Return prose' },
  { principleId: 'return-json', evidenceQuote: 'invented evidence' },
])('rejects hallucinated model findings %j without accepting partial results', async (finding) => {
  const { send, input, chat } = await setup();
  chat.mockResolvedValue({
    content: [
      {
        type: 'text',
        text: JSON.stringify([{ message: 'Bad output.', proposedCorrection: 'Return JSON.', ...finding }]),
      },
    ],
    usage: { inputTokens: 10, outputTokens: 10 },
    stopReason: 'end_turn',
    model: 'wire-model',
  });
  const response = await send(input('consolidated'));
  expect(response.status).toBe(502);
  expect(response.body.error).toContain('invalid review');
  expect(response.body).not.toHaveProperty('findings');
  expect(chat).toHaveBeenCalledOnce();
});

it('returns frozen source/profile provenance when saved text changes during a review', async () => {
  const { send, input, chat, repository, text } = await setup();
  const request = input('consolidated');
  let finish: (value: Awaited<ReturnType<typeof chat>>) => void = () => {};
  const response = await chat.getMockImplementation()!({} as LlmChatRequest);
  chat.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = send(request);
  await untilDone(() => expect(chat).toHaveBeenCalledOnce());
  await repository.patch([{ path: request.promptPath, text: 'Newer saved text.' }]);
  finish(response);
  const reviewed = await pending;
  expect(reviewed.status).toBe(200);
  expect(reviewed.body.revision).toBe(request.revision);
  expect(reviewed.body.sourceHash).toBe(fingerprint(text));
  expect(reviewed.body.sourceHash).not.toBe(fingerprint('Newer saved text.'));
});

it('distinguishes the temporary concurrency limit from the session spend limit', async () => {
  const { send, input, chat } = await setup();
  const original = chat.getMockImplementation()!;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  chat.mockImplementation(async (request) => {
    await gate;
    return original(request);
  });
  const first = send(input('section'));
  const second = send(input('consolidated'));
  try {
    await untilDone(() => expect(chat).toHaveBeenCalledTimes(2));
    const response = await send(input('section'));
    expect(response).toMatchObject({ status: 429, body: { code: 'REVIEW_BUSY' } });
    expect(chat).toHaveBeenCalledTimes(2);
  } finally {
    release();
  }
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
  expect((await send(input('section'))).status).toBe(200);
});

it('does not spend the model allowance on a saved scope without AI criteria', async () => {
  const { send, input, chat, repository, design, text } = await setup(1);
  const emptyProfile = {
    id: 'empty-blueprint',
    version: 1,
    scope: 'blueprint' as const,
    deterministicRules: [],
    principles: [],
  };
  await repository.patch([
    workspaceFileForDesign(
      { ...design, verificationProfiles: [...design.verificationProfiles, emptyProfile] },
      text,
      '',
    ),
  ]);
  const request = { ...input('section'), revision: repository.revision };
  const empty = await send({ ...request, profile: { id: emptyProfile.id, version: emptyProfile.version } });
  expect(empty.status).toBe(400);
  expect(empty.body.error).toContain('AI criteria');
  expect(chat).not.toHaveBeenCalled();
  expect((await send(request)).status).toBe(200);
  expect(chat).toHaveBeenCalledOnce();
});

it('bounds the complete model context as well as UTF-8 source bytes before spending', async () => {
  const { send, input, chat, repository, design, text } = await setup();
  await repository.patch([workspaceFileForDesign(design, '🚀'.repeat(50_001), '')]);
  expect((await send({ ...input('consolidated'), revision: repository.revision })).status).toBe(400);
  const large = {
    ...design,
    verificationProfiles: design.verificationProfiles.map((profile) =>
      profile.scope === 'consolidated'
        ? {
            ...profile,
            principles: profile.principles.map((principle) => ({
              ...principle,
              statement: 'Criterion. '.repeat(40_001),
            })),
          }
        : profile,
    ),
  };
  await repository.patch([workspaceFileForDesign(large, text, '')]);
  const response = await send({ ...input('consolidated'), revision: repository.revision });
  expect(response.status).toBe(400);
  expect(response.body.error).toContain('context limit');
  expect(chat).not.toHaveBeenCalled();
});
