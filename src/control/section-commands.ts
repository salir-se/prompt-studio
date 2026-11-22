/**
 * Section commands for remote control (roadmap #6; docs/remote-control.md): list, read, edit, insert, move and
 * remove ONE section of the open document. Every edit goes through the canvas's own structure operations
 * (`useStructureEdits`), so it is one text change through the editor's save path — an undo point, a commit, and
 * a live update of the graph and the outline — exactly as if the person had used the section menu.
 *
 * Section ids are the parse tree's ids (the same ids the outline and the graph use, without the graph's
 * `section:` prefix; a nested section's id is its path, `tools/retry`). An xml section's tag is accepted as well.
 */

import { ControlCommandError } from '@prompt-studio/control-protocol';
import type { PromptTree, PromptTreeNode } from '@prompt-studio/prompts';
import { findSectionNode, sectionOwnBody } from '../hooks/section-edit';
import { type AppliedStructureEdit, SECTION_TAG_PATTERN } from '../hooks/use-structure-edits';
import type { ControlHandler } from './control-channel';

/** The editor surface the section commands need. */
export interface SectionCommandSurface {
  readonly loadedDocument: { readonly rootId: string; readonly variantSymbol?: string; readonly text: string } | null;
  /** The parse tree the outline and the graph show for the loaded document. */
  readonly tree: PromptTree | null;
  /** Asks the person to discard unsaved panel changes first; false = they kept them. */
  confirmDiscard(): boolean;
  readonly structure: {
    addSection(
      nodeId: string,
      position: 'after' | 'firstChild',
      name: string,
      body?: string,
      message?: string,
    ): AppliedStructureEdit | null;
    moveSection(nodeId: string, direction: 'up' | 'down'): boolean;
    removeSection(nodeId: string): boolean;
    editSectionBody(nodeId: string, body: string, message?: string): string | null;
  };
}

/** One section as `listSections` reports it. */
export interface SectionSummary {
  readonly id: string;
  readonly title: string;
  /** How the section is spelled: `xml-tag` (`<tag>…</tag>`), `atx-heading` (`## Title`) or `caps-label` (`TITLE:`). */
  readonly delimiter: PromptTreeNode['delimiter'];
  readonly tag?: string;
  /** 1 for a top-level section. */
  readonly depth: number;
  readonly parentId: string | null;
  /** Position among its siblings, from 0. */
  readonly index: number;
  /** Position in the document, from 0. */
  readonly order: number;
  readonly childIds: readonly string[];
  /** `{{variables}}` used in the section's own body. */
  readonly variables: readonly string[];
}

/** Every section in document order (depth first). */
export function describeSections(tree: PromptTree): SectionSummary[] {
  const sections: SectionSummary[] = [];
  const walk = (nodes: readonly PromptTreeNode[], parentId: string | null) => {
    nodes.forEach((node, index) => {
      sections.push({
        id: node.id,
        title: node.title,
        delimiter: node.delimiter,
        ...(node.tag === undefined ? {} : { tag: node.tag }),
        depth: node.depth,
        parentId,
        index,
        order: sections.length,
        childIds: node.children.map((child) => child.id),
        variables: [...node.variables],
      });
      walk(node.children, node.id);
    });
  };
  walk(tree.children, null);
  return sections;
}

function record(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
}

function text(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ControlCommandError('invalid_input', `${key} must be a string.`);
  return value;
}

function requiredText(args: Record<string, unknown>, key: string): string {
  const value = text(args, key);
  if (value === undefined || value === '') throw new ControlCommandError('invalid_input', `${key} is required.`);
  return value;
}

