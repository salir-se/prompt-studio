/**
 * The canvas's section-structure operations (ADR-202): add sibling / add sub-section / remove /
 * move among siblings / replace a section's own body — each a pure text transformation over the working
 * document, applied through the editor's transactional write path (undo point, staleness clear, ADR-203
 * auto-commit). The canvas, the outline and the remote-control commands (`src/control/section-commands.ts`)
 * all call these functions, so a section edit from an agent is the same edit as one from a click.
 *
 * Each operation returns what it applied (or null / false when nothing changed), so a remote caller can report
 * the outcome; the UI ignores the return value.
 */

import {
  moveSectionAmongSiblings,
  type PromptTreeNode,
  removeSectionText,
  uniqueSectionTagName,
} from '@prompt-studio/prompts';
import { insertSectionText, spliceSectionOwnBody } from './section-edit';
import type { DocumentEditor } from './use-document-editor';

/** A section edit that landed: the new document text, and the section it created or changed. */
export interface AppliedStructureEdit {
  readonly text: string;
  readonly sectionId: string;
}

export const SECTION_TAG_PATTERN = /^[a-z][a-z0-9_]*$/i;

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

  function addSection(
    nodeId: string,
    position: 'after' | 'firstChild',
    requestedName: string,
    body?: string,
    message?: string,
  ): AppliedStructureEdit | null {
    const section = sectionFromGraphNodeId(nodeId);
    if (!editor.doc || !editor.tree || !section) return null;
    if (!SECTION_TAG_PATTERN.test(requestedName)) return null;
    const name = uniqueSectionTagName(editor.tree, requestedName);
    const inserted = insertSectionText(editor.doc.text, editor.doc.rootId, section, position, name, body);
    if (!inserted) return null;
    const { text } = inserted;
    applyStructureEdit(
      text,
      message ??
        (position === 'after' ? `add section after ${section.title}` : `add sub-section under ${section.title}`),
    );
    return { text, sectionId: inserted.sectionId };
  }

  function addSiblingSection(nodeId: string, requestedName = 'new_section'): AppliedStructureEdit | null {
    return addSection(nodeId, 'after', requestedName);
  }

  function addChildSection(nodeId: string, requestedName = 'new_section'): AppliedStructureEdit | null {
    return addSection(nodeId, 'firstChild', requestedName);
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

  /** Returns false when the section is already first/last among its siblings (a silent no-op in the UI). */
  function moveSection(nodeId: string, direction: 'up' | 'down'): boolean {
    const section = sectionFromGraphNodeId(nodeId);
    if (!editor.doc || !editor.tree || !section) return false;
    const nextText = moveSectionAmongSiblings(editor.doc.text, editor.tree, section.id, direction);
    if (nextText === null) return false;
    applyStructureEdit(nextText, `move ${section.title} ${direction}`);
    return true;
  }

  /** Replaces the section's own body; returns the new text, or null when the section cannot be located. */
  function editSectionBody(nodeId: string, body: string, message?: string): string | null {
    const section = sectionFromGraphNodeId(nodeId);
    if (!editor.doc || !section) return null;
    const nextText = spliceSectionOwnBody(editor.doc.text, section, body);
    if (nextText === null) return null;
    if (nextText !== editor.doc.text) applyStructureEdit(nextText, message ?? `edit ${section.title}`);
    return nextText;
  }

  return { addSection, addSiblingSection, addChildSection, removeSection, moveSection, editSectionBody };
}

export type StructureEdits = ReturnType<typeof useStructureEdits>;
