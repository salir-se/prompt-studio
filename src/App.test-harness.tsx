// @module-tag dom
/** Real App/xyflow/history setup, shared without mocking the canvas or persistence. Each suite owns its DOM, IndexedDB, spies, cancellation signal and seeded history snapshot. Pending commits drain before teardown. */
import { consoleBuffer } from '@prompt-studio/observability/test';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, type MockInstance, vi } from 'vitest';
import { App } from './App';
import { APP_UI_WAIT_MS } from './app-wait-budget';
import {
  STARTER_FILE_TEXTS,
  STARTER_MANIFEST,
  starterCatalog,
  SUPPORT_TRIAGE_ID,
} from './test-fixtures/starter-catalog';
import { providerKeyFor } from './vcs/provider-keys';
import { SIMPLE_HISTORY_SNAPSHOT_KEY, SimpleHistoryProvider } from './vcs/simple-history-provider';
import { MemorySnapshotStore } from './vcs/snapshot-store';

// Silences React's "not configured to support act(...)" warning — this file drives `act()` directly
// (no `@testing-library/react`, see the module doc above), so nothing else sets this flag for us.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// See the module doc above — xyflow needs both to compute node/edge geometry under happy-dom.
class StubResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

// ── Query/interaction helpers (a minimal stand-in for @testing-library/dom, not a dependency here) ──

function byTestId(testId: string): HTMLElement {
  const el = document.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`No element found for data-testid="${testId}"`);
  return el as HTMLElement;
}

function queryByTestId(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

function findArticleByLabel(label: string): HTMLElement {
  const match = Array.from(document.querySelectorAll('article')).find((el) => el.getAttribute('aria-label') === label);
  if (!match) throw new Error(`No <article aria-label="${label}"> found`);
  return match;
}

/** Matches a button by its accessible name — `aria-label` when present, else trimmed text content. */
function findButtonByAccessibleName(root: ParentNode, name: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button')).find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === name,
  );
  if (!match) throw new Error(`No <button> with accessible name "${name}" found under given root`);
  return match as HTMLButtonElement;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function findInputByAccessibleName(root: ParentNode, name: string): HTMLInputElement {
  const match = Array.from(root.querySelectorAll('input')).find((input) => input.getAttribute('aria-label') === name);
  if (!match) throw new Error(`No <input aria-label="${name}"> found under given root`);
  return match as HTMLInputElement;
}

/** The sidebar row of the starter project's Support Triage prompt (the loaded document most tests edit). */
const STARTER_ROOT_TEST_ID = `prompt-root-${SUPPORT_TRIAGE_ID}`;

/**
 * A fake local bridge serving the starter project (`examples/starter`): its explicit manifest at
 * `/__studio/manifest`, its prompt files at `/__studio/file`, and an empty skills listing. Anything else is a 404,
 * which every bridge client degrades from.
 */
function starterBridgeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const json = (status: number, body: unknown) =>
      ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
    if (url.pathname === '/__studio/manifest') return json(200, { ok: true, manifest: STARTER_MANIFEST });
    if (url.pathname === '/__studio/file') {
      const text = STARTER_FILE_TEXTS.get(url.searchParams.get('path') ?? '');
      return text === undefined ? json(404, { ok: false }) : json(200, { ok: true, text });
    }
    if (url.pathname === '/__studio/list') return json(200, { ok: true, entries: [] });
    return json(404, { ok: false });
  });
}

/** Appends `{{not_declared_anywhere}}` to Support Triage's "Mission" section body via the real edit dialog. */
function editInUndeclaredPlaceholder(): void {
  click(byTestId(STARTER_ROOT_TEST_ID));
  const missionCard = findArticleByLabel('Mission');
  click(findButtonByAccessibleName(missionCard, 'Edit section'));
  const textarea = document.querySelector('textarea[aria-label="Mission markdown"]') as HTMLTextAreaElement;
  setTextareaValue(textarea, `${textarea.value} {{not_declared_anywhere}}`);
  click(findButtonByAccessibleName(document.body, 'Apply'));
}

