// @module-tag dom
import { act } from 'react';
import { expect, it } from 'vitest';
import { appTests } from './App.test-harness';
import { RELEASE_NOTES_ID, starterCatalog, TONE_ID, UNREADABLE_ID } from './test-fixtures/starter-catalog';

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
    queryArticleByLabel,
    renderBootedApp,
    renderStarterPrompt,
  } = harness;

  it('lists every catalog root in the sidebar, disabling the unreadable ones with a tooltip', async () => {
    // Given: the starter project's manifest, built the same way the App builds it (ADR-235)
    const catalog = starterCatalog();

    // When: the studio boots against the bridge serving that project
    await renderBootedApp();

    // Then: every root has a row; the one whose text cannot be read is disabled and explains why
    for (const catalogRoot of catalog) {
      const rowButton = byTestId(`prompt-root-${catalogRoot.id}`) as HTMLButtonElement;
      if (catalogRoot.loadability === 'inline' || catalogRoot.loadability === 'external') {
        expect(rowButton.disabled).toBe(true);
        expect(rowButton.getAttribute('title')).toBeTruthy();
      } else {
        expect(rowButton.disabled).toBe(false);
      }
    }

    // And: the three prompt files plus the unreadable symbol document are counted
    expect(catalog).toHaveLength(4);
    expect((byTestId(`prompt-root-${UNREADABLE_ID}`) as HTMLButtonElement).disabled).toBe(true);
    expect((byTestId(`prompt-root-${RELEASE_NOTES_ID}`) as HTMLButtonElement).disabled).toBe(false);
    expect(byTestId('prompt-root-count').textContent).toContain(`(${catalog.length})`);
  });

  it('renders the canvas and non-zero status-bar counts once Support Triage is selected', async () => {
    // Given / When: the starter project's Support Triage prompt is opened
    await renderStarterPrompt();

    // Then: the canvas renders its sections and the status bar counts them

    expect(queryByTestId('prompt-graph-canvas')).toBeTruthy();
    expect(byTestId('status-node-count').textContent).not.toMatch(/^0 nodes/);
    expect(byTestId('status-edge-count').textContent).not.toMatch(/^0 edges/);
  });

  it('shows the inspector with an Edit section button once a section node is selected', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    const missionCard = findArticleByLabel('Mission');
    click(missionCard);

    const inspector = byTestId('prompt-studio-inspector');
    const heading = Array.from(inspector.querySelectorAll('h2')).find((h) => h.textContent === 'Mission');
    expect(heading).toBeTruthy();
    expect(findButtonByAccessibleName(inspector, 'Edit section')).toBeTruthy();
  });

  it('round-trips an edit through the document — Apply updates the graph, Undo restores it', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    const missionCard = findArticleByLabel('Mission');
    click(findButtonByAccessibleName(missionCard, 'Edit section'));

    const textarea = document.querySelector('textarea[aria-label="Mission markdown"]') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    setTextareaValue(textarea, `${textarea.value} PROMPT-STUDIO-EDIT-MARKER`);

    click(findButtonByAccessibleName(document.body, 'Apply'));

    // Dialog closed, edit applied, dirty chip visible, the new body shows up on the re-parsed canvas.
    expect(queryByTestId('fragment-edit-dialog')).toBeNull();
    expect(queryByTestId('dirty-chip')).toBeTruthy();
    expect(document.body.textContent).toContain('PROMPT-STUDIO-EDIT-MARKER');

    click(findButtonByAccessibleName(document.body, 'Undo'));

    expect(document.body.textContent).not.toContain('PROMPT-STUDIO-EDIT-MARKER');
    expect(queryByTestId('dirty-chip')).toBeNull();
  });

  it('adds a sibling section from the selected card, in the neighborhood dialect, undoably', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    const missionCard = findArticleByLabel('Mission');
    click(missionCard);
    click(findButtonByAccessibleName(missionCard, 'Add section after'));

    // Canonical sections use their stable XML tag boundary, so new siblings use the same dialect.
    expect(queryArticleByLabel('New Section')).toBeTruthy();
    expect(queryByTestId('dirty-chip')).toBeTruthy();

    click(findButtonByAccessibleName(document.body, 'Undo'));
    expect(queryArticleByLabel('New Section')).toBeUndefined();
    expect(queryByTestId('dirty-chip')).toBeNull();
  });

  it('adds an xml-tag sub-section under the selected card', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    const missionCard = findArticleByLabel('Mission');
    click(missionCard);
    click(findButtonByAccessibleName(missionCard, 'Add sub-section'));

    // Children always use the ADR-preferred xml-tag dialect: the new card is titled from the tag name.
    expect(queryArticleByLabel('New Section')).toBeTruthy();
    expect(queryByTestId('dirty-chip')).toBeTruthy();
  });

  it('removes the selected section and clears the selection, undoably', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    const missionCard = findArticleByLabel('Mission');
    click(missionCard);
    expect(queryByTestId('prompt-studio-inspector')).toBeTruthy();

    click(findButtonByAccessibleName(missionCard, 'Remove section'));

    expect(queryArticleByLabel('Mission')).toBeUndefined();
    // Selection pointed at the removed node — the inspector must not linger on a ghost.
    expect(queryByTestId('prompt-studio-inspector')).toBeNull();

    click(findButtonByAccessibleName(document.body, 'Undo'));
    expect(queryArticleByLabel('Mission')).toBeTruthy();
  });

  it('shows the structure toolbar only on the selected card', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    const missionCard = findArticleByLabel('Mission');
    expect(missionCard.querySelector('[data-testid="fragment-node-actions"]')).toBeNull();

    click(missionCard);
    expect(findArticleByLabel('Mission').querySelector('[data-testid="fragment-node-actions"]')).toBeTruthy();
  });

  it('moves the selected section, and moving it back restores the original document', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    const missionCard = findArticleByLabel('Mission');
    click(missionCard);
    click(findButtonByAccessibleName(missionCard, 'Move section down'));
    expect(queryByTestId('dirty-chip')).toBeTruthy();

    const movedCard = findArticleByLabel('Mission');
    click(findButtonByAccessibleName(movedCard, 'Move section up'));
    // down-then-up is byte-identical to the original, so the dirty chip clears again.
    expect(queryByTestId('dirty-chip')).toBeNull();
  });

  it('edits the whole document from the root inspector, and the new section extracts onto the canvas', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    const rootChip = document.querySelector('[data-id="root:support-triage"]') as HTMLElement;
    expect(rootChip).toBeTruthy();
    click(rootChip);

    const inspector = byTestId('prompt-studio-inspector');
    click(findButtonByAccessibleName(inspector, 'Edit markdown'));

    const textarea = document.querySelector('[data-testid="fragment-edit-dialog"] textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    setTextareaValue(
      textarea,
      `${textarea.value}\n\n<root_added_section>\nAdded from the root editor.\n</root_added_section>`,
    );
    click(findButtonByAccessibleName(document.body, 'Apply'));

    // The document re-parsed: the section typed into the root markdown is now a canvas card.
    expect(queryByTestId('fragment-edit-dialog')).toBeNull();
    expect(queryArticleByLabel('Root Added Section')).toBeTruthy();
    expect(queryByTestId('dirty-chip')).toBeTruthy();
  });

  it('renders a prose fragment document as one editable Document card (task #17)', async () => {
    // Given: the starter project's prose Tone fragment, which has no sections
    await renderBootedApp();

    // When: it is opened
    click(byTestId(`prompt-root-${TONE_ID}`));

    // Then: the prose fallback synthesizes one full-range section: a canvas card exists for it.
    const card = queryArticleByLabel('Document');
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain('calm, friendly tone'); // the fragment's prose

    // It edits through the same dialog path: apply a marker, see the dirty chip and the text.
    click(card as HTMLElement);
    click(findButtonByAccessibleName(byTestId('prompt-studio-inspector'), 'Edit section'));
    const textarea = document.querySelector('[data-testid="fragment-edit-dialog"] textarea') as HTMLTextAreaElement;
    setTextareaValue(textarea, `${textarea.value}\nPROSE-EDIT-MARKER`);
    click(findButtonByAccessibleName(document.body, 'Apply'));

    expect(queryByTestId('fragment-edit-dialog')).toBeNull();
    expect(queryByTestId('dirty-chip')).toBeTruthy();
    expect(document.body.textContent).toContain('PROSE-EDIT-MARKER');
  });

  it('opens each new drawer from its top-bar button and Escape closes it', async () => {
    // Given: the starter project's Support Triage prompt is open
    await renderStarterPrompt();

    click(findButtonByAccessibleName(document.body, 'Tools'));
    expect(queryByTestId('tools-drawer')).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(queryByTestId('tools-drawer')).toBeNull();

    click(findButtonByAccessibleName(document.body, 'Variables'));
    expect(queryByTestId('variables-drawer')).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(queryByTestId('variables-drawer')).toBeNull();

    click(findButtonByAccessibleName(document.body, 'Final prompt'));
    expect(queryByTestId('final-prompt-drawer')).toBeTruthy();
    // Opening a drawer hides the inspector even though a section node is still selected underneath.
    expect(queryByTestId('prompt-studio-inspector')).toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(queryByTestId('final-prompt-drawer')).toBeNull();

    click(findButtonByAccessibleName(document.body, 'Verify'));
    expect(queryByTestId('verification-drawer')).toBeTruthy();
    expect(byTestId('status-verification-count')).toBeTruthy();
  });

  it('disables Verify for a root without a verification profile, and Final prompt before any root is loaded', async () => {
    // Given: the booted studio with no prompt opened yet
    await renderBootedApp();

    // Then: Final prompt has nothing to show
    const finalPromptButton = findButtonByAccessibleName(document.body, 'Final prompt') as HTMLButtonElement;
    expect(finalPromptButton.disabled).toBe(true);

    // When: a plain prompt file with no saved design (so no verification profile) is opened
    click(byTestId(`prompt-root-${RELEASE_NOTES_ID}`));

    // Then: Verify is disabled and its tooltip says why
    const verifyButton = findButtonByAccessibleName(document.body, 'Verify') as HTMLButtonElement;
    expect(verifyButton.disabled).toBe(true);
    expect(verifyButton.getAttribute('title')).toMatch(/no editable prompt key/i);
  });

  // ── "Declare before use" variables registry (session registry, undeclared-use finding) ──

  it('counts only the pristine document placeholders as undeclared, then one more after an edit introduces an undeclared placeholder', async () => {
    // Given: the pristine Support Triage prompt; the public build declares no built-in variables, so its own
    // {{company_name}} and {{customer_message}} are the only undeclared names
    await renderStarterPrompt();
    expect(byTestId('status-undeclared-count').textContent).toContain('2 undeclared');

    // When: an edit appends a placeholder no registry declares
    const missionCard = findArticleByLabel('Mission');
    click(findButtonByAccessibleName(missionCard, 'Edit section'));
    const textarea = document.querySelector('textarea[aria-label="Mission markdown"]') as HTMLTextAreaElement;
    setTextareaValue(textarea, `${textarea.value} {{not_declared_anywhere}}`);
    click(findButtonByAccessibleName(document.body, 'Apply'));

    // Then: the status bar counts exactly one more undeclared placeholder
    expect(byTestId('status-undeclared-count').textContent).toContain('3 undeclared');
  });

  // Regression coverage for a live-capture discrepancy: a Playwright drive that opened this same
  // drawer and clicked a "Declare…" button submitted with an EMPTY name, producing the (correct)
  // validation error, as if prefill never happened. Reproducing the exact live sequence here — open
  // via the status-bar chip, click the ROW's "Declare…" button, then assert the real <input>.value
  // (not React state) before filling purpose and submitting — shows prefill works correctly. The
  // drive's click almost certainly landed on the form's submit button instead: before this fix both
  // buttons had the accessible name "Declare…"/"Declare", which a substring accessible-name match
  // (e.g. Playwright's default `getByRole('button', { name: 'Declare' })`) cannot tell apart. Row
  // buttons and the submit button now have distinct accessible names (`Declare {{name}}…` vs
  // `Declare variable`) so drives and screen readers cannot confuse them.
  it("opens the Variables drawer from the status-bar chip, prefills the Name input via the row's Declare button, and declares on submit", async () => {
    // Given: Support Triage's Mission body uses a placeholder no registry declares
    await renderBootedApp();
    editInUndeclaredPlaceholder();

    // When: the author opens the Variables drawer from the status-bar chip

    click(byTestId('status-undeclared-count'));
    expect(queryByTestId('variables-drawer')).toBeTruthy();

    const undeclaredSection = byTestId('undeclared-section');
    expect(undeclaredSection.textContent).toContain('not_declared_anywhere');

    // And: chooses the row's Declare button for the new placeholder
    click(findButtonByAccessibleName(undeclaredSection, 'Declare {{not_declared_anywhere}}…'));

    // Then: the Name input is prefilled, and submitting declares it
    const nameInput = findInputByAccessibleName(document.body, 'Variable name');
    expect(nameInput.value).toBe('not_declared_anywhere');

    setInputValue(findInputByAccessibleName(document.body, 'Purpose'), 'A placeholder declared for this test.');
    click(findButtonByAccessibleName(document.body, 'Declare variable'));

    expect(queryByTestId('declare-variable-error')).toBeNull();
    // And: it leaves the undeclared list; the example's own placeholders stay there until declared
    expect(byTestId('undeclared-section').textContent).not.toContain('not_declared_anywhere');
    const sessionRow = document.querySelector('[data-testid="session-variable-row"]');
    expect(sessionRow?.textContent).toContain('not_declared_anywhere');
  });
});
