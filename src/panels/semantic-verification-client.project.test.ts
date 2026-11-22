// @module-tag dom
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { requestSemanticVerification } from './semantic-verification-client';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const profile = {
  id: 'custom.profile',
  version: 2,
  scope: 'consolidated' as const,
  deterministicRules: [],
  principles: [],
};
const project = { projectId: 'project', revision: 3, promptPath: 'prompts/custom.md' };
const context = {
  profile: { id: profile.id, version: profile.version },
  sectionId: 'custom',
  principles: [],
  dependencies: [],
  project,
  sourceText: 'Full saved source',
  profileDefinition: profile,
};
function response(extra: object = {}, status = 200) {
  const meta = document.createElement('meta');
  meta.name = 'studio-token';
  meta.content = 'token';
  document.head.append(meta);
  const fetchMock = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          findings: [],
          model: 'wire-model',
          provider: 'openai',
          ...project,
          profile: context.profile,
          scope: 'consolidated',
          sourceHash: hash(context.sourceText),
          profileHash: hash(JSON.stringify(profile)),
          ...extra,
        }),
        { status },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => {
  document.querySelectorAll('meta[name="studio-token"]').forEach((node) => {
    node.remove();
  });
  vi.unstubAllGlobals();
});
it('requests a saved project profile without sending browser-authored instructions or criteria', async () => {
  const fetch = response();
  const result = await requestSemanticVerification('custom', 'Selected section', context);
  expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
    mode: 'project',
    ...project,
    profile: context.profile,
  });
  expect(result).toMatchObject({
    kind: 'ok',
    model: 'wire-model',
    provenance: { ...project, sourceHash: hash(context.sourceText) },
  });
});
it('rejects a review for a different saved source instead of calling it current', async () => {
  response({ sourceHash: hash('Different source') });
  expect(await requestSemanticVerification('custom', 'Selected section', context)).toEqual({ kind: 'stale' });
});
it('reports a stale project revision as a refresh requirement', async () => {
  response({ ok: false }, 409);
  expect(await requestSemanticVerification('custom', 'Selected section', context)).toEqual({ kind: 'stale' });
});
