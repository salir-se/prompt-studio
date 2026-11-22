import type { PromptTreeNode } from './tree/types';

/** XML identities remain compatible; Markdown identities reuse the parser's stable source path. */
export function promptSectionId(rootId: string, node: PromptTreeNode): string {
  return node.tag ? `${rootId}.${node.tag}` : `${rootId}#${node.id}`;
}

export function promptDesignSections(nodes: readonly PromptTreeNode[]): readonly PromptTreeNode[] {
  return nodes.flatMap((node) => [
    ...(node.tag || node.text.trim() !== '' || node.children.length === 0 ? [node] : []),
    ...promptDesignSections(node.children),
  ]);
}
