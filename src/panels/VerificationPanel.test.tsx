// @module-tag dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRootCatalog, type CatalogRoot } from '../catalog/root-catalog';
import { withPromptStructure } from '../design/prompt-design-project';
import { starterCatalog, SUPPORT_TRIAGE_TEXT, supportTriageRoot } from '../test-fixtures/starter-catalog';
import {
  canVerifyRoot,
  primaryEditableKeyFor,
  runRootVerification,
  VerificationPanel,
  verifyDisabledReason,
} from './VerificationPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** Flushes the microtask queue enough times for a `requestSemanticVerification` round trip
 *  (token read -> fetch -> json()) to settle and its `setState` calls to land. */
async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

/** The starter project's Support Triage prompt, structured from its saved design as the editor does. */
function supportTriage(text = SUPPORT_TRIAGE_TEXT): CatalogRoot {
  return withPromptStructure(supportTriageRoot(), text);
}

/** The Support Triage text without its required `{{customer_message}}` placeholder. */
function brokenSupportTriageText(): string {
  return SUPPORT_TRIAGE_TEXT.replaceAll('{{customer_message}}', '');
}

/** A manifest document with the given editable keys (verification is decided from these keys). */
function documentWithKeys(id: string, editableKeys: string[]): CatalogRoot {
  const manifest = {
    catalog: {
      source: 'explicit',
      documents: [{ id, title: id, source: { kind: 'file', path: `${id}.md` }, editableKeys }],
    },
  };
  return buildRootCatalog(undefined, manifest as never, new Map([[`${id}.md`, 'Text.']]))[0];
}

