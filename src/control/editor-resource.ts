import { ControlCommandError, EDITOR_RESOURCES, type EditorResource } from '@prompt-studio/control-protocol';
import { parsePromptTree } from '@prompt-studio/prompts';
import { ensureSectionedTree } from '../catalog/prose-tree';
import type { AppCommandSurface } from './app-commands';
import { describeSections } from './section-commands';

export interface EditorEvent {
  readonly action: 'document.opened' | 'document.edited' | 'document.applied' | 'check.saved' | 'version.saved';
  readonly rootId: string | null;
  readonly at: string;
}

export function readEditorResource(
  surface: AppCommandSurface,
  raw: unknown,
  getFindings?: (params: unknown) => unknown,
) {
  const resource = (raw as { resource?: EditorResource } | null)?.resource;
  if (resource === undefined || !EDITOR_RESOURCES.includes(resource)) {
    throw new ControlCommandError('invalid_input', 'Choose a document, sections, findings or events resource.');
  }
  if (resource === 'events') return surface.editorEvents ?? [];
  const document = surface.loadedDocument;
  if (!document) return resource === 'sections' ? [] : null;
  if (resource === 'findings') {
    return surface.verification?.root?.verification && getFindings
      ? getFindings({ rootId: document.rootId, variantSymbol: document.variantSymbol })
      : null;
  }
  const text = surface.editorDraft?.text ?? document.text;
  const draft = surface.editorDraft?.dirty ?? false;
  if (resource === 'document') return { ...document, text, draft };
  const tree = draft
    ? ensureSectionedTree(
        parsePromptTree({
          key: document.rootId,
          text,
          toolNames: surface.roots.find((root) => root.id === document.rootId)?.toolNames,
        }),
      )
    : surface.sections?.tree;
  return tree ? describeSections(tree) : [];
}
