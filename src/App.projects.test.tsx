// @module-tag dom
import { expect, it, vi } from 'vitest';
import { appTests } from './App.test-harness';
import { buildProjectArchive } from './export/project-archive';
import { STORAGE_KEY_PREFIX } from './registry/registry-persistence';
import { SUPPORT_TRIAGE_ID, SUPPORT_TRIAGE_TEXT } from './test-fixtures/starter-catalog';
import { SimpleHistoryProvider } from './vcs/simple-history-provider';
import { MemorySnapshotStore } from './vcs/snapshot-store';

appTests((harness) => {
  const {
    byTestId,
    queryByTestId,
    findButtonByAccessibleName,
    click,
    setInputValue,
    findInputByAccessibleName,
    editInUndeclaredPlaceholder,
    importFile,
    verificationMarkedCards,
    pressEscape,
    flushUntil,
    settleHistoryWrites,
    renderBootedApp,
    starterRootTestId,
    createProject,
    switchToProject,
    historyRows,
  } = harness;

  it('a third-party manifest drives the whole catalog — other roots absent (universal editor, ADR-235)', async () => {
    // Given: the bridge serves a third-party manifest. The boot fetches the ACTIVE manifest from
    // /__studio/manifest (token-gated), and its explicit catalog must REPLACE every other catalog —
    // the studio is a universal editor for any prompt tree. Until this landed the SPA hardcoded
    // DEFAULT_MANIFEST, so a third-party manifest widened the bridge but the sidebar ignored it.
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'studio-token');
    meta.setAttribute('content', 'test-token');
    document.head.appendChild(meta);
    const greeterText = '# Greeter\n\n<greeting>\nHello from the vendor tree.\n</greeting>\n';
    const thirdPartyManifest = {
      schemaVersion: 1,
      name: 'third-party',
      contentRoots: ['vendor/prompts'],
      skillsRoot: 'vendor/skills',
      exportRoot: 'vendor/prompts',
      catalog: {
        source: 'explicit',
        documents: [
          {
            id: 'greeter',
            title: 'Greeter',
            group: 'prompts',
            source: { kind: 'file', path: 'vendor/prompts/greeter.md' },
          },
        ],
      },
      baselines: [
        {
          id: 'default',
          label: 'Default',
          description: 'The vendor prompt set.',
          positioning: 'shipped',
          source: { kind: 'shipped' },
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost');
        if (url.pathname === '/__studio/manifest') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, manifest: thirdPartyManifest }),
          } as unknown as Response;
        }
        if (url.pathname === '/__studio/file' && url.searchParams.get('path') === 'vendor/prompts/greeter.md') {
          return { ok: true, status: 200, json: async () => ({ ok: true, text: greeterText }) } as unknown as Response;
        }
        if (url.pathname === '/__studio/list') {
          return { ok: true, status: 200, json: async () => ({ ok: true, entries: [] }) } as unknown as Response;
        }
        return { ok: false, status: 404, json: async () => ({ ok: false }) } as unknown as Response;
      }),
    );
    try {
      // When: the studio boots
      await renderBootedApp();

      // Then: only the vendor document is listed — the starter project's prompts are not appended
      await flushUntil(() => queryByTestId('prompt-root-greeter') !== null);
      expect(queryByTestId(starterRootTestId)).toBeNull();

      // The vendor document loads and renders like any constant root.
      click(byTestId('prompt-root-greeter'));
      await settleHistoryWrites();
      expect(document.body.textContent).toContain('Hello from the vendor tree.');
      expect(queryByTestId('dirty-chip')).toBeNull();
    } finally {
      meta.remove();
      vi.unstubAllGlobals();
    }
  });

  // The per-project declaration round trip is proven in two tests that meet at the persisted key:
  // the first declares through the drawer and locks the key it writes, the second seeds that same
  // key and proves projects read it in isolation. One test doing both drove ~13 full-studio renders
  // (~300 ms each under happy-dom; no timer or I/O wait) and crossed the 15 s budget on a loaded
  // shared runner (main, 2026-11-04); each half now costs about what its siblings do.
  it('declares a session variable through the drawer and stores it under the project-scoped v1 key', async () => {
    // Given: Support Triage's Mission body uses a placeholder no registry declares, and its history write settled.
    await renderBootedApp();
    editInUndeclaredPlaceholder();
    await settleHistoryWrites();

    // When: the Default project's Salir user declares it through the status bar → Variables drawer.
    click(byTestId('status-undeclared-count'));
    click(findButtonByAccessibleName(byTestId('undeclared-section'), 'Declare {{not_declared_anywhere}}…'));
    setInputValue(findInputByAccessibleName(document.body, 'Purpose'), 'Scoped to the Default project.');
    click(findButtonByAccessibleName(document.body, 'Declare variable'));

    // Then: declaring through the drawer clears the undeclared finding in the drawer and the status bar
    // (the rule itself, with the verification finding, is proven in use-variables-registry.declare.test.tsx).
    // (the example's own {{company_name}} and {{customer_message}} stay undeclared — no built-in variables ship).
    expect(queryByTestId('declare-variable-error')).toBeNull();
    expect(byTestId('undeclared-section').textContent).not.toContain('not_declared_anywhere');
    pressEscape();
    expect(byTestId('status-undeclared-count').textContent).toContain('2 undeclared');

    // And: the key shape stays v1 — only the root segment is namespaced as `<projectId>:<rootKey>`.
    expect(window.localStorage.getItem(`${STORAGE_KEY_PREFIX}default:support-triage`)).toContain(
      'not_declared_anywhere',
    );
  });

  it('keeps session declarations per project: a new project starts without them, Default keeps them', async () => {
    // Given: a declaration persisted under the Default project's scoped v1 key (the shape and key the
    // drawer writes — locked by the test above), with Support Triage loaded in the Default project.
    window.localStorage.setItem(
      `${STORAGE_KEY_PREFIX}default:support-triage`,
      JSON.stringify({
        declarations: [
          { name: 'not_declared_anywhere', purpose: 'Scoped to the Default project.', sample: '', required: true },
        ],
      }),
    );
    await renderBootedApp();
    click(byTestId(starterRootTestId));
    await settleHistoryWrites();

    // When: a new project B is created and becomes active.
    await createProject('B');

    // Then: B's Support Triage registry carries no session declaration.
    click(findButtonByAccessibleName(document.body, 'Variables'));
    expect(document.querySelector('[data-testid="session-variable-row"]')).toBeNull();
    pressEscape();

    // And: switching back to Default shows the declaration again.
    await switchToProject('Default');
    click(findButtonByAccessibleName(document.body, 'Variables'));
    const sessionRow = document.querySelector('[data-testid="session-variable-row"]');
    expect(sessionRow?.textContent).toContain('not_declared_anywhere');
  });

  it('falls back to pre-project declarations for the Default project (migration shim)', async () => {
    // Given: a declaration saved under the pre-project (bare root) key
    window.localStorage.setItem(
      `${STORAGE_KEY_PREFIX}support-triage`,
      JSON.stringify({
        declarations: [
          { name: 'legacy_var', purpose: 'Declared before projects existed.', sample: '', required: true },
        ],
      }),
    );

    await renderBootedApp();
    // When: Support Triage is opened in the Default project
    click(byTestId(starterRootTestId));
    click(findButtonByAccessibleName(document.body, 'Variables'));

    // Then: the Default project still shows the old declaration
    const sessionRow = document.querySelector('[data-testid="session-variable-row"]');
    expect(sessionRow?.textContent).toContain('legacy_var');
  });

  it('deleting the active project (confirm click) switches to the first remaining; the last project cannot be deleted', async () => {
    await renderBootedApp();
    await createProject('B'); // B is now active alongside Default.

    click(byTestId('project-picker-trigger'));
    const menu = byTestId('project-picker-menu');
    click(findButtonByAccessibleName(menu, 'Delete B'));
    click(findButtonByAccessibleName(menu, 'Confirm delete B'));
    await flushUntil(() => byTestId('project-picker-trigger').textContent?.includes('Default') ?? false);

    // Only Default remains — its Delete action is disabled.
    click(byTestId('project-picker-trigger'));
    expect(findButtonByAccessibleName(byTestId('project-picker-menu'), 'Delete Default').disabled).toBe(true);
  });

  // ── Project archives (ADR-203 decision 5 — ungated save-file export, flavor-detected import) ──

  it('imports a project archive as a new "(imported)" project, switches to it, and loads its head text', async () => {
    // Fabricates a REAL archive with an independent, throwaway `SimpleHistoryProvider` (separate
    // from the App's own booted provider) — `exportArchive`/import only depend on the shared
    // `HistoryProvider` contract, not on which implementation produced the archive, so this test
    // (unlike the ADR-203 integration test) never needs isomorphic-git just to build a fixture.
    // Given: Support Triage carries an edited head, plus one root this build's catalog does not know (skipped).
    const source = new SimpleHistoryProvider({ snapshotStore: new MemorySnapshotStore() });
    await source.init(
      new Map([
        [SUPPORT_TRIAGE_ID, SUPPORT_TRIAGE_TEXT],
        ['mystery-root', 'text for a root this build does not ship'],
      ]),
    );
    await source.createProject('Travelling');
    await source.commit({
      projectId: 'travelling',
      rootKey: SUPPORT_TRIAGE_ID,
      text: SUPPORT_TRIAGE_TEXT.replace(
        'Classify the customer message',
        'ARCHIVE-HEAD-MARKER Classify the customer message',
      ),
      message: 'edit support-triage',
    });
    const { bytes, filename } = await buildProjectArchive(source, 'travelling', 'Travelling');

    await renderBootedApp();
    click(byTestId(starterRootTestId));
    await settleHistoryWrites();

    // When: the archive is imported
    await importFile(
      new File([bytes as BlobPart], filename),
      () => byTestId('project-picker-trigger').textContent?.includes('Travelling (imported)') ?? false,
    );

    // Then: the new project exists, is active, and the selected Support Triage document shows ITS committed head.
    await flushUntil(() => (document.body.textContent ?? '').includes('ARCHIVE-HEAD-MARKER'));
    expect(queryByTestId('edit-error-banner')).toBeNull();

    // Success notice names the project, counts the imported roots, and notes the skipped unknown one.
    const notice = byTestId('import-success-banner');
    expect(notice.textContent).toContain('Imported project "Travelling (imported)"');
    expect(notice.textContent).toContain('1 root');
    expect(notice.textContent).toContain('1 unknown root');
  });

  it('downloads the ungated project archive from the export dialog even while the overlay gate refuses', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => 'blob:prompt-studio-project-archive');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
    try {
      await renderBootedApp();
      editInUndeclaredPlaceholder(); // Refuses the overlay gate — the archive button must not care.
      await settleHistoryWrites();

      click(findButtonByAccessibleName(document.body, 'Export'));
      const dialog = byTestId('export-dialog');
      expect((findButtonByAccessibleName(dialog, 'Export ZIP') as HTMLButtonElement).disabled).toBe(true);

      click(findButtonByAccessibleName(dialog, 'Project archive'));
      await flushUntil(() => queryByTestId('export-dialog') === null);

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:prompt-studio-project-archive');
      expect(queryByTestId('edit-error-banner')).toBeNull();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('enables History only for a loaded constant root and opens the drawer with the baseline seed row', async () => {
    await renderBootedApp();
    expect((findButtonByAccessibleName(document.body, 'History') as HTMLButtonElement).disabled).toBe(true);
    expect(findButtonByAccessibleName(document.body, 'History').getAttribute('title')).toMatch(/load a prompt root/i);

    click(byTestId(starterRootTestId));
    await settleHistoryWrites();
    expect((findButtonByAccessibleName(document.body, 'History') as HTMLButtonElement).disabled).toBe(false);

    click(findButtonByAccessibleName(document.body, 'History'));
    expect(byTestId('history-drawer')).toBeTruthy();
    await flushUntil(() => historyRows().length > 0);

    // A pristine Default project has exactly Support Triage's baseline seed commit — newest, hence current:
    // its Restore is disabled because restoring the current text would only add a no-op commit.
    const rows = historyRows();
    expect(rows[0].textContent).toContain('baseline');
    const restoreButton = rows[0].querySelector('button') as HTMLButtonElement;
    expect(restoreButton.disabled).toBe(true);
    expect(restoreButton.getAttribute('title')).toBe('Already the current text');

    pressEscape();
    expect(queryByTestId('history-drawer')).toBeNull();
  });

  it('lists an edit commit newest and restores the baseline through the transactional write path', async () => {
    await renderBootedApp();
    editInUndeclaredPlaceholder();
    await settleHistoryWrites();
    expect(queryByTestId('dirty-chip')).toBeTruthy();

    // Plant verification borders so the restore's staleness guard has something to clear.
    click(findButtonByAccessibleName(document.body, 'Verify'));
    expect(verificationMarkedCards()).toHaveLength(1);
    pressEscape();

    click(findButtonByAccessibleName(document.body, 'History'));
    await flushUntil(() => historyRows().length >= 2);
    let rows = historyRows();
    expect(rows[0].textContent).toContain('edit Mission');
    expect((rows[0].querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    const baselineRow = rows[rows.length - 1];
    expect(baselineRow.textContent).toContain('baseline');

    click(baselineRow.querySelector('button') as HTMLButtonElement);
    // Dirty chip = "differs from the shipped baseline" — restoring the baseline makes it disappear.
    await flushUntil(() => queryByTestId('dirty-chip') === null);
    expect(document.body.textContent).not.toContain('not_declared_anywhere');

    // Staleness guard: the restore went through replaceDocumentText, clearing the Verify run.
    expect(verificationMarkedCards()).toHaveLength(0);
    expect(queryByTestId('status-verification-count')).toBeNull();

    // Append-only history (ADR-203): the restore is itself a commit — newest, disabled as current.
    await flushUntil(() => historyRows()[0]?.textContent?.includes('restore ') ?? false);
    rows = historyRows();
    expect(rows).toHaveLength(3);
    expect((rows[0].querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect((rows[0].querySelector('button') as HTMLButtonElement).getAttribute('title')).toBe(
      'Already the current text',
    );
  });
});