/**
 * CI shard-1 environment defect guard (unreproducible locally as of 65d20a2's investigation): on the
 * self-hosted quality runner — and ONLY there — this file's happy-dom window intermittently arrives
 * with `window.localStorage === undefined`, crashing every `beforeEach` and redlining the shard. The
 * suite passes standalone, under vitest.monorepo.ts filtered AND unfiltered (30k tests), and under
 * the exact `--shard=1/3` command locally; happy-dom 20.10.1 (single version repo-wide) initializes
 * the storage slot unconditionally in its constructor and never tears it down, so the mechanism is
 * unknown. This guard (a) prints a one-shot diagnostic rich enough to identify what `window` really
 * is when it happens, and (b) installs a minimal in-memory Storage so the 36 tests keep asserting
 * real behavior instead of cascading TypeErrors. Loud by design — never a silent mask; remove once
 * the CI runner defect is understood and fixed.
 */
function ensureLocalStorage(): void {
  if (typeof window !== 'undefined' && window.localStorage !== undefined) return;

  const w = window as unknown as Record<string, unknown> & { localStorage?: Storage };
  console.error('[env-diagnostic] window.localStorage is undefined — broken test environment', {
    windowType: typeof window,
    windowIsGlobalThis: (globalThis as unknown) === (window as unknown),
    windowCtor: window?.constructor?.name,
    protoChain: (() => {
      const names: string[] = [];
      for (let p = Object.getPrototypeOf(window); p && names.length < 5; p = Object.getPrototypeOf(p)) {
        names.push(p.constructor?.name ?? '<anon>');
      }
      return names;
    })(),
    ownDescriptor: Object.getOwnPropertyDescriptor(window, 'localStorage') ?? null,
    happyDomMarker: 'happyDOM' in window,
    sessionStorageType: typeof window.sessionStorage,
    ci: typeof process !== 'undefined' ? process.env.CI : undefined,
  });

  const backing = new Map<string, string>();
  const polyfill: Storage = {
    get length() {
      return backing.size;
    },
    clear: () => backing.clear(),
    getItem: (key: string) => (backing.has(key) ? (backing.get(key) as string) : null),
    key: (index: number) => [...backing.keys()][index] ?? null,
    removeItem: (key: string) => {
      backing.delete(key);
    },
    setItem: (key: string, value: string) => {
      backing.set(key, String(value));
    },
  };
  Object.defineProperty(w, 'localStorage', { configurable: true, value: polyfill });
  if ((globalThis as { localStorage?: Storage }).localStorage === undefined) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: polyfill });
  }
}
function createHarness() {
  let container: HTMLDivElement;

  let root: Root;

  let testSignal: AbortSignal;

  let commitSpy: MockInstance<SimpleHistoryProvider['commit']>;

  let persistSpy: MockInstance<SimpleHistoryProvider['persist']>;

  const realCommit = SimpleHistoryProvider.prototype.commit;

  const originalResizeObserver = globalThis.ResizeObserver;

  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  let seededHistorySnapshot: string;

  let servesStarterProject = false;

  beforeAll(async () => {
    const store = new MemorySnapshotStore();
    const provider = new SimpleHistoryProvider({ snapshotStore: store });
    const texts = new Map<string, string>();
    for (const catalogRoot of starterCatalog()) {
      if (catalogRoot.loadability === 'constant') {
        texts.set(providerKeyFor(catalogRoot.id), catalogRoot.text ?? '');
      } else if (catalogRoot.loadability === 'resolver-variants') {
        for (const variant of catalogRoot.variants ?? []) {
          texts.set(providerKeyFor(catalogRoot.id, variant.symbol), variant.text);
        }
      }
    }
    await provider.init(texts);
    await provider.createProject('Default');
    await provider.persist();
    const snapshot = await store.load(SIMPLE_HISTORY_SNAPSHOT_KEY);
    if (snapshot === null) throw new Error('Failed to seed the App test history snapshot.');
    seededHistorySnapshot = snapshot;
  });

  beforeEach(({ signal }) => {
    testSignal = signal;
    commitSpy = vi.spyOn(SimpleHistoryProvider.prototype, 'commit');
    persistSpy = vi.spyOn(SimpleHistoryProvider.prototype, 'persist');
    globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 200 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 40 });

    // A brand-new `fake-indexeddb` factory every test: `IndexedDbSnapshotStore` (see
    // `vcs/snapshot-store.ts`) now exercises its REAL save/load path instead of the "no indexedDB in
    // this environment" degrade path that used to fire a `console.warn` on every history commit —
    // still with a guaranteed-empty database per test, since each test gets its own factory instance.
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });

    // Theme state is read from/written to real `localStorage`/`document.documentElement` — reset both
    // so no test's toggle leaks into another's initial-load assertions.
    ensureLocalStorage();
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    // Drain the ADR-203 history provider's boot/heads/commit promise chains inside act BEFORE
    // unmounting: synchronous tests never yield to the microtask queue, so the provider boot kicked
    // off on mount would otherwise settle between test and teardown and trip React's
    // not-wrapped-in-act warning. Two rounds: boot's setHistory, then the heads effect it triggers.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.querySelector('meta[name="studio-workspace"]')?.remove();
    document.querySelector('meta[name="studio-token"][content="starter-test-token"]')?.remove();

    globalThis.ResizeObserver = originalResizeObserver;
    if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);

    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    expect(
      consoleBuffer.entries.filter((entry) =>
        entry.args.some((arg) => typeof arg === 'string' && arg.includes('overlapping act()')),
      ),
    ).toEqual([]);
  });

  /**
   * Renders the app against the FAST fake history provider by default (see this file's module doc)
   * — every test except the one designated ADR-203 integration test renders through this helper.
   * A fresh `MemorySnapshotStore()` per call means no test's history state can leak into another's.
   */
  function renderApp(): void {
    // A test that stubs `fetch` itself owns the bridge; every other test opens the starter project through the
    // fake bridge, exactly as the studio opens a person's prompt folder.
    servesStarterProject = !vi.isMockFunction(globalThis.fetch);
    if (servesStarterProject) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'studio-token');
      meta.setAttribute('content', 'starter-test-token');
      document.head.appendChild(meta);
      vi.stubGlobal('fetch', starterBridgeFetch());
    }
    // Restore the same pristine persisted baseline into an isolated store instead of hashing the
    // unchanged shipped catalog again for every full-App render.
    const snapshotStore = new MemorySnapshotStore();
    void snapshotStore.save(SIMPLE_HISTORY_SNAPSHOT_KEY, seededHistorySnapshot);
    act(() => {
      root.render(<App historyProviderKind="simple" snapshotStore={snapshotStore} />);
    });
  }

  // ── Section structure actions (ADR-202 §3 — each is a text edit) ──────────

  function queryArticleByLabel(label: string): HTMLElement | undefined {
    return Array.from(document.querySelectorAll('article')).find((el) => el.getAttribute('aria-label') === label);
  }

  // ── ZIP export/import (Stage C top-bar wiring — export gate dialog, blueprint import) ──

  /** Drives the hidden import input with `file` — Import button click, then a change event. */
  async function importFile(file: File, settled: () => boolean): Promise<void> {
    click(findButtonByAccessibleName(document.body, 'Import'));
    const input = byTestId('import-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushUntil(settled);
  }

  // ── Canvas verification borders + staleness guard (ADR-202 Stage D wiring) ──

  /** Every canvas section card currently carrying a verification border (`FragmentNode`'s attribute). */
  function verificationMarkedCards(): HTMLElement[] {
    return Array.from(document.querySelectorAll('article[data-verification-state]'));
  }

  function pressEscape(): void {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
  }

  // ── Prompt projects (ADR-203 Stage C2 — HistoryProvider boot, auto-commit, ProjectPicker) ──
  //
  // Every test in this section (and the "History drawer" section below) renders through
  // `renderApp()`'s default: `SimpleHistoryProvider` + a fresh `MemorySnapshotStore()` — real,
  // dependency-free, in-memory production code, not a mock, and behaviorally identical to the git
  // provider by shared contract (see this file's module doc). History behavior is asserted through
  // the UI end to end — an edit committed in one project must survive switching away and back,
  // while a project forked from the baseline must not see it — exactly as it would against git.
  //
  // The ONE test that boots the REAL 'auto' provider (try git, degrade to simple with the amber
  // banner) is the "ADR-203 integration test" a few tests down. `probeGitProvider()` (used only by
  // that test) asks the same question the factory does, once, so the assertion matches whichever
  // mode this environment actually yields.

  /**
   * Wait for the UI under the test's own budget (`APP_UI_WAIT_MS`, just short of Vitest's 15 s timeout), so a slow
   * boot on a loaded runner is not a failure; the test signal still stops the act loop before teardown.
   */
  async function flushUntil(condition: () => boolean, timeout = APP_UI_WAIT_MS): Promise<void> {
    const signal = testSignal;
    const deadline = Date.now() + timeout;
    while (!condition() && Date.now() < deadline) {
      signal.throwIfAborted();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    expect(condition()).toBe(true);
  }

  /** Await real writes: WebCrypto completion is not bounded by event-loop tick counts. */
  async function settleHistoryWrites(): Promise<void> {
    await act(async () => {
      await Promise.all(commitSpy.mock.results.map((result) => result.value));
      await Promise.all(persistSpy.mock.results.map((result) => result.value));
    });
  }

  /**
   * Renders the App and waits for the history provider boot (picker present = booted). The boot loads the starter
   * manifest and its prompt files before the provider lands, so a booted App already lists Support Triage.
   */
  async function renderBootedApp(): Promise<void> {
    renderApp();
    await flushUntil(() => queryByTestId('project-picker-trigger') !== null);
    if (servesStarterProject) await flushUntil(() => queryByTestId(STARTER_ROOT_TEST_ID) !== null);
  }

  /** Renders the booted App and opens the starter project's Support Triage prompt. */
  async function renderStarterPrompt(): Promise<void> {
    await renderBootedApp();
    click(byTestId(STARTER_ROOT_TEST_ID));
  }

  /** Applies an edit appending `marker` to Support Triage's "Mission" body via the real edit dialog. */
  function applyMissionEdit(marker: string): void {
    const missionCard = findArticleByLabel('Mission');
    click(findButtonByAccessibleName(missionCard, 'Edit section'));
    const textarea = document.querySelector('textarea[aria-label="Mission markdown"]') as HTMLTextAreaElement;
    setTextareaValue(textarea, `${textarea.value} ${marker}`);
    click(findButtonByAccessibleName(document.body, 'Apply'));
  }

  /** Creates a project through the picker's inline form and waits until the App switched to it. */
  async function createProject(name: string): Promise<void> {
    click(byTestId('project-picker-trigger'));
    const menu = byTestId('project-picker-menu');
    click(findButtonByAccessibleName(menu, 'New configuration'));
    setInputValue(findInputByAccessibleName(menu, 'Configuration name'), name);
    click(findButtonByAccessibleName(menu, 'Create configuration'));
    await flushUntil(() => byTestId('project-picker-trigger').textContent?.includes(name) ?? false);
  }

  /** Switches the active project through the picker's project list and waits for the switch. */
  async function switchToProject(name: string): Promise<void> {
    click(byTestId('project-picker-trigger'));
    click(findButtonByAccessibleName(byTestId('project-picker-menu'), name));
    await flushUntil(() => byTestId('project-picker-trigger').textContent?.includes(name) ?? false);
  }

  /**
   * Probes once whether the git history provider can load and operate in THIS environment — the
   * exact question the App's 'auto' boot answers. Under vitest/node the isomorphic-git + memfs
   * stack is expected to work (its own test suite runs here), so 'auto' should land on git with NO
   * degradation banner; in an environment where the git path breaks, the banner IS the contract.
   * Used only by the integration test directly below.
   */
  async function probeGitProvider(): Promise<boolean> {
    try {
      // Dynamic, not the (removed) static top-level import: keeps isomorphic-git's module cost out
      // of every OTHER test's file-import path — only this one probe (and hence only the ADR-203
      // integration test below) ever pays it.
      const { createGitHistoryProvider } = await import('./vcs/git-history-provider');
      const provider = createGitHistoryProvider(new MemorySnapshotStore());
      await provider.init(new Map([['probe', 'probe text']]));
      return (await provider.heads('baseline')).get('probe') === 'probe text';
    } catch {
      return false;
    }
  }

  // ── History drawer (ADR-203 Stage C2 — HistoryPanel, restore-as-commit) ──

  function historyRows(): HTMLElement[] {
    return Array.from(document.querySelectorAll('[data-testid="history-commit-row"]'));
  }
  return {
    get commitSpy() {
      return commitSpy;
    },
    realCommit,
    get root() {
      return root;
    },
    set root(value: Root) {
      root = value;
    },
    get container() {
      return container;
    },
    byTestId,
    queryByTestId,
    findArticleByLabel,
    findButtonByAccessibleName,
    click,
    setTextareaValue,
    setInputValue,
    findInputByAccessibleName,
    editInUndeclaredPlaceholder,
    renderApp,
    queryArticleByLabel,
    importFile,
    verificationMarkedCards,
    pressEscape,
    flushUntil,
    settleHistoryWrites,
    renderBootedApp,
    renderStarterPrompt,
    starterRootTestId: STARTER_ROOT_TEST_ID,
    applyMissionEdit,
    createProject,
    switchToProject,
    probeGitProvider,
    historyRows,
  };
}
export function appTests(register: (harness: ReturnType<typeof createHarness>) => void) {
  describe('App', () => register(createHarness()));
}
