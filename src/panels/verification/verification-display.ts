import { parsePromptTree, type PromptTreeNode, type PromptVerificationFinding } from '@prompt-studio/prompts';
import type { CatalogRoot } from '../../catalog/root-catalog';
import type { VerificationRunResult } from '../root-verification';

export function findingSourceRange(
  root: CatalogRoot,
  text: string,
  result: VerificationRunResult | null,
  finding: PromptVerificationFinding,
) {
  const nodeId = finding.scope === 'section' ? result?.sectionNodeIds[finding.sectionId] : undefined;
  const tree = parsePromptTree({ key: root.id, text, toolNames: root.toolNames });
  function find(nodes: readonly PromptTreeNode[]): PromptTreeNode | undefined {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      const child = find(node.children);
      if (child) return child;
    }
    return undefined;
  }
  const node = nodeId ? find(tree.children) : undefined;
  const start = node?.range.start ?? 0;
  const end = node?.range.end ?? text.length;
  const quote = finding.source === 'semantic' ? finding.evidenceQuote : finding.subject;
  const match = quote ? text.indexOf(quote, start) : -1;
  return match >= start && match < end
    ? { start: match, end: Math.min(end, match + (quote?.length ?? 0)) }
    : { start, end: start };
}

export function sortedFindings(findings: readonly PromptVerificationFinding[]) {
  const severity = { error: 0, warning: 1, info: 2 };
  return [...findings].sort((a, b) => severity[a.severity] - severity[b.severity]);
}
