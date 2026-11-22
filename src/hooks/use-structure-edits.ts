/**
 * The canvas's section-structure operations (ADR-202): add sibling / add sub-section / remove /
 * move among siblings — each a pure text transformation over the working document, applied through
 * the editor's transactional write path (undo point, staleness clear, ADR-203 auto-commit).
 * Extracted verbatim from App.tsx.
 */

import {
  insertChildSection,
  insertSiblingSectionAfter,
  moveSectionAmongSiblings,
  type PromptTreeNode,
  removeSectionText,
  uniqueSectionTagName,
} from '@prompt-studio/prompts';
import type { DocumentEditor } from './use-document-editor';

export function useStructureEdits({ editor }: { editor: DocumentEditor }) {
  /** The tree section behind a canvas graph node id, or null for non-section ids. */
  function sectionFromGraphNodeId(nodeId: string): PromptTreeNode | null {
    const node = editor.model.nodes.find((candidate) => candidate.id === nodeId);
    return node?.data.kind === 'section' ? node.data.node : null;
  }

  /** Shared tail of every structure edit: undo point, transactional write, staleness clear. */
  function applyStructureEdit(nextText: string, commitMessage: string): void {
    if (!editor.doc) return;
    editor.commitUndoableEdit(nextText, commitMessage);
  }

  function addSiblingSection(nodeId: string, requestedName = 'new_section'): void {
    const section = sectionFromGraphNodeId(nodeId);
    if (!editor.doc || !editor.tree || !section) return;
    if (!/^[a-z][a-z0-9_]*$/i.test(requestedName)) return;
    const name = uniqueSectionTagName(editor.tree, requestedName);
    applyStructureEdit(insertSiblingSectionAfter(editor.doc.text, section, name), `add section after ${section.title}`);
  }

  function addChildSection(nodeId: string, requestedName = 'new_section'): void {
    const section = sectionFromGraphNodeId(nodeId);
    if (!editor.doc || !editor.tree || !section) return;
    if (!/^[a-z][a-z0-9_]*$/i.test(requestedName)) return;
    const name = uniqueSectionTagName(editor.tree, requestedName);
    applyStructureEdit(insertChildSection(editor.doc.text, section, name), `add sub-section under ${section.title}`);
  }

  /**
   * Removes the section. Returns whether a section was actually removed, so the caller can drop
   * any selection/edit state that pointed at the now-gone node.
   */
  function removeSection(nodeId: string): boolean {
    const section = sectionFromGraphNodeId(nodeId);
    if (!editor.doc || !section) return false;
    applyStructureEdit(removeSectionText(editor.doc.text, section), `remove ${section.title}`);
    return true;
  }

  function moveSection(nodeId: string, direction: 'up' | 'down'): void {
    const section = sectionFromGraphNodeId(nodeId);
    if (!editor.doc || !editor.tree || !section) return;
    const nextText = moveSectionAmongSiblings(editor.doc.text, editor.tree, section.id, direction);
    // null = already first/last among its siblings — a silent no-op, matching the disabled feel
    // of pressing an arrow at a list boundary.
    if (nextText === null) return;
    applyStructureEdit(nextText, `move ${section.title} ${direction}`);
  }

  return { addSiblingSection, addChildSection, removeSection, moveSection };
}

export type StructureEdits = ReturnType<typeof useStructureEdits>;
