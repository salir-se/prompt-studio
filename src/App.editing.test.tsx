// @module-tag dom
import { parsePromptTree, serializeBlueprint } from '@prompt-studio/prompts';
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { appTests } from './App.test-harness';
import { packZip } from './export/zip';
import { STORAGE_KEY_PREFIX } from './registry/registry-persistence';
import { SUPPORT_TRIAGE_ID, SUPPORT_TRIAGE_TEXT } from './test-fixtures/starter-catalog';

appTests((harness) => {
  const {
    byTestId,
    queryByTestId,
    findButtonByAccessibleName,
    click,
    setTextareaValue,
    setInputValue,
    findInputByAccessibleName,
    editInUndeclaredPlaceholder,
    renderApp,
    renderBootedApp,
    renderStarterPrompt,
    importFile,
    verificationMarkedCards,
    pressEscape,
    flushUntil,
  } = harness;

  // Declaring a session variable clearing the undeclared count and the known-placeholder finding is
  // proven in hooks/use-variables-registry.declare.test.tsx (the rule, 38 ms) and App.projects.test.tsx
  // (drawer → status bar wiring). The full-App version needed 12 re-renders (3 s locally) and timed
  // out at 15 s on a loaded CI runner.

  it('rejects an invalid name or empty purpose from the declare form with an inline error, without closing the drawer', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();
    click(findButtonByAccessibleName(document.body, 'Variables'));

    setInputValue(findInputByAccessibleName(document.body, 'Variable name'), 'not a valid name');
    setInputValue(findInputByAccessibleName(document.body, 'Purpose'), 'purpose');
    click(findButtonByAccessibleName(document.body, 'Declare variable'));

    expect(byTestId('declare-variable-error')).toBeTruthy();
    expect(queryByTestId('variables-drawer')).toBeTruthy();
  });

  // ── Light/dark theme toggle (top-bar right) ──

  it('defaults to light, toggles the "dark" class on <html> on click, and persists the choice to localStorage', () => {
    renderApp();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    const toggle = byTestId('theme-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toBe('Switch to dark theme');

    click(toggle);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('prompt-studio-theme')).toBe('dark');
    expect(byTestId('theme-toggle').getAttribute('aria-label')).toBe('Switch to light theme');

    click(toggle);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem('prompt-studio-theme')).toBe('light');
  });

  it('honors a previously stored theme choice on initial load', () => {
    window.localStorage.setItem('prompt-studio-theme', 'dark');

    renderApp();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(byTestId('theme-toggle').getAttribute('aria-label')).toBe('Switch to light theme');
  });

  it('enables Export once a document is loaded and opens the dialog REFUSED for an undeclared variable', async () => {
    // Given: the booted studio with no document loaded, so Export is disabled
    await renderBootedApp();
    expect((findButtonByAccessibleName(document.body, 'Export') as HTMLButtonElement).disabled).toBe(true);

    // When: an edit introduces an undeclared placeholder
    editInUndeclaredPlaceholder();
    expect((findButtonByAccessibleName(document.body, 'Export') as HTMLButtonElement).disabled).toBe(false);

    // Then: the Export dialog names it and refuses until forced

    click(findButtonByAccessibleName(document.body, 'Export'));

    const dialog = byTestId('export-dialog');
    expect(dialog.textContent).toContain('not_declared_anywhere');
    expect((findButtonByAccessibleName(dialog, 'Export ZIP') as HTMLButtonElement).disabled).toBe(true);

    // Checking "Export anyway" enables the forced export; Cancel closes without exporting.
    click(byTestId('export-force-checkbox'));
    expect((findButtonByAccessibleName(dialog, 'Export ZIP') as HTMLButtonElement).disabled).toBe(false);
    click(findButtonByAccessibleName(dialog, 'Cancel'));
    expect(queryByTestId('export-dialog')).toBeNull();
  });

  it('force-exporting downloads a ZIP through an object URL and closes the dialog', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => 'blob:prompt-studio-test');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
    try {
      // Given: Support Triage's Mission body uses a placeholder no registry declares
      await renderBootedApp();
      editInUndeclaredPlaceholder();
      click(findButtonByAccessibleName(document.body, 'Export'));
      click(byTestId('export-force-checkbox'));

      click(findButtonByAccessibleName(byTestId('export-dialog'), 'Export ZIP'));
      // Condition-driven wait: the export pipeline crosses WebCrypto (sha256 digest) plus zip
      // assembly — fixed-length flushes lose this race under load, so wait for the observable
      // outcome itself (flushUntil is a hoisted declaration further down this describe block).
      await flushUntil(() => createObjectURL.mock.calls.length === 1);

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:prompt-studio-test');
      expect(queryByTestId('export-dialog')).toBeNull();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  // Import opens without a selected prompt, because a project archive needs none (#2165). A blueprint applies to one
  // prompt, so it is refused when none is selected, after the file is read.
  it('refuses a blueprint while no prompt is selected, with an error banner that says to select one', async () => {
    // Given: a blueprint of the Support Triage prompt, and no prompt selected
    const files = serializeBlueprint({
      tree: parsePromptTree({ key: SUPPORT_TRIAGE_ID, text: SUPPORT_TRIAGE_TEXT, toolNames: [] }),
      variables: [],
      layout: {},
      promptSha256: 'test-sha',
    });
    renderApp();

    click(findButtonByAccessibleName(document.body, 'Import'));
    expect(queryByTestId('edit-error-banner')).toBeNull();

    await importFile(
      new File([packZip(files) as BlobPart], 'support-triage-blueprint.zip'),
      () => queryByTestId('edit-error-banner') !== null,
    );

    expect(byTestId('edit-error-banner').textContent).toMatch(/select a prompt, then import the blueprint again/i);
    expect(queryByTestId('import-success-banner')).toBeNull();
    expect(queryByTestId('dirty-chip')).toBeNull();
  });

  it('shows the error banner for a garbage import file and leaves the document untouched', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    await importFile(
      new File([new Uint8Array([1, 2, 3, 4])], 'garbage.zip'),
      () => queryByTestId('edit-error-banner') !== null,
    );

    expect(byTestId('edit-error-banner').textContent).toContain('not a valid ZIP');
    expect(queryByTestId('dirty-chip')).toBeNull();
    expect(queryByTestId('import-success-banner')).toBeNull();
  });

  it('imports a blueprint ZIP: undoable text replacement plus session-variable merge, with a success note', async () => {
    // Given: a blueprint of an edited Support Triage prompt that also carries a session variable
    const importedText = SUPPORT_TRIAGE_TEXT.replace(
      'Classify the customer message',
      'PROMPT-STUDIO-IMPORT-MARKER Classify the customer message',
    );
    const files = serializeBlueprint({
      tree: parsePromptTree({ key: SUPPORT_TRIAGE_ID, text: importedText, toolNames: [] }),
      variables: [
        {
          name: 'imported_var',
          purpose: 'Arrived via blueprint import.',
          sample: '',
          required: true,
          source: 'session',
        },
      ],
      layout: {},
      promptSha256: 'test-sha',
    });

    // And: the Support Triage prompt is open
    await renderStarterPrompt();

    // When: the blueprint ZIP is imported
    await importFile(
      new File([packZip(files) as BlobPart], 'support-triage-blueprint.zip'),
      () => queryByTestId('import-success-banner') !== null,
    );

    expect(queryByTestId('edit-error-banner')).toBeNull();
    // Then: the text is replaced as one undoable step, with a success note
    expect(byTestId('import-success-banner').textContent).toContain(SUPPORT_TRIAGE_ID);
    expect(document.body.textContent).toContain('PROMPT-STUDIO-IMPORT-MARKER');
    expect(queryByTestId('dirty-chip')).toBeTruthy();

    // The archive's session variable merged into the registry and persisted per-root.
    click(findButtonByAccessibleName(document.body, 'Variables'));
    const sessionRow = document.querySelector('[data-testid="session-variable-row"]');
    expect(sessionRow?.textContent).toContain('imported_var');
    expect(window.localStorage.getItem(`${STORAGE_KEY_PREFIX}default:support-triage`)).toContain('imported_var');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    // The replacement is a single undoable step back to the pre-import document.
    click(findButtonByAccessibleName(document.body, 'Undo'));
    expect(document.body.textContent).not.toContain('PROMPT-STUDIO-IMPORT-MARKER');
    expect(queryByTestId('dirty-chip')).toBeNull();
  });

  // ── Per-root session-declaration persistence (registry-persistence wiring) ──

  it("persists a session declaration to the selected root's localStorage entry", async () => {
    // Given: Support Triage's Mission body uses a placeholder no registry declares
    await renderBootedApp();
    editInUndeclaredPlaceholder();

    // When: the author declares it through the status bar and the Variables drawer

    click(byTestId('status-undeclared-count'));
    click(findButtonByAccessibleName(byTestId('undeclared-section'), 'Declare {{not_declared_anywhere}}…'));
    setInputValue(findInputByAccessibleName(document.body, 'Purpose'), 'Persisted for this test.');
    click(findButtonByAccessibleName(document.body, 'Declare variable'));

    // Then: the declaration is saved under the root's key in the active (Default) project
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}default:support-triage`);
    expect(raw).toBeTruthy();
    expect(raw).toContain('not_declared_anywhere');
  });

  it('folds saved session declarations back into the registry when the root is selected', async () => {
    // Given: a session declaration saved for Support Triage on a previous load
    window.localStorage.setItem(
      `${STORAGE_KEY_PREFIX}support-triage`,
      JSON.stringify({
        declarations: [{ name: 'saved_var', purpose: 'Saved on a previous load.', sample: '', required: true }],
      }),
    );

    // When: the Support Triage prompt is opened and the Variables drawer shown
    await renderStarterPrompt();
    click(findButtonByAccessibleName(document.body, 'Variables'));

    const sessionRow = document.querySelector('[data-testid="session-variable-row"]');
    expect(sessionRow?.textContent).toContain('saved_var');
  });

  it('renders no verification borders and no doc-level chip after verifying a pristine Support Triage document', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    click(findButtonByAccessibleName(document.body, 'Verify'));

    // A pristine Support Triage run has zero findings — the record stays empty (nodes without findings get NO
    // entry; 'valid' is deliberately never fabricated per node), so no card carries the attribute.
    expect(byTestId('status-verification-count').textContent).toContain('0 findings');
    expect(verificationMarkedCards()).toHaveLength(0);
    expect(queryByTestId('fragment-node-finding-count')).toBeNull();
    expect(queryByTestId('status-doc-level-count')).toBeNull();
  });

  it('pins a finding to the section that introduced it — border state plus finding-count chip on that card', async () => {
    // Given: Support Triage's Mission body uses a placeholder no registry declares
    await renderBootedApp();
    editInUndeclaredPlaceholder();

    click(findButtonByAccessibleName(document.body, 'Verify'));

    // known-placeholder is a warning-severity rule, and its subject matches only the edited section's
    // variables — the real derivation puts exactly one 'warning' border on the Mission card.
    const marked = verificationMarkedCards();
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('data-verification-state')).toBe('warning');
    expect(marked[0].getAttribute('aria-label')).toBe('Mission — verification: warning');
    const chip = marked[0].querySelector('[data-testid="fragment-node-finding-count"]');
    expect(chip?.textContent).toContain('1 finding');
  });

  it('clears verification borders when the text changes again — apply-edit and Undo (staleness guard)', async () => {
    // Given: Support Triage's Mission body uses a placeholder no registry declares
    await renderBootedApp();
    editInUndeclaredPlaceholder();
    click(findButtonByAccessibleName(document.body, 'Verify'));
    expect(verificationMarkedCards()).toHaveLength(1);
    pressEscape();

    // Another apply-edit: borders and the status-bar finding count must both disappear.
    click(findButtonByAccessibleName(verificationMarkedCards()[0], 'Edit section'));
    const textarea = document.querySelector('textarea[aria-label="Mission markdown"]') as HTMLTextAreaElement;
    setTextareaValue(textarea, `${textarea.value} ANOTHER-EDIT`);
    click(findButtonByAccessibleName(document.body, 'Apply'));

    expect(verificationMarkedCards()).toHaveLength(0);
    expect(queryByTestId('status-verification-count')).toBeNull();

    // Re-verify, then Undo — the same guard covers the undo path.
    click(findButtonByAccessibleName(document.body, 'Verify'));
    expect(verificationMarkedCards()).toHaveLength(1);
    pressEscape();
    click(findButtonByAccessibleName(document.body, 'Undo'));

    expect(verificationMarkedCards()).toHaveLength(0);
    expect(queryByTestId('status-verification-count')).toBeNull();
  });
});
