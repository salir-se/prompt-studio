// @module-tag dom
import { createBlankPromptDesign } from '@prompt-studio/prompts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRootCatalog, type CatalogRoot } from '../catalog/root-catalog';
import { RELEASE_NOTES_PATH, RELEASE_NOTES_TEXT } from '../test-fixtures/starter-catalog';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import {
  buildSampleValues,
  fetchSkillBody,
  FinalPromptPanel,
  resolveVariablesForPreview,
  skillUnavailableMarker,
} from './FinalPromptPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The public build documents no built-in variables or tools; a host application's metadata is supplied here.
vi.mock('@prompt-studio/prompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@prompt-studio/prompts')>()),
  PROMPT_VARIABLE_DOCS: (await import('../test-fixtures/host-variable-docs')).HOST_VARIABLE_DOCS,
  PROMPT_KEY_TOOL_NAMES: { 'release-notes': ['list_changes'] },
}));

/**
 * The starter project's Release Notes prompt as a catalog root whose editable keys reach both documented
 * prompt keys, and which protects the starter's plain-language skill (a manifest cannot declare protected
 * skills, so the root carries it directly).
 */
function releaseNotesRoot(): CatalogRoot {
  const manifest = {
    catalog: {
      source: 'explicit',
      documents: [
        {
          id: 'release-notes',
          title: 'Release Notes',
          source: { kind: 'file', path: RELEASE_NOTES_PATH },
          editableKeys: ['release-notes', 'support-triage'],
        },
      ],
    },
  };
  const root = buildRootCatalog(undefined, manifest as never, new Map([[RELEASE_NOTES_PATH, RELEASE_NOTES_TEXT]]))[0];
  if (!root) throw new Error('release-notes root missing from catalog');
  return { ...root, protectedSkills: ['plain-language'] };
}

describe('buildSampleValues', () => {
  it('ignores inherited variable-doc entries for valid custom prompt names', () => {
    // Given / When / Then: prototype-named keys find no docs
    expect(buildSampleValues(['constructor', 'toString', '__proto__'])).toEqual({});
  });

  it('unions sample values across every editable key for the root, keyed by variable name', () => {
    // Given: a root whose editable keys reach two documented prompt keys
    // When: its sample values are built
    const samples = buildSampleValues(releaseNotesRoot().entry.editableKeys);
    // Then: every documented variable of both keys has its sample, once per name
    expect(samples).toEqual({
      change_list: '- Faster sign-in',
      company_name: 'Example Co',
      customer_message: 'I was charged twice.',
      product_name: 'Example App',
    });
  });

  it('returns an empty map for a root with no editable keys', () => {
    // Given / When / Then: no keys, no samples
    expect(buildSampleValues([])).toEqual({});
  });
});

