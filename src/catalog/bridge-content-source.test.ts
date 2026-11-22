// @module-tag dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBridgeContentSource, extractConstant } from './bridge-content-source';

/**
 * Module paths a manifest's symbol-sourced documents point at (passed to `prime()` as extra symbol → module
 * pairs). Fixtures below stand in for the CONTENT the bridge would return for these paths, to prove extraction
 * works from the bridge's response shape alone.
 */
const GREETING_MODULE = 'src/prompts/greeting.ts';
const REVIEW_MODULE = 'src/prompts/review.ts';
const SUMMARY_MODULE = 'src/prompts/summary.ts';

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

/** Stubs `fetch` to serve fixed bodies for known `/__studio/file?path=...` requests, 404 otherwise. */
function stubFetchFiles(filesByPath: Readonly<Record<string, string>>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.searchParams.get('path') ?? '';
    expect((init?.headers as Record<string, string> | undefined)?.[STUDIO_TOKEN_HEADER]).toBeTruthy();
    const text = filesByPath[path];
    if (text === undefined) {
      return fakeResponse({ ok: false, error: 'Path is not permitted.' }, 403);
    }
    return fakeResponse({ ok: true, path, text });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  clearStudioToken();
  vi.unstubAllGlobals();
});

describe('extractConstant', () => {
  it('extracts a tagged, multi-line template literal containing apostrophes and double quotes', () => {
    const source = `import { md } from './tags';

export const GREETING_PROMPT: string = md\`You're the greeting assistant.
Say "hello" to {{product_name}} and keep going.
Final line.\`;
`;
    expect(extractConstant(source, 'GREETING_PROMPT')).toBe(
      `You're the greeting assistant.\nSay "hello" to {{product_name}} and keep going.\nFinal line.`,
    );
  });

  it('extracts a bare (untagged) template literal the same way', () => {
    const source = 'export const PLAIN = `no tag here, just text`;';
    expect(extractConstant(source, 'PLAIN')).toBe('no tag here, just text');
  });

  it('extracts a single-quoted string constant', () => {
    const source = "export const SHORT_ONE = 'hello world';";
    expect(extractConstant(source, 'SHORT_ONE')).toBe('hello world');
  });

  it('does not confuse a symbol with another symbol it is a prefix of', () => {
    const source = `export const REVIEW_PROMPT: string = md\`v1 text\`;
export const REVIEW_PROMPT_V2: string = md\`v2 text\`;`;
    expect(extractConstant(source, 'REVIEW_PROMPT')).toBe('v1 text');
    expect(extractConstant(source, 'REVIEW_PROMPT_V2')).toBe('v2 text');
  });

  it('returns null, never a truncated literal, when the closing delimiter is missing', () => {
    const source = 'export const BROKEN = `never closes...';
    expect(extractConstant(source, 'BROKEN')).toBeNull();
  });

  it('returns null when the export is not a string/template literal (e.g. an array)', () => {
    const source = 'export const GREETING_TOOLS: ToolDefinition[] = [{ name: "web_search" }];';
    expect(extractConstant(source, 'GREETING_TOOLS')).toBeNull();
  });

  it('returns null when the symbol has no matching declaration in the file at all', () => {
    const source = "export const SOMETHING_ELSE = 'irrelevant';";
    expect(extractConstant(source, 'GREETING_PROMPT')).toBeNull();
  });
});