export function buildSectionCommands(surface: SectionCommandSurface): Record<string, ControlHandler> {
  /** The open document's tree, after checking the caller targets the open document. */
  function openTree(args: Record<string, unknown>): { rootId: string; tree: PromptTree; source: string } {
    const rootId = requiredText(args, 'rootId');
    const variantSymbol = text(args, 'variantSymbol');
    const loaded = surface.loadedDocument;
    if (loaded === null) {
      throw new ControlCommandError('command_failed', 'Open a document first (openDocument).');
    }
    if (loaded.rootId !== rootId || loaded.variantSymbol !== variantSymbol) {
      throw new ControlCommandError(
        'command_failed',
        `Open "${rootId}" first (openDocument) — section commands apply to the open document, now "${loaded.rootId}".`,
      );
    }
    if (surface.tree === null) throw new ControlCommandError('not_ready', 'The document is still loading.');
    return { rootId, tree: surface.tree, source: loaded.text };
  }

  function section(tree: PromptTree, sectionId: string): PromptTreeNode {
    // An xml section's tag (`output_format`) is accepted too: agents read tags in the text, ids in listSections.
    const tagged = describeSections(tree).filter((candidate) => candidate.tag === sectionId);
    const node =
      findSectionNode(tree.children, sectionId) ??
      (tagged.length === 1 ? findSectionNode(tree.children, tagged[0].id) : null);
    if (!node) {
      throw new ControlCommandError('missing_target', `No section "${sectionId}" — run listSections for ids.`);
    }
    return node;
  }

  function confirm(): void {
    if (!surface.confirmDiscard()) {
      throw new ControlCommandError(
        'command_failed',
        'The person kept unsaved changes in an open panel, so nothing changed. Ask them to save or close it.',
      );
    }
  }

  return {
    listSections: (raw) => {
      const { rootId, tree } = openTree(record(raw));
      return { rootId, sections: describeSections(tree) };
    },

    readSection: (raw) => {
      const args = record(raw);
      const { tree, source } = openTree(args);
      const node = section(tree, requiredText(args, 'sectionId'));
      const summary = describeSections(tree).find((candidate) => candidate.id === node.id) as SectionSummary;
      const body = sectionOwnBody(source, node);
      if (!body) {
        throw new ControlCommandError('command_failed', `Could not locate "${node.title}" in the text. Read it again.`);
      }
      return { ...summary, body: body.text };
    },

    editSection: (raw) => {
      const args = record(raw);
      const { rootId, tree } = openTree(args);
      const node = section(tree, requiredText(args, 'sectionId'));
      const body = text(args, 'body');
      if (body === undefined) throw new ControlCommandError('invalid_input', 'body is required.');
      confirm();
      if (surface.structure.editSectionBody(`section:${node.id}`, body, text(args, 'message')) === null) {
        throw new ControlCommandError('command_failed', `Could not locate "${node.title}" in the text. Read it again.`);
      }
      return { rootId, edited: node.id };
    },

    insertSection: (raw) => {
      const args = record(raw);
      const { rootId, tree } = openTree(args);
      const anchor = section(tree, requiredText(args, 'sectionId'));
      const position = text(args, 'position') ?? 'after';
      if (position !== 'after' && position !== 'firstChild') {
        throw new ControlCommandError('invalid_input', 'position must be "after" or "firstChild".');
      }
      const tag = requiredText(args, 'tag');
      if (!SECTION_TAG_PATTERN.test(tag)) {
        throw new ControlCommandError(
          'invalid_input',
          `tag "${tag}" must start with a letter and use only letters, digits and _ (for example "examples").`,
        );
      }
      confirm();
      const applied = surface.structure.addSection(
        `section:${anchor.id}`,
        position,
        tag,
        text(args, 'body'),
        text(args, 'message'),
      );
      if (applied === null) {
        throw new ControlCommandError('command_failed', `Could not insert "${tag}" next to "${anchor.title}".`);
      }
      return { rootId, inserted: applied.sectionId, position, anchor: anchor.id };
    },

    moveSection: (raw) => {
      const args = record(raw);
      const { rootId, tree } = openTree(args);
      const node = section(tree, requiredText(args, 'sectionId'));
      const direction = text(args, 'direction');
      if (direction !== 'up' && direction !== 'down') {
        throw new ControlCommandError('invalid_input', 'direction must be "up" or "down".');
      }
      confirm();
      if (!surface.structure.moveSection(`section:${node.id}`, direction)) {
        throw new ControlCommandError(
          'command_failed',
          `"${node.title}" is already ${direction === 'up' ? 'first' : 'last'} among its siblings.`,
        );
      }
      return { rootId, moved: node.id, direction };
    },

    removeSection: (raw) => {
      const args = record(raw);
      const { rootId, tree } = openTree(args);
      const node = section(tree, requiredText(args, 'sectionId'));
      confirm();
      if (!surface.structure.removeSection(`section:${node.id}`)) {
        throw new ControlCommandError('command_failed', `Could not remove "${node.title}".`);
      }
      return { rootId, removed: node.id };
    },
  };
}
