import type { DraftEdit } from './composing';

/** Two-space indentation preserves selected instructions and excludes a line selected only at its start. */
export function indentSelection(
  text: string,
  start: number,
  end: number,
  outdent: boolean,
  direction: 'forward' | 'backward' | 'none',
): DraftEdit {
  if (start === end && !outdent) {
    return { text: `${text.slice(0, start)}  ${text.slice(end)}`, selectionStart: start + 2, selectionEnd: start + 2 };
  }
  const first = text.slice(0, start).lastIndexOf('\n') + 1;
  const limit = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const edits: Array<{ offset: number; removed: number; added: string }> = [];
  for (let offset = first; offset <= limit;) {
    const removed = outdent ? (/^(?: {1,2}|\t)/.exec(text.slice(offset))?.[0].length ?? 0) : 0;
    edits.push({ offset, removed, added: outdent ? '' : '  ' });
    const next = text.indexOf('\n', offset);
    if (next < 0) break;
    offset = next + 1;
  }
  const remap = (position: number) =>
    position +
    edits.reduce(
      (delta, edit) =>
        edit.offset <= position ? delta + edit.added.length - Math.min(edit.removed, position - edit.offset) : delta,
      0,
    );
  let next = text;
  for (const edit of [...edits].reverse())
    next = next.slice(0, edit.offset) + edit.added + next.slice(edit.offset + edit.removed);
  return { text: next, selectionStart: remap(start), selectionEnd: remap(end), selectionDirection: direction };
}
