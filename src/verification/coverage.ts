import type { SectionVerificationCoverage, VerificationCheckStatus } from '@prompt-studio/prompt-graph-ui';
import {
  getLegacyConsolidatedVerificationProfile,
  PROMPT_STRUCTURE_CONTRACTS,
  type PromptTree,
  type PromptTreeNode,
  type PromptVerificationProfile,
} from '@prompt-studio/prompts';
import type { CatalogRoot } from '../catalog/root-catalog';
import { primaryEditableKeyFor, type VerificationRunResult } from '../panels/root-verification';
import { WHOLE_PROMPT } from '../panels/verification/verification-editing';

function counts(
  sectionId: string,
  profiles: readonly PromptVerificationProfile[],
  automaticStatus: VerificationCheckStatus,
  aiStatus: VerificationCheckStatus,
): SectionVerificationCoverage {
  const rules = profiles.flatMap((profile) => profile.deterministicRules);
  const criteria = profiles.flatMap((profile) => profile.principles);
  const basic = rules.filter(
    (rule) => rule.kind === 'non-empty' || rule.kind === 'known-placeholder' || rule.kind === 'cache-sensitive-dynamic',
  ).length;
  const generated = criteria.filter((criterion) => criterion.id.startsWith(`${sectionId}.structure.`)).length;
  return {
    sectionId,
    automatic: { basic, custom: rules.length - basic, status: automaticStatus },
    ai: { generated, custom: criteria.length - generated, status: aiStatus },
  };
}

/** Project configured coverage without executing checks or inheriting whole-prompt counts into sections. */
export function verificationCoverage(
  root: CatalogRoot,
  tree: PromptTree,
  result: VerificationRunResult | null,
  aiStatusBySectionId: Readonly<Record<string, VerificationCheckStatus>> = {},
): {
  byNodeId: Record<string, SectionVerificationCoverage>;
  wholePrompt: SectionVerificationCoverage;
} {
  const key = primaryEditableKeyFor(root);
  const profiles =
    root.verification?.profiles ??
    (key && key in PROMPT_STRUCTURE_CONTRACTS ? [getLegacyConsolidatedVerificationProfile(key)] : []);
  function status(selected: readonly PromptVerificationProfile[]): VerificationCheckStatus {
    if (!result || !selected.length) return 'not-checked';
    return result.text === tree.text &&
      selected.every(
        (profile) =>
          JSON.stringify(result.profiles.find((checked) => checked.id === profile.id)) === JSON.stringify(profile),
      )
      ? 'current'
      : 'stale';
  }
  const byNodeId: Record<string, SectionVerificationCoverage> = {};
  function visit(nodes: readonly PromptTreeNode[]) {
    for (const node of nodes) {
      const section = root.verification?.sections.find((section) =>
        section.nodeId ? section.nodeId === node.id : section.tag === node.tag,
      );
      const sectionId = section?.id ?? node.id;
      const selected = profiles.filter(
        (profile) =>
          profile.scope === 'section' && profile.sectionId === sectionId && profile.id === section?.profileId,
      );
      byNodeId[`section:${node.id}`] = counts(
        sectionId,
        selected,
        status(selected),
        aiStatusBySectionId[sectionId] ?? 'not-checked',
      );
      visit(node.children);
    }
  }
  visit(tree.children);
  const wholeProfiles = profiles.filter((profile) => profile.scope !== 'section');
  const wholePrompt = counts(
    root.id,
    wholeProfiles,
    status(wholeProfiles),
    aiStatusBySectionId[WHOLE_PROMPT] ?? 'not-checked',
  );
  return { byNodeId, wholePrompt: { ...wholePrompt, sectionId: WHOLE_PROMPT } };
}
