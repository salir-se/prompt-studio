/**
 * Canvas node selection + the edit-dialog targeting (ADR-202 §3): which node is selected (the
 * inspector's subject), which node the edit dialog is open for (a SECTION opens the fragment
 * editor; the ROOT opens the whole-document markdown editor), and the dialog's Apply flows — a
 * section apply splices the edited body back into the document text (`spliceSectionBody`); a root
 * apply replaces the text wholesale. Both go through the editor's transactional write path.
 * Extracted verbatim from App.tsx.
 */

import type { PromptTreeNode } from '@prompt-studio/prompts';
import { useMemo, useState } from 'react';
import { sectionEditBody, spliceSectionBody } from './section-edit';
import type { Banners } from './use-banners';
import type { DocumentEditor, WorkingDocument } from './use-document-editor';

type EditTarget =
  | { kind: 'root'; nodeId: string }
  | { kind: 'section'; nodeId: string; section: PromptTreeNode; source: WorkingDocument; body: string; error?: string };

export function useNodeSelection({ editor, banners }: { editor: DocumentEditor; banners: Banners }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [editingTarget, setEditingTarget] = useState<EditTarget>();
  const editingNodeId = editingTarget?.nodeId;

  const selectedGraphNode = useMemo(
    () => editor.model.nodes.find((node) => node.id === selectedNodeId),
    [editor.model, selectedNodeId],
  );

  const editingSection = editingTarget?.kind === 'section' ? editingTarget.section : null;
  const editingSectionText = editingTarget?.kind === 'section' ? editingTarget.body : '';

  /** Whether the edit dialog targets the ROOT node — i.e. the whole document (ADR-202 §3). */
  const editingRoot = editingTarget?.kind === 'root';

  function beginEditNode(nodeId: string): void {
    const node = editor.model.nodes.find((candidate) => candidate.id === nodeId);
    // Sections open the fragment editor; the ROOT opens the whole-document markdown editor
    // (ADR-202 §3: the root IS the markdown source the sections are extracted from).
    if (node?.data.kind !== 'section' && node?.data.kind !== 'root') return;
    banners.setErrorMessage(null);
    if (node.data.kind === 'root') {
      setEditingTarget({ kind: 'root', nodeId });
      return;
    }
    if (!editor.doc) return;
    const body = sectionEditBody(editor.doc.text, node.data.node);
    if (!body) {
      banners.setErrorMessage('Could not locate the section in the current prompt. Reopen it and try again.');
      return;
    }
    setEditingTarget({ kind: 'section', nodeId, section: node.data.node, source: editor.doc, body: body.text });
  }

  function cancelEdit(): void {
    setEditingTarget(undefined);
  }

  function applySectionEdit(newBody: string): void {
    if (!editor.doc || editingTarget?.kind !== 'section') return;
    if (
      editor.doc.rootId !== editingTarget.source.rootId ||
      editor.doc.variantSymbol !== editingTarget.source.variantSymbol ||
      editor.doc.text !== editingTarget.source.text
    ) {
      const error =
        'The prompt changed while this section was open. Copy your edits, then cancel and reopen the section.';
      banners.setErrorMessage(error);
      setEditingTarget({ ...editingTarget, error });
      return;
    }
    const nextText = spliceSectionBody(editor.doc.text, editingTarget.section, newBody);
    if (nextText === null) {
      const error = `Could not locate "${editingTarget.section.title}" in the current prompt. Copy your edits, then cancel and reopen the section.`;
      banners.setErrorMessage(error);
      setEditingTarget({ ...editingTarget, error });
      return;
    }
    editor.commitUndoableEdit(nextText, `edit ${editingTarget.section.title}`);
    setEditingTarget(undefined);
  }

  /** Whole-document apply for the root-node markdown editor — the text replaces the document
   *  wholesale and the section tree re-derives from the new parse (ADR-202 §3). */
  function applyRootEdit(newText: string): void {
    if (!editor.doc) return;
    editor.commitUndoableEdit(newText, 'edit full prompt markdown');
    setEditingTarget(undefined);
  }

  /** Clears selection + dialog state — the selection half of the working-state reset. */
  function resetSelection(): void {
    setSelectedNodeId(undefined);
    setEditingTarget(undefined);
  }

  /** The node is gone from the next parse — drop any selection/edit state that pointed at it. */
  function handleNodeRemoved(nodeId: string): void {
    if (selectedNodeId === nodeId) setSelectedNodeId(undefined);
    if (editingNodeId === nodeId) setEditingTarget(undefined);
  }

  return {
    selectedNodeId,
    selectNode: setSelectedNodeId,
    editingNodeId,
    editingSection,
    editingSectionText,
    editingError: editingTarget?.kind === 'section' ? editingTarget.error : undefined,
    editingRoot,
    selectedGraphNode,
    beginEditNode,
    cancelEdit,
    applySectionEdit,
    applyRootEdit,
    resetSelection,
    handleNodeRemoved,
  };
}

export type NodeSelection = ReturnType<typeof useNodeSelection>;