describe('resolveVariablesForPreview', () => {
  it('uses only own samples, including legal prototype-named variables', () => {
    expect(resolveVariablesForPreview('{{constructor}} {{toString}} {{__proto__}}', {})).toBe(
      '{{constructor}} {{toString}} {{__proto__}}',
    );
    const samples = JSON.parse('{"__proto__":"custom proto","constructor":"custom constructor"}');
    expect(resolveVariablesForPreview('{{__proto__}} {{constructor}} {{toString}}', samples)).toBe(
      'custom proto custom constructor {{toString}}',
    );
  });

  it('replaces every known placeholder with its sample value', () => {
    const result = resolveVariablesForPreview('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('leaves an unknown placeholder as its literal {{name}} text rather than blanking it', () => {
    const result = resolveVariablesForPreview('{{known}} and {{unknown}}', { known: 'X' });
    expect(result).toBe('X and {{unknown}}');
  });

  it('handles text with no placeholders at all', () => {
    expect(resolveVariablesForPreview('plain text', {})).toBe('plain text');
  });
});

describe('fetchSkillBody', () => {
  it('degrades to the unavailable marker under vitest (no bridge / no studio-token meta tag), never throws', async () => {
    // Given: no bridge; When / Then: the body is the unavailable marker
    await expect(fetchSkillBody('plain-language')).resolves.toBe(skillUnavailableMarker('plain-language'));
  });
});

describe('FinalPromptPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.head.querySelector('meta[name="studio-token"]')?.remove();
    vi.unstubAllGlobals();
  });

  it('renders the resolved prompt, the dev-tool banner, and the injected-skill marker, and closes via Close', async () => {
    // Given: a root that protects a skill, previewing a documented placeholder
    let closed = false;
    const catalogRoot = releaseNotesRoot();

    // When: the panel renders
    await act(async () => {
      root.render(<FinalPromptPanel root={catalogRoot} text="{{product_name}}" onClose={() => (closed = true)} />);
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="final-prompt-drawer"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="final-prompt-banner"]')?.textContent).toContain(
      'developer preview, never ship this text',
    );
    // Then: the placeholder resolves to its sample, the banner warns, and the skill marker is injected
    expect(document.body.textContent).toContain('Example App');
    expect(document.body.textContent).toContain('injected skill: plain-language');
    expect(document.body.textContent).toContain(skillUnavailableMarker('plain-language'));

    const closeButton = document.querySelector('[aria-label="Close"]');
    expect(closeButton).toBeTruthy();
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(closed).toBe(true);
  });

  it('toggles between the resolved preview and canonical Markdown source', async () => {
    // Given: the panel in its resolved preview; When: the source toggle is used; Then: the raw Markdown shows
    const catalogRoot = releaseNotesRoot();
    await act(async () => {
      root.render(<FinalPromptPanel root={catalogRoot} text="plain text, no placeholders" onClose={() => {}} />);
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="final-prompt-raw"]')).toBeNull();

    const toggle = document.querySelector('[data-testid="final-prompt-source-toggle"]');
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="final-prompt-raw"]')).toBeTruthy();
    expect(toggle?.textContent).toBe('Source Markdown');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-testid="final-prompt-metrics"]')?.textContent).toContain(
      `${'plain text, no placeholders'.length} characters`,
    );
    const preview = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Sample preview');
    act(() => preview?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.querySelector('[data-testid="final-prompt-raw"]')).toBeNull();
    expect(preview?.getAttribute('aria-pressed')).toBe('true');
  });

  it('explains what is prompt text and what remains in the verification sidecar', async () => {
    const created = createBlankPromptDesign({ id: 'customer-brief', title: 'Customer Brief' });
    const markdown = '## Mission\n\n<mission>\nReturn a verified brief.\n</mission>\n';
    const authored = authoredPromptRootsFromHeads(
      new Map([
        ['customer-brief', markdown],
        [promptDesignProviderKey('customer-brief'), serializePromptDesign(created.design)],
      ]),
    ).roots[0];
    if (!authored) throw new Error('authored prompt missing');

    await act(async () => {
      root.render(<FinalPromptPanel root={authored} text={markdown} onClose={() => {}} />);
      await Promise.resolve();
    });

    const boundary = document.querySelector('[data-testid="final-prompt-artifact-boundary"]');
    expect(boundary?.textContent).toContain('Prompt Markdown');
    expect(boundary?.textContent).toContain('source of truth for instructions and graph structure');
    expect(boundary?.textContent).toContain('Verification sidecar');
    expect(boundary?.textContent).toContain('not added to model instructions automatically');

    act(() => {
      document
        .querySelector('[data-testid="final-prompt-source-toggle"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="final-prompt-banner"]')?.textContent).toContain(
      'Canonical prompt Markdown',
    );
    expect(document.querySelector('[data-testid="final-prompt-raw"]')?.textContent).toBe(markdown);
  });

  it('highlights unresolved placeholders, tool names, and XML tags in the raw view', async () => {
    // Given: text that mentions the root's tool, an unresolvable placeholder and a tag
    const catalogRoot = releaseNotesRoot();
    const toolName = catalogRoot.toolNames[0];
    expect(toolName).toBe('list_changes');
    await act(async () => {
      root.render(
        <FinalPromptPanel
          root={catalogRoot}
          text={`Use ${toolName} on {{never_resolves}} inside <rules>.`}
          onClose={() => {}}
        />,
      );
      await Promise.resolve();
    });

    act(() => {
      document
        .querySelector('[data-testid="final-prompt-source-toggle"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const raw = document.querySelector('[data-testid="final-prompt-raw"]') as HTMLElement;
    const spanByText = (text: string) =>
      Array.from(raw.querySelectorAll('span')).find((span) => span.textContent === text);
    // Same vocabulary as the graph cards / the app's prompt editor: a placeholder still present
    // after sample-value resolution is by construction unresolved → amber; tool = sky; tag = emerald.
    expect(spanByText('{{never_resolves}}')?.className).toContain('text-amber-900');
    expect(spanByText(toolName)?.className).toContain('text-sky-800');
    expect(spanByText('<rules>')?.className).toContain('text-emerald-800');
  });

  it('shows assembled metrics and a read-only compact AI interpretation with comparable savings', async () => {
    const created = createBlankPromptDesign({ id: 'compact-brief', title: 'Compact Brief' });
    const authored = authoredPromptRootsFromHeads(
      new Map([
        ['compact-brief', created.text],
        [promptDesignProviderKey('compact-brief'), serializePromptDesign(created.design)],
      ]),
    ).roots[0];
    if (!authored) throw new Error('authored prompt missing');
    const meta = document.createElement('meta');
    meta.name = 'studio-token';
    meta.content = 'test-token';
    document.head.appendChild(meta);
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, compactText: 'Describe the responsibility.', model: 'glm-5.3' }),
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<FinalPromptPanel root={authored} text={created.text} onClose={() => {}} />);
    });
    expect(document.querySelector('[data-testid="final-prompt-metrics"]')?.textContent).toContain('UTF-8 bytes');
    expect(document.querySelector('[data-testid="final-prompt-metrics"]')?.textContent).toContain('≈');

    await act(async () => {
      document
        .querySelector('[data-testid="compact-interpretation-run"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="compact-interpretation-result"]')?.textContent).toBe(
      'Describe the responsibility.',
    );
    expect(document.querySelector('[data-testid="compact-interpretation-comparison"]')?.textContent).toContain(
      'estimated tokens',
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      mode: 'compact',
      promptKey: 'compact-brief',
      text: created.text,
    });
  });
});
