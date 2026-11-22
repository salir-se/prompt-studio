// @module-tag dom
import { parsePromptTree, serializeBlueprint } from '@prompt-studio/prompts';
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { App } from './App';
import { appTests } from './App.test-harness';
import { bundledBaselineContentSource } from './catalog/baseline-content-source';
import { packZip } from './export/zip';
import { SUPPORT_TRIAGE_ID, SUPPORT_TRIAGE_TEXT } from './test-fixtures/starter-catalog';
import { SimpleHistoryProvider } from './vcs/simple-history-provider';

appTests((harness) => {
  const {
    byTestId,
    queryByTestId,
    findArticleByLabel,
    findButtonByAccessibleName,
    click,
    setTextareaValue,
    setInputValue,
    findInputByAccessibleName,
    editInUndeclaredPlaceholder,
    importFile,
    verificationMarkedCards,
    pressEscape,
    flushUntil,
    settleHistoryWrites,
    renderBootedApp,
    renderStarterPrompt,
    starterRootTestId,
    applyMissionEdit,
    createProject,
    switchToProject,
    probeGitProvider,
  } = harness;

  it('clears verification borders when a blueprint import replaces the document text (staleness guard)', async () => {
    // Given: a blueprint whose Support Triage text differs from the open document
    const files = serializeBlueprint({
      tree: parsePromptTree({
        key: SUPPORT_TRIAGE_ID,
        text: `${SUPPORT_TRIAGE_TEXT}\nPROMPT-STUDIO-IMPORT-MARKER\n`,
        toolNames: [],
      }),
      variables: [],
      layout: {},
      promptSha256: 'test-sha',
    });

    // And: a verified edit left one bordered card
    await renderBootedApp();
    editInUndeclaredPlaceholder();
    click(findButtonByAccessibleName(document.body, 'Verify'));
    expect(verificationMarkedCards()).toHaveLength(1);
    pressEscape();

    // When: the blueprint replaces the document text
    await importFile(
      new File([packZip(files) as BlobPart], 'support-triage-blueprint.zip'),
      () => queryByTestId('import-success-banner') !== null,
    );

    // Then: the stale verification borders and count are gone
    expect(queryByTestId('edit-error-banner')).toBeNull();
    expect(verificationMarkedCards()).toHaveLength(0);
    expect(queryByTestId('status-verification-count')).toBeNull();
  });

  it('pins a missing required placeholder to its canonical section even when no variable occurrence remains', async () => {
    // Given: the Support Triage prompt, whose Customer Message section profile requires {{customer_message}}
    await renderStarterPrompt();

    // When: that section's body loses the placeholder, and the prompt is verified
    // (the canonical profile supplies section identity independently of the missing text occurrence)
    const messageCard = findArticleByLabel('Customer Message');
    click(findButtonByAccessibleName(messageCard, 'Edit section'));
    const textarea = document.querySelector('textarea[aria-label="Customer Message markdown"]') as HTMLTextAreaElement;
    setTextareaValue(textarea, 'No placeholder here anymore.');
    click(findButtonByAccessibleName(document.body, 'Apply'));

    click(findButtonByAccessibleName(document.body, 'Verify'));

    // Then: exactly the Customer Message card carries the finding, and nothing is document-level
    const marked = verificationMarkedCards();
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('aria-label')).toBe('Customer Message — verification: warning');
    expect(queryByTestId('status-doc-level-count')).toBeNull();
  });

  it('stops polling an unmet condition before teardown and leaves act usable', async () => {
    await expect(flushUntil(() => false, 10)).rejects.toThrow('expected false to be true');
    await renderBootedApp();
    expect(byTestId('project-picker-trigger').textContent).toContain('Default');
  });

  /**
   * THE ADR-203 integration test — the ONE test in this whole file that boots the REAL 'auto'
   * history-provider factory (try the git implementation, degrade to `SimpleHistoryProvider` with
   * the amber banner). Renders `<App />` directly (no `historyProviderKind`/`snapshotStore`
   * override), so it exercises the true production path end to end: the dynamic
   * `import('./vcs/git-history-provider')`, real WebCrypto digests, isomorphic-git/memfs baseline
   * seeding OR the honest fallback, and the real `fake-indexeddb`-backed `IndexedDbSnapshotStore`
   * (installed fresh per test in the outer `beforeEach` above). Every other project/history test in
   * this file asserts the identical UI contract against the fast `SimpleHistoryProvider` fake
   * instead (see this file's module doc) — this test's only job is proving the real wiring works,
   * not re-covering behavior already covered there. Legitimately the slowest test in the file (cold
   * dynamic import + first-ever isomorphic-git/memfs initialization in this process), hence its own
   * generous per-test timeout rather than inflating the whole file's default.
   */
  it("boots the REAL 'auto' history provider end to end, honoring whichever mode this environment yields", async () => {
    const gitWorks = await probeGitProvider();

    act(() => {
      harness.root.render(<App />);
    });

    // While booting the app renders as before — no picker, no blocking spinner.
    expect(queryByTestId('project-picker-trigger')).toBeNull();

    await flushUntil(() => queryByTestId('project-picker-trigger') !== null);
    expect(byTestId('project-picker-trigger').textContent).toContain('Default');

    if (gitWorks) {
      // Git loaded — no degradation happened, so no fallback banner may show.
      expect(queryByTestId('history-degraded-banner')).toBeNull();
    } else {
      // Degraded to simple — the amber banner explains the fallback and is dismissible.
      const banner = byTestId('history-degraded-banner');
      expect(banner.textContent).toContain('History running in fallback mode:');
      click(findButtonByAccessibleName(banner, 'Dismiss history fallback notice'));
      expect(queryByTestId('history-degraded-banner')).toBeNull();
    }
  }, 30_000);

  it('commits edits to the active project and switches working text between project heads', async () => {
    await renderBootedApp();
    click(byTestId(starterRootTestId));
    await settleHistoryWrites(); // heads load (Default is still the pristine baseline)

    applyMissionEdit('PROJECT-EDIT-MARKER');
    await settleHistoryWrites(); // fire-and-forget commit + persist
    expect(document.body.textContent).toContain('PROJECT-EDIT-MARKER');

    // Create (no `from`) forks from the BASELINE, not from Default's heads — B shows pristine
    // Support Triage even though Default's committed head carries the edit.
    await createProject('B');
    await flushUntil(() => !(document.body.textContent ?? '').includes('PROJECT-EDIT-MARKER'));
    expect(queryByTestId('dirty-chip')).toBeNull();

    // Back on Default the committed head — not the baseline — is the working text again, and the
    // dirty chip shows because `originalText` stays the baseline constant.
    await switchToProject('Default');
    await flushUntil(() => (document.body.textContent ?? '').includes('PROJECT-EDIT-MARKER'));
    expect(queryByTestId('dirty-chip')).toBeTruthy();
  });

  it("duplicating a project inherits the source project's committed heads", async () => {
    await renderBootedApp();
    click(byTestId(starterRootTestId));
    await settleHistoryWrites();
    let releaseCommit!: () => void;
    let markCommitStarted!: () => void;
    const commitReady = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const commitStarted = new Promise<void>((resolve) => {
      markCommitStarted = resolve;
    });
    harness.commitSpy.mockImplementationOnce(async function (this: SimpleHistoryProvider, input) {
      markCommitStarted();
      await commitReady;
      return harness.realCommit.call(this, input);
    });
    applyMissionEdit('DUPLICATE-MARKER');
    await act(async () => commitStarted);
    releaseCommit();
    await settleHistoryWrites();

    click(byTestId('project-picker-trigger'));
    const menu = byTestId('project-picker-menu');
    click(findButtonByAccessibleName(menu, 'Duplicate Default'));
    expect(findInputByAccessibleName(menu, 'Configuration name').value).toBe('Default copy');
    click(findButtonByAccessibleName(menu, 'Duplicate configuration'));
    await flushUntil(() => byTestId('project-picker-trigger').textContent?.includes('Default copy') ?? false);

    // The duplicate forked from Default's heads — the edited text, not the baseline.
    await flushUntil(() => (document.body.textContent ?? '').includes('DUPLICATE-MARKER'));
  });

  it('creating with a MISSING reference baseline is honest: error only, origin recorded as shipped default', async () => {
    // The container's degraded mode: the baselines projection failed to load, so the content
    // source is empty while the picker still offers the manifest-declared references. Creation
    // must say what actually happened — the error banner explains the fallback, no success
    // notice contradicts it, and the stored origin is 'default' so a later reset rebuilds what
    // the project really is instead of hunting for seed text that does not exist.
    const baselinesSpy = vi.spyOn(bundledBaselineContentSource, 'getBaselines').mockReturnValue([]);
    try {
      await renderBootedApp();

      click(byTestId('project-picker-trigger'));
      const menu = byTestId('project-picker-menu');
      click(findButtonByAccessibleName(menu, 'New configuration'));
      setInputValue(findInputByAccessibleName(menu, 'Configuration name'), 'Degraded trial');
      const startSelect = menu.querySelector('select[aria-label="Starting configuration"]') as HTMLSelectElement;
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(startSelect, 'job-seeker-personal-broker');
        startSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      click(findButtonByAccessibleName(menu, 'Create configuration'));
      await flushUntil(() => byTestId('project-picker-trigger').textContent?.includes('Degraded trial') ?? false);

      expect(document.body.textContent).toContain('no seed text available');
      expect(document.body.textContent).not.toContain('from the job-seeker-personal-broker reference configuration');
      expect(window.localStorage.getItem('prompt-studio:config-origin:v1:degraded-trial')).toBe('default');
    } finally {
      baselinesSpy.mockRestore();
    }
  });
});