function selectAiScope(result: NonNullable<ReturnType<typeof runRootVerification>>): void {
  const section = result.sections.find((section) => section.profile.principles.length > 0);
  if (!section) throw new Error('Fixture needs an AI-review section');
  const select = document.querySelector<HTMLSelectElement>('[aria-label="Verification section"]');
  if (!select) throw new Error('Missing scope selector');
  act(() => {
    select.value = section.sectionId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document
      .querySelector<HTMLElement>('[role="tab"][data-state][id$="trigger-ai"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

describe('primaryEditableKeyFor / canVerifyRoot', () => {
  it("picks the editable key matching the root's own id ('support-triage', not 'tone')", () => {
    // Given: a document whose keys include its own id after another key
    // When / Then: its own id wins
    expect(primaryEditableKeyFor(documentWithKeys('support-triage', ['tone', 'support-triage']))).toBe(
      'support-triage',
    );
  });

  it('falls back to the first editable key when none matches the id', () => {
    // Given / When / Then: no key matches the id, so the first key is used
    expect(primaryEditableKeyFor(documentWithKeys('release-notes', ['changes', 'style']))).toBe('changes');
  });

  it('uses the canonical profile for a migrated root even when the legacy inventory has no editable key', () => {
    // Given: Support Triage, verified from its saved design, declares no editable keys
    const root = supportTriage();
    // Then: there is no primary key, yet the root is verifiable
    expect(primaryEditableKeyFor(root)).toBeUndefined();
    expect(canVerifyRoot(root)).toBe(true);
  });
});

describe('verifyDisabledReason', () => {
  it('is undefined (enabled) for a verifiable constant root', () => {
    // Given / When / Then: the structured Support Triage prompt can be verified
    expect(verifyDisabledReason(supportTriage())).toBeUndefined();
  });

  it('enables a canonical migrated root even when its legacy inventory has no editable key', () => {
    // Given: a root with a verification profile and no editable keys
    const root = supportTriage();
    expect(root.entry.editableKeys).toHaveLength(0);
    // Then: Verify is enabled
    expect(verifyDisabledReason(root)).toBeUndefined();
  });

  it('explains when no root is selected at all', () => {
    // Given / When / Then: no root, so the reason asks for one
    expect(verifyDisabledReason(undefined)).toMatch(/select a prompt root/i);
  });
});

describe('runRootVerification', () => {
  it('is valid (no findings) for the pristine Support Triage prompt', () => {
    // Given / When: the pristine prompt is verified
    const result = runRootVerification(supportTriage(), SUPPORT_TRIAGE_TEXT);
    // Then: no findings, with the design's principles reported
    expect(result).not.toBeNull();
    expect(result?.state).toBe('valid');
    expect(result?.findings).toEqual([]);
    expect(result?.principles.length).toBeGreaterThan(0);
  });

  it('produces findings for a deliberately broken doc (a required placeholder removed)', () => {
    // Given: the prompt without its required placeholder
    const broken = brokenSupportTriageText();
    // When: it is verified
    const result = runRootVerification(supportTriage(broken), broken);
    // Then: findings make it invalid
    expect(result).not.toBeNull();
    expect(result?.findings.length).toBeGreaterThan(0);
    expect(result?.state).not.toBe('valid');
  });

  it('returns null for a root with no registered verification profile', () => {
    // Given: a starter prompt with no saved design
    const nonVerifiable = starterCatalog().find((root) => root.loadability === 'constant' && !canVerifyRoot(root));
    expect(nonVerifiable).toBeTruthy();
    // When / Then: nothing to run
    if (nonVerifiable) expect(runRootVerification(nonVerifiable, 'anything')).toBeNull();
  });

  it('runs a section profile against its exact tagged body and retains the canonical section id', () => {
    // Given: the Customer Message section loses the placeholder its section profile requires
    const broken = brokenSupportTriageText();

    // When: the prompt is verified
    const result = runRootVerification(supportTriage(broken), broken);
    const finding = result?.findings.find(
      (candidate) =>
        candidate.source === 'deterministic' && candidate.ruleId === 'required-placeholder:customer_message',
    );

    // Then: the finding names that section and its profile, and the section maps to a canvas node
    expect(finding).toMatchObject({
      scope: 'section',
      sectionId: 'support-triage.customer_message',
      profile: { id: 'support-triage.customer_message.verification', version: 1 },
    });
    expect(result?.sectionNodeIds['support-triage.customer_message']).toBeTruthy();
  });
});

describe('VerificationPanel', () => {
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
  });

  it('keeps scope and view navigation ahead of result provenance', () => {
    // Given / When: the panel renders a verified Support Triage result
    const catalogRoot = supportTriage();
    const result = runRootVerification(catalogRoot, SUPPORT_TRIAGE_TEXT);
    act(() => root.render(<VerificationPanel root={catalogRoot} result={result} onClose={() => {}} />));
    // Then: the scope tabs come before the result summary
    const tabs = container.querySelector('[role="tablist"]')!;
    const summary = container.querySelector('[aria-label="Verification summary"]')!;
    expect(tabs.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the automatic result and scoped criteria and closes via Close', () => {
    // Given: a verified pristine Support Triage result
    let closed = false;
    const catalogRoot = supportTriage();
    const result = runRootVerification(catalogRoot, SUPPORT_TRIAGE_TEXT);

    // When: the panel renders and the Mission scope (which has an AI principle) is chosen

    act(() => {
      root.render(<VerificationPanel root={catalogRoot} result={result} onClose={() => (closed = true)} />);
    });

    if (!result) throw new Error('Missing verification result');
    selectAiScope(result);
    // Then: the deterministic result, the idle AI review, the section rules and principles show
    expect(document.querySelector('[data-testid="verification-drawer"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="verification-node"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="verification-node-state"]')?.textContent).toBe('valid');
    // Semantic review is opt-in: mounting the panel never triggers it, so it starts idle.
    expect(document.querySelector('[data-testid="semantic-review-idle"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="semantic-review-run"]')?.textContent).toBe('Run AI review');
    expect(document.querySelector('[aria-label="Verification section"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Section rules"]')?.textContent).toContain('Contains instructions');

    const principlesTab = [...document.querySelectorAll('[role="tab"]')].find(
      (candidate) => candidate.textContent === 'Checks & criteria',
    );
    act(() => {
      principlesTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(document.querySelector('[aria-label="Section principles"]')?.textContent).toContain('platform · read-only');
    expect(document.querySelector('[aria-label="Section principles"]')?.textContent).toContain(
      'Wording may change; the no-promises rule may not.',
    );

    const closeButton = document.querySelector('[aria-label="Close"]');
    expect(closeButton?.textContent?.trim()).toBe('');
    expect(closeButton?.querySelector('svg')).toBeTruthy();
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(closed).toBe(true);
  });

  it('shows a fallback message when result is null', () => {
    // Given / When: the panel renders without a result; Then: it says checks have not run
    const catalogRoot = supportTriage();
    act(() => {
      root.render(<VerificationPanel root={catalogRoot} result={null} onClose={() => {}} />);
    });
    expect(document.querySelector('[data-testid="verification-node-state"]')).toBeNull();
    expect(document.body.textContent).toContain('Checks have not run for the current source');
  });
});

describe('VerificationPanel semantic review', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    setStudioToken();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    clearStudioToken();
    vi.unstubAllGlobals();
  });

  function renderWithBrokenPrompt(): void {
    // Deliberately broken doc so deterministic findings are non-empty — proves the semantic
    // layer's state transitions never hide or block the deterministic result.
    const broken = brokenSupportTriageText();
    const catalogRoot = supportTriage(broken);
    const result = runRootVerification(catalogRoot, broken);
    act(() => {
      root.render(<VerificationPanel root={catalogRoot} result={result} onClose={() => {}} />);
    });
    if (!result) throw new Error('Missing verification result');
    selectAiScope(result);
    expect(document.querySelector('[data-testid="verification-node-state"]')?.textContent).not.toBe('valid');
  }

  async function clickRun(): Promise<void> {
    const button = document.querySelector('[data-testid="semantic-review-run"]') as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushMicrotasks();
    });
  }

  it('shows a loading state immediately after Run is clicked, disabling the button', async () => {
    renderWithBrokenPrompt();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})), // never resolves — freezes on the loading state
    );

    const button = document.querySelector('[data-testid="semantic-review-run"]') as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[data-testid="semantic-review-loading"]')).toBeTruthy();
    expect(button.disabled).toBe(true);
    // Deterministic findings are untouched by the in-flight semantic call.
    expect(document.querySelector('[data-testid="verification-node"]')).toBeTruthy();
  });

  it('renders results with semantic findings visually distinguished (AI badge) from deterministic ones', async () => {
    renderWithBrokenPrompt();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          model: 'claude-test-model',
          findings: [
            {
              source: 'semantic',
              profile: { id: 'support-triage.mission.verification', version: 1 },
              principleId: 'support-triage.mission.no-promises',
              severity: 'error',
              message: 'The mission no longer forbids promising refunds.',
              evidenceQuote: 'propose the next step',
              proposedCorrection: 'Restore the rule against promising refunds, dates, or fixes.',
              scope: 'section',
              sectionId: 'support-triage.mission',
            },
          ],
        }),
      ),
    );

    await clickRun();

    expect(document.querySelector('[data-testid="semantic-review-results"]')).toBeTruthy();
    expect(document.body.textContent).toContain('Reviewed by claude-test-model');
    const findingRow = document.querySelector('[data-testid="semantic-finding"]');
    expect(findingRow?.textContent).toContain('AI · error');
    expect(findingRow?.textContent).toContain('The mission no longer forbids promising refunds');
    // Deterministic findings (rendered inside VerificationNode) still present alongside.
    expect(document.querySelector('[data-testid="verification-node"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="verification-node"]')?.textContent).not.toContain(
      'The mission no longer forbids promising refunds',
    );
  });

  it('renders an informational (non-error) message for the 503 unavailable state, deterministic findings intact', async () => {
    renderWithBrokenPrompt();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false, error: 'Verification is unavailable.' }, 503)),
    );

    await clickRun();

    const unavailable = document.querySelector('[data-testid="semantic-review-unavailable"]');
    expect(unavailable).toBeTruthy();
    expect(unavailable?.getAttribute('role')).toBe('note');
    expect(unavailable?.textContent).toContain('No AI provider key is configured');
    // Never leaks the raw server error string.
    expect(document.body.textContent).not.toContain('Verification is unavailable.');
    expect(document.querySelector('[data-testid="verification-node"]')).toBeTruthy();
  });

  it('renders the budget-exhausted message for a 429, deterministic findings intact', async () => {
    renderWithBrokenPrompt();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false, error: 'Verification budget exhausted for this session.' }, 429)),
    );

    await clickRun();

    const budget = document.querySelector('[data-testid="semantic-review-budget-exhausted"]');
    expect(budget).toBeTruthy();
    expect(budget?.textContent).toContain('used its semantic-review budget');
    expect(document.body.textContent).not.toContain('Verification budget exhausted for this session.');
    expect(document.querySelector('[data-testid="verification-node"]')).toBeTruthy();
  });

  it('renders a generic failed message for a 502, deterministic findings intact', async () => {
    renderWithBrokenPrompt();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse({ ok: false, error: 'Verification failed.' }, 502)),
    );

    await clickRun();

    const failed = document.querySelector('[data-testid="semantic-review-failed"]');
    expect(failed).toBeTruthy();
    expect(failed?.getAttribute('role')).toBe('alert');
    expect(document.body.textContent).not.toContain('Verification failed.');
    expect(document.querySelector('[data-testid="verification-node"]')).toBeTruthy();
  });

  it('treats a network rejection as the generic failed state rather than throwing or hanging', async () => {
    renderWithBrokenPrompt();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await clickRun();

    expect(document.querySelector('[data-testid="semantic-review-failed"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="verification-node"]')).toBeTruthy();
  });

  it('sends the studio token header on the request', async () => {
    renderWithBrokenPrompt();
    const fetchMock = vi.fn<typeof fetch>(async () => fakeResponse({ ok: true, model: 'm', findings: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await clickRun();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)[STUDIO_TOKEN_HEADER]).toBe('test-token');
  });
});
