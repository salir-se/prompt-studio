// @module-tag dom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { appTests } from './App.test-harness';

appTests((h) => {
  it.each([false, true])(
    '#2530: Alt+1 returns to an unapplied writer without a discard decision (confirm=%s)',
    async (accept) => {
      // Given: Support Triage open in the writer with unapplied writing, previewing the draft
      await h.renderBootedApp();
      h.click(h.byTestId(h.starterRootTestId));
      h.click(h.findButtonByAccessibleName(document.body, 'Write'));
      const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt markdown"]')!;
      const draft = `${editor.value}\nKeep this unapplied writing.`;
      h.setTextareaValue(editor, draft);
      const preview = h.findButtonByAccessibleName(document.body, 'Preview draft');
      act(() => preview.focus());
      expect(preview).toHaveAttribute('aria-selected', 'true');
      // When: Alt+1 asks for the Markdown view
      const confirm = vi.fn(() => accept);
      vi.stubGlobal('confirm', confirm);
      act(() =>
        preview.dispatchEvent(
          new KeyboardEvent('keydown', { code: 'Digit1', key: '1', altKey: true, bubbles: true, cancelable: true }),
        ),
      );
      await act(
        async () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      // Then: the writer returns with the same draft, without asking to discard it
      expect(confirm).not.toHaveBeenCalled();
      expect(h.findButtonByAccessibleName(document.body, 'Markdown')).toHaveAttribute('aria-selected', 'true');
      expect(document.activeElement === editor).toBe(true);
      expect(document.querySelector('textarea[aria-label="Prompt markdown"]')).toBe(editor);
      expect(editor.value).toBe(draft);
      expect(h.findButtonByAccessibleName(document.body, 'Apply changes')).toBeEnabled();
    },
  );
});

appTests((h) => {
  it('reveals an Explorer section in the unapplied writing draft without submitting it', async () => {
    // Given: a writer whose source positions differ from the saved outline.
    await h.renderBootedApp();
    h.click(h.byTestId(h.starterRootTestId));
    h.click(h.findButtonByAccessibleName(document.body, 'Write'));
    const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt markdown"]')!;
    const prefix = `${'Keep this unapplied introduction.\n'.repeat(40)}\n`;
    const draft = prefix + editor.value;
    h.setTextareaValue(editor, draft);
    editor.setSelectionRange(0, 0);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    // When: the author activates Mission in Explorer.
    const mission = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((item) =>
      item.textContent?.includes('Mission'),
    )!;
    act(() => mission.focus());
    h.click(mission);
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    // Then: the caret reveals the current draft and tree focus remains available for keyboard browsing.
    expect(document.activeElement === mission).toBe(true);
    expect(editor.selectionStart).toBeGreaterThan(prefix.length);
    expect(editor.value).toBe(draft);
    expect(confirm).not.toHaveBeenCalled();
    expect(h.findButtonByAccessibleName(document.body, 'Apply changes')).toBeEnabled();
  });
});
