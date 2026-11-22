// @module-tag dom
import type { PromptVerificationFinding } from '@prompt-studio/prompts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCompactInterpretation, requestSemanticVerification } from './semantic-verification-client';

const STUDIO_TOKEN_HEADER = 'x-studio-token';

function setStudioToken(token = 'test-token'): void {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'studio-token');
  meta.setAttribute('content', token);
  document.head.appendChild(meta);
}

function clearStudioToken(): void {
  for (const meta of document.head.querySelectorAll('meta[name="studio-token"]')) {
    meta.remove();
  }
}

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  clearStudioToken();
  vi.unstubAllGlobals();
});

describe('requestSemanticVerification', () => {
  it('degrades to failed without throwing when no studio-token meta tag is present', async () => {
    // No setStudioToken() call: simulates the default vitest/no-dev-server environment.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: true, findings: [], model: 'unreachable' })),
    );
    await expect(requestSemanticVerification('scout', 'text')).resolves.toEqual({ kind: 'failed' });
  });

  it('degrades to failed without throwing when fetch rejects (network failure)', async () => {
    setStudioToken();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(requestSemanticVerification('scout', 'text')).resolves.toEqual({ kind: 'failed' });
  });

  it('sends promptKey/text as JSON and the token as x-studio-token, POSTing /verify', async () => {
    setStudioToken('abc123');
    const fetchMock = vi.fn<typeof fetch>(async () => fakeResponse({ ok: true, findings: [], model: 'claude-test' }));
    vi.stubGlobal('fetch', fetchMock);

    await requestSemanticVerification('scout', 'the prompt text');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/verify');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)[STUDIO_TOKEN_HEADER]).toBe('abc123');
    expect(JSON.parse(init.body as string)).toEqual({
      promptKey: 'scout',
      text: 'the prompt text',
      profile: { id: 'scout.legacy.consolidated', version: 1 },
      sectionId: 'scout',
      principles: [],
      dependencies: [],
    });
  });

  it('sends only the selected fragment, its principles, and declared dependencies', async () => {
    setStudioToken('abc123');
    const fetchMock = vi.fn<typeof fetch>(async () => fakeResponse({ ok: true, findings: [], model: 'test' }));
    vi.stubGlobal('fetch', fetchMock);

    await requestSemanticVerification('scout', 'candidate fragment', {
      profile: { id: 'scout.candidate-validation.verification', version: 1 },
      sectionId: 'scout.candidate-validation',
      principles: [
        {
          id: 'evidence-before-persistence',
          version: 1,
          owner: 'platform',
          statement: 'Verify evidence before persistence.',
          severity: 'error',
          allowedCustomization: 'Wording may change.',
          sectionIds: ['scout.candidate-validation'],
        },
      ],
      dependencies: [{ sectionId: 'scout.hard-rules', text: 'Hard-rule context.' }],
    } as never);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      promptKey: 'scout',
      text: 'candidate fragment',
      profile: { id: 'scout.candidate-validation.verification', version: 1 },
      sectionId: 'scout.candidate-validation',
      principles: [
        {
          id: 'evidence-before-persistence',
          version: 1,
          owner: 'platform',
          statement: 'Verify evidence before persistence.',
          severity: 'error',
          allowedCustomization: 'Wording may change.',
          sectionIds: ['scout.candidate-validation'],
        },
      ],
      dependencies: [{ sectionId: 'scout.hard-rules', text: 'Hard-rule context.' }],
    });
  });

  it('maps a 200 body to the ok outcome with its findings and model', async () => {
    setStudioToken();
    const findings: PromptVerificationFinding[] = [
      {
        source: 'semantic',
        profile: { id: 'scout.legacy.consolidated', version: 1 },
        principleId: 'semantic-tools',
        severity: 'warning',
        message: 'Tool ordering may have shifted.',
        evidenceQuote: 'search job boards',
        proposedCorrection: 'Restore original ordering.',
        scope: 'consolidated',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: true, findings, model: 'claude-sonnet-test' })),
    );

    await expect(requestSemanticVerification('scout', 'text')).resolves.toEqual({
      kind: 'ok',
      findings,
      model: 'claude-sonnet-test',
    });
  });

  it('maps a 503 response to unavailable, never surfacing the server error string', async () => {
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false, error: 'Verification is unavailable.' }, 503)),
    );
    await expect(requestSemanticVerification('scout', 'text')).resolves.toEqual({ kind: 'unavailable' });
  });

  it('maps a 429 response to budget-exhausted', async () => {
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false, error: 'Verification budget exhausted for this session.' }, 429)),
    );
    await expect(requestSemanticVerification('scout', 'text')).resolves.toEqual({ kind: 'budget-exhausted' });
  });

  it.each([502, 401, 403, 400, 500])('maps a %d response to a generic failed outcome', async (status) => {
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false, error: 'Verification failed.' }, status)),
    );
    await expect(requestSemanticVerification('scout', 'text')).resolves.toEqual({ kind: 'failed' });
  });

  it('degrades to failed on a non-JSON / unexpected-shape 200 body', async () => {
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: true, findings: 'not-an-array', model: 'x' })),
    );
    await expect(requestSemanticVerification('scout', 'text')).resolves.toEqual({ kind: 'failed' });
  });

  it('degrades to failed when json() itself throws (malformed body)', async () => {
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      })),
    );
    await expect(requestSemanticVerification('scout', 'text')).resolves.toEqual({ kind: 'failed' });
  });
});

describe('requestCompactInterpretation', () => {
  it('uses the guarded /verify endpoint and returns only a validated compact result', async () => {
    setStudioToken('compact-token');
    const fetchMock = vi.fn<typeof fetch>(async () =>
      fakeResponse({ ok: true, compactText: 'Keep constraints. Return JSON.', model: 'glm-5.3' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestCompactInterpretation('customer-brief', 'A long prompt.')).resolves.toEqual({
      kind: 'ok',
      compactText: 'Keep constraints. Return JSON.',
      model: 'glm-5.3',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      mode: 'compact',
      promptKey: 'customer-brief',
      text: 'A long prompt.',
    });
  });

  it.each([
    [503, 'unavailable'],
    [429, 'budget-exhausted'],
    [502, 'failed'],
  ] as const)('maps HTTP %d to %s', async (status, kind) => {
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false }, status)),
    );
    await expect(requestCompactInterpretation('x', 'text')).resolves.toEqual({ kind });
  });
});
