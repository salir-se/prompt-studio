import type { DraftEdit } from './composing';

/** Native insertText keeps the textarea's undo history; assigning .value or setRangeText does not. */
export function applyNativeEdit(element: HTMLTextAreaElement, edit: DraftEdit): boolean {
  const previous = element.value;
  if (previous !== edit.text) {
    let from = 0;
    while (from < previous.length && from < edit.text.length && previous[from] === edit.text[from]) from++;
    let suffix = 0;
    while (
      suffix < previous.length - from &&
      suffix < edit.text.length - from &&
      previous.at(-suffix - 1) === edit.text.at(-suffix - 1)
    )
      suffix++;
    element.focus();
    element.setSelectionRange(from, previous.length - suffix);
    // shortcut: execCommand preserves native undo; replace this bridge if supported browsers drop insertText.
    const insert = element.ownerDocument.execCommand?.(
      'insertText',
      false,
      edit.text.slice(from, edit.text.length - suffix),
    );
    if (!insert || element.value !== edit.text) return false;
  }
  // Browsers reveal a collapsed caret on focus, but may leave a selected range off screen.
  element.setSelectionRange(edit.selectionStart, edit.selectionStart);
  element.blur();
  element.focus();
  element.setSelectionRange(edit.selectionStart, edit.selectionEnd, edit.selectionDirection);
  return true;
}
