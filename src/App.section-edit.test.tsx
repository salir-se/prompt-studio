// @module-tag dom
import { expect, it } from 'vitest';
import { appTests } from './App.test-harness';
import { RELEASE_NOTES_ID } from './test-fixtures/starter-catalog';

const BODY =
  'Follow these steps.\n<draft>\nDraft the answer.\n</draft>\nBetween steps.\n<review>\nReview the evidence.\n</review>\nAfter the steps.\n';
const SOURCE = `Preserve this prefix.\n<mission>\n${BODY}</mission>\n<output>\nPreserve this sibling.\n</output>\nPreserve this suffix.\n`;

appTests((h) => {
  function draft(): HTMLTextAreaElement {
    return h.byTestId('fragment-edit-dialog').querySelector('textarea')!;
  }

  function openRoot() {
    h.click(document.querySelector<HTMLElement>(`[data-id="root:${RELEASE_NOTES_ID}"]`)!);
    h.click(h.findButtonByAccessibleName(h.byTestId('prompt-studio-inspector'), 'Edit markdown'));
  }

  function openParent() {
    h.click(h.findButtonByAccessibleName(h.findArticleByLabel('mission'), 'Edit section'));
  }

  it('#2521: edits the complete parent body once, preserving wrappers, children, siblings, Cancel and Undo', async () => {
    // Given: a plain prompt file whose whole text is replaced by a parent section with children and siblings
    await h.renderBootedApp();
    h.click(h.byTestId(`prompt-root-${RELEASE_NOTES_ID}`));
    openRoot();
    h.setTextareaValue(draft(), SOURCE);
    h.click(h.findButtonByAccessibleName(document.body, 'Apply'));
    await h.settleHistoryWrites();

    // When: the parent section is edited, cancelled, then edited and applied
    openParent();
    expect(draft().value).toBe(BODY);
    h.setTextareaValue(draft(), `${BODY}Discard this draft.`);
    h.click(h.findButtonByAccessibleName(document.body, 'Cancel'));
    openParent();
    expect(draft().value).toBe(BODY);
    h.setTextareaValue(draft(), BODY.replace('Draft the answer.', 'Draft a careful answer.'));
    h.click(h.findButtonByAccessibleName(document.body, 'Apply'));
    await h.settleHistoryWrites();

    // Then: only the parent body changed, and Undo restores the source
    openRoot();
    expect(draft().value).toBe(SOURCE.replace('Draft the answer.', 'Draft a careful answer.'));
    h.click(h.findButtonByAccessibleName(document.body, 'Cancel'));
    h.click(h.findButtonByAccessibleName(document.body, 'Undo'));
    openRoot();
    expect(draft().value).toBe(SOURCE);
  });
});