describe('bridgeContentSource', () => {
  it('getPromptText returns null for every symbol before prime() has run, without throwing', () => {
    // Given: a fresh source
    const source = createBridgeContentSource();
    // When / Then: any symbol is unknown
    expect(source.getPromptText('GREETING_PROMPT')).toBeNull();
  });

  it('getToolSourceLists returns no lists before prime() has run (no module text fetched yet)', () => {
    // Given: a fresh source
    // Then: no module text has been fetched, so no lists — an empty panel rather than a wrong one.
    const source = createBridgeContentSource();
    expect(source.getToolSourceLists()).toEqual([]);
  });

  it('fetches its module through the bridge and resolves the extracted text after prime()', async () => {
    // Given: the bridge serves a module that declares the symbol a manifest document points at
    setStudioToken();
    stubFetchFiles({
      [GREETING_MODULE]: `import { md } from './tags';

export const GREETING_PROMPT: string = md\`Line one with an apostrophe: it's fine.
Line two with "double quotes" too. {{product_name}} stays literal.\`;
`,
    });

    // When: the source is primed with that symbol → module pair
    const source = createBridgeContentSource();
    await source.prime(new Map([['GREETING_PROMPT', GREETING_MODULE]]));

    // Then: the extracted text is available, placeholders untouched
    expect(source.getPromptText('GREETING_PROMPT')).toBe(
      `Line one with an apostrophe: it's fine.\nLine two with "double quotes" too. {{product_name}} stays literal.`,
    );
  });

  it('fetches a source file shared by several symbols exactly once', async () => {
    // Given: one module declares three requested symbols
    setStudioToken();
    const fetchMock = stubFetchFiles({
      [REVIEW_MODULE]: `import { md } from './tags';

export const REVIEW_PROMPT: string = md\`review v1\`;

export const REVIEW_PROMPT_V2: string = md\`review v2\`;

export const REVIEW_INBOUND_PROMPT: string = md\`review inbound\`;
`,
    });

    // When: the source is primed with all three
    const source = createBridgeContentSource();
    await source.prime(
      new Map([
        ['REVIEW_PROMPT', REVIEW_MODULE],
        ['REVIEW_PROMPT_V2', REVIEW_MODULE],
        ['REVIEW_INBOUND_PROMPT', REVIEW_MODULE],
      ]),
    );

    // Then: each symbol resolves, and the module was fetched once
    expect(source.getPromptText('REVIEW_PROMPT')).toBe('review v1');
    expect(source.getPromptText('REVIEW_PROMPT_V2')).toBe('review v2');
    expect(source.getPromptText('REVIEW_INBOUND_PROMPT')).toBe('review inbound');

    const reviewFetches = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(encodeURIComponent(REVIEW_MODULE)),
    );
    expect(reviewFetches).toHaveLength(1);
  });

  it('degrades to null without throwing when no studio-token meta tag is present', async () => {
    // Given: no setStudioToken() call — the default vitest/no-dev-server environment
    stubFetchFiles({ [GREETING_MODULE]: 'export const GREETING_PROMPT = `unreachable, no token`;' });

    // When: the source is primed
    const source = createBridgeContentSource();
    await expect(source.prime(new Map([['GREETING_PROMPT', GREETING_MODULE]]))).resolves.toBeUndefined();

    // Then: nothing resolves
    expect(source.getPromptText('GREETING_PROMPT')).toBeNull();
  });

  it('degrades to null without throwing when fetch rejects (network failure)', async () => {
    // Given: the network is down
    setStudioToken();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    // When / Then: prime resolves and nothing resolves
    const source = createBridgeContentSource();
    await expect(source.prime(new Map([['GREETING_PROMPT', GREETING_MODULE]]))).resolves.toBeUndefined();
    expect(source.getPromptText('GREETING_PROMPT')).toBeNull();
  });

  it('degrades to null without throwing on a non-200 bridge response', async () => {
    // Given: the bridge refuses every path
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false, error: 'Forbidden.' }, 403)),
    );

    // When / Then: prime resolves and nothing resolves
    const source = createBridgeContentSource();
    await expect(source.prime(new Map([['GREETING_PROMPT', GREETING_MODULE]]))).resolves.toBeUndefined();
    expect(source.getPromptText('GREETING_PROMPT')).toBeNull();
  });

  it('degrades to null without throwing on an { ok: false } bridge body, never surfacing its error string', async () => {
    // Given: the bridge answers 200 with an error body
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false, error: 'Path is not permitted.' })),
    );

    // When: the source is primed
    const source = createBridgeContentSource();
    await expect(source.prime(new Map([['GREETING_PROMPT', GREETING_MODULE]]))).resolves.toBeUndefined();

    // Then: the symbol is unknown and the error string is never used as text
    const result = source.getPromptText('GREETING_PROMPT');
    expect(result).toBeNull();
    expect(result).not.toBe('Path is not permitted.');
  });

  it('returns null (never a partial string) when the requested symbol is absent from the fetched file', async () => {
    // Given: the module does not declare the requested symbol
    setStudioToken();
    stubFetchFiles({
      [SUMMARY_MODULE]: "export const SOME_UNRELATED_EXPORT = 'not the summary prompt';",
    });

    // When: the source is primed
    const source = createBridgeContentSource();
    await source.prime(new Map([['SUMMARY_PROMPT', SUMMARY_MODULE]]));

    // Then: the symbol stays unknown
    expect(source.getPromptText('SUMMARY_PROMPT')).toBeNull();
  });
});
