// @module-tag dom

import { FragmentEditDialog } from '@prompt-studio/prompt-graph-ui';
import { parsePromptTree, toGraphModel } from '@prompt-studio/prompts';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Banners } from './use-banners';
import type { DocumentEditor } from './use-document-editor';
import { useNodeSelection } from './use-node-selection';

function editorFor(text: string): DocumentEditor {
  return {
    doc: { rootId: 'fixture', text, originalText: text },
    model: toGraphModel(parsePromptTree({ key: 'fixture', text })),
    commitUndoableEdit: vi.fn(),
  } as unknown as DocumentEditor;
}

it('#2521: retains the original subtree draft and refuses to overwrite a changed source', () => {
  const original = '<parent>\nIntro.\n<child>\nOriginal child.\n</child>\n</parent>';
  const editor = editorFor(original);
  const banners = { setErrorMessage: vi.fn() } as unknown as Banners;
  const { result, rerender } = renderHook(({ current }) => useNodeSelection({ editor: current, banners }), {
    initialProps: { current: editor },
  });
  act(() => result.current.beginEditNode('section:parent'));
  expect(result.current.editingSectionText).toBe('Intro.\n<child>\nOriginal child.\n</child>\n');
  const changed = editorFor(original.replace('Original child.', 'Newer child.'));
  rerender({ current: changed });
  expect(result.current.editingSectionText).toBe('Intro.\n<child>\nOriginal child.\n</child>\n');
  act(() => result.current.applySectionEdit('An older edit.'));
  expect(changed.commitUndoableEdit).toHaveBeenCalledTimes(0);
  expect(banners.setErrorMessage).toHaveBeenLastCalledWith(
    'The prompt changed while this section was open. Copy your edits, then cancel and reopen the section.',
  );
  // D014: failed Apply preserves the open draft; the previous assertion encoded discarded work.
  expect(result.current.editingNodeId).toBe('section:parent');
});

it('#2521: a new document with identical text cannot receive another document’s section draft', () => {
  const editor = editorFor('<parent>\nInstruction.\n</parent>');
  const banners = { setErrorMessage: vi.fn() } as unknown as Banners;
  const { result, rerender } = renderHook(({ current }) => useNodeSelection({ editor: current, banners }), {
    initialProps: { current: editor },
  });
  act(() => result.current.beginEditNode('section:parent'));
  rerender({ current: { ...editor, doc: { ...editor.doc!, rootId: 'another-prompt' } } });
  act(() => result.current.applySectionEdit('A different instruction.'));
  expect(editor.commitUndoableEdit).toHaveBeenCalledTimes(0);
});

for (const failure of ['changed source', 'invalid range'] as const) {
  it(`#2521: keeps the typed draft and visible recovery guidance after ${failure} prevents Apply`, () => {
    const editor = editorFor('<parent>\nInstruction.\n</parent>');
    const banners = { setErrorMessage: vi.fn() } as unknown as Banners;
    function Harness({ current }: { current: DocumentEditor }) {
      const selection = useNodeSelection({ editor: current, banners });
      return (
        <>
          <button type="button" onClick={() => selection.beginEditNode('section:parent')}>
            Edit parent
          </button>
          {selection.editingSection && (
            <FragmentEditDialog
              open
              title={selection.editingSection.title}
              initialText={selection.editingSectionText}
              error={selection.editingError}
              onApply={selection.applySectionEdit}
              onCancel={selection.cancelEdit}
            />
          )}
        </>
      );
    }
    const { rerender } = render(<Harness current={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit parent' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my unfinished instructions.' } });
    if (failure === 'changed source') {
      rerender(<Harness current={editorFor('<parent>\nNewer instruction.\n</parent>')} />);
    } else {
      const section = editor.model.nodes.find((node) => node.id === 'section:parent')!;
      if (section.data.kind !== 'section') throw new Error('Expected section fixture');
      section.data.node.range.end = editor.doc!.text.length + 1;
    }
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep my unfinished instructions.');
    expect(screen.getByRole('alert')).toHaveTextContent('Copy your edits, then cancel and reopen the section.');
    expect(editor.commitUndoableEdit).toHaveBeenCalledTimes(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit parent' }));
    if (failure === 'changed source') expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
}
