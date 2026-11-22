import { PROMPT_PLACEHOLDER_RE, type PromptTree, type PromptTreeNode } from '@prompt-studio/prompts';

/**
 * Prose-document fallback (ADR-235, task #17).
 *
 * The manifest's fragment documents (icp, persona, discovery_protocol) are plain prose — no
 * headings, labels, or tags — so `parsePromptTree` recognizes zero sections and the canvas has
 * nothing to render: no card, no selection, no inspector, no edit path. Rather than grow a second
 * prose-specific editor surface, this helper synthesizes ONE section covering the document's full
 * extent whenever a parse produced no sections, so every downstream machine — canvas card,
 * inspector, `FragmentEditDialog` splice-back at the section's own byte range, verification
 * attribution, blueprint export — works on prose exactly as it works on sectioned prompts.
 *
 * The synthesized node's `range` spans `[0, text.length]`, which makes the edit dialog's
 * whole-body splice semantically identical to "edit the whole document". Deliberately a
 * studio-side projection: the parser's contract (what the source IS) stays untouched — this is
 * what the studio chooses to render when the source has no structure to show.
 */

/** The id is stable and names exactly what this node is — never an index (see PromptTreeNode.id). */
const PROSE_NODE_ID = 'prose-document';

export function ensureSectionedTree(tree: PromptTree): PromptTree {
  if (tree.children.length > 0 || tree.text.trim().length === 0) {
    return tree;
  }

  const variables: string[] = [];
  for (const match of tree.text.matchAll(PROMPT_PLACEHOLDER_RE)) {
    const name = match[1];
    if (name !== undefined && !variables.includes(name)) {
      variables.push(name);
    }
  }

  const proseNode: PromptTreeNode = {
    id: PROSE_NODE_ID,
    title: 'Document',
    // No delimiter syntax produced this node; 'caps-label' is the closest honest kind (a bare
    // text block), and `tag` stays absent because there is no XML tag to carry.
    delimiter: 'caps-label',
    depth: 1,
    text: tree.text,
    range: { start: 0, end: tree.text.length },
    variables,
    toolMentions: [],
    children: [],
  };

  return { ...tree, children: [proseNode], maxDepth: 1 };
}
