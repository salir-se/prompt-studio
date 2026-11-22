import {
  derivePromptVerificationState,
  getLegacyConsolidatedVerificationProfile,
  parsePromptTree,
  PROMPT_KEY_TOOL_NAMES,
  PROMPT_STRUCTURE_CONTRACTS,
  PROMPT_VARIABLE_DOCS,
  type PromptTreeNode,
  type PromptVerificationFinding,
  type PromptVerificationPrinciple,
  type PromptVerificationProfile,
  type PromptVerificationState,
  runLegacyVerificationProfile,
  runPromptVerificationProfile,
} from '@prompt-studio/prompts';
import type { CanonicalPromptSection } from '../catalog/canonical-prompt-contract';
import type { CatalogRoot } from '../catalog/root-catalog';

/**
 * Deterministic verification wiring for the top-bar "Verify" button. Migrated roots run their
 * canonical section plus consolidated profiles; unmigrated roots retain the legacy whole-document
 * fallback. This path always runs independently of the optional semantic layer below.
 *
 * A full `PromptStructureContract` — and therefore a registered verification profile — exists for
 * only a subset of prompt keys (see `structure-contracts.ts`'s `DEFAULT_TEXT` map). `canVerifyRoot`
 * is the single gate the top-bar button and this module share so they never disagree about whether a
 * root is verifiable.
 *
 * ── Optional semantic (LLM) review ──────────────────────────────────────────────────────────────
 * `VerificationPanel` also offers an OPT-IN "Run semantic review" button that POSTs the selected
 * section, its principles, and its minimum declared context to the studio server's `POST /verify` —
 * never automatically, since a semantic call spends tokens. Its result is a small local state
 * machine (`idle | loading | results | unavailable | budget-exhausted | failed`), rendered in a
 * section visually distinct from the deterministic `VerificationNode` above it (a violet-tinted
 * card with an "AI" badge on each finding) so nobody mistakes an LLM opinion for a deterministic
 * rule result. `unavailable` (no provider key configured) is deliberately informational, not an
 * error — it's the default state for anyone running the studio without a key.
 */

/**
 * The editable key this root is verified against. Prefers the key that matches the root's own id
 * (e.g. scout's `editableKeys` is `['icp', 'scout']` — 'scout' is the prompt itself, 'icp' is a
 * value injected into it) and falls back to the first editable key otherwise. `undefined` when the
 * root has no editable key at all.
 */
export function primaryEditableKeyFor(root: CatalogRoot): string | undefined {
  const keys = root.entry.editableKeys;
  if (keys.length === 0) return undefined;
  return keys.find((key) => key === root.id) ?? keys[0];
}

/** True iff this root has an editable key AND that key has a registered structure contract. */
export function canVerifyRoot(root: CatalogRoot): boolean {
  const key = primaryEditableKeyFor(root);
  return root.verification !== undefined || (key !== undefined && key in PROMPT_STRUCTURE_CONTRACTS);
}

/**
 * Human-readable reason the Verify button is disabled for `root` (`undefined` when it is enabled) —
 * shown as the button's `title` tooltip.
 */
export function verifyDisabledReason(root: CatalogRoot | undefined): string | undefined {
  if (!root) return 'Select a prompt root first.';
  if (root.loadability !== 'constant') {
    return 'Verification runs against a single loaded document — this root has no fixed document text to check.';
  }
  if (root.verification) return undefined;
  if (root.entry.editableKeys.length === 0) {
    return 'This root has no editable prompt key to verify.';
  }
  if (!canVerifyRoot(root)) {
    return `No deterministic verification profile is registered for "${primaryEditableKeyFor(root)}".`;
  }
  return undefined;
}

export interface VerificationRunResult {
  readonly promptKey: string;
  /** The exact document text this run verified — reused as the semantic review's request body. */
  readonly text: string;
  readonly state: PromptVerificationState;
  readonly principles: readonly PromptVerificationPrinciple[];
  readonly findings: readonly PromptVerificationFinding[];
  readonly profiles: readonly PromptVerificationProfile[];
  readonly sections: readonly VerificationSectionResult[];
  readonly sectionNodeIds: Readonly<Record<string, string>>;
}

export interface VerificationSectionDependency {
  readonly sectionId: string;
  readonly text: string;
}

export interface VerificationSectionResult {
  readonly sectionId: string;
  readonly heading: string;
  readonly text: string;
  readonly profile: PromptVerificationProfile;
  readonly dependencies: readonly VerificationSectionDependency[];
}

function uniquePrinciples(profiles: readonly PromptVerificationProfile[]): readonly PromptVerificationPrinciple[] {
  const seen = new Set<string>();
  return profiles.flatMap((profile) =>
    profile.principles.filter((principle) => {
      const key = `${principle.id}@${principle.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

function canonicalSectionText(
  text: string,
  tag: string,
  node: PromptTreeNode | undefined,
  childNodes: readonly { tag: string; node: PromptTreeNode }[],
): string {
  if (!node) return '';
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const openStart = text.indexOf(openTag, node.range.start);
  const closeStart = text.indexOf(closeTag, openStart + openTag.length);
  if (openStart < 0 || closeStart < 0) return '';
  let innerStart = openStart + openTag.length;
  if (text[innerStart] === '\n') innerStart += 1;

  const removals = childNodes
    .map(({ tag: childTag, node: childNode }) => {
      const childTagStart = text.indexOf(`<${childTag}>`, childNode.range.start);
      const tagLineStart = text.lastIndexOf('\n', childTagStart - 1) + 1;
      const headingStart = text.lastIndexOf('\n', tagLineStart - 2) + 1;
      const childClose = text.indexOf(`</${childTag}>`, childTagStart);
      return { start: headingStart, end: childClose < 0 ? headingStart : childClose + childTag.length + 3 };
    })
    .filter((range) => range.start >= innerStart && range.end <= closeStart)
    .sort((left, right) => left.start - right.start);

  let cursor = innerStart;
  const parts: string[] = [];
  for (const removal of removals) {
    parts.push(text.slice(cursor, removal.start));
    cursor = removal.end;
    if (text[cursor] === '\n') cursor += 1;
  }
  parts.push(text.slice(cursor, closeStart));
  return parts.join('').trim();
}

/** Runs canonical section profiles when available, retaining the legacy consolidated fallback for unmigrated roots. */
export function runRootVerification(root: CatalogRoot, text: string): VerificationRunResult | null {
  const promptKey = primaryEditableKeyFor(root);
  if (root.verification) {
    const definition = root.verification;
    const dynamicVariableNames = root.design?.variables
      .filter((variable) => variable.lifecycle !== 'configuration')
      .map((variable) => variable.name);
    const tree = parsePromptTree({ key: root.id, text, toolNames: definition.toolNames });
    const nodesByTag = new Map<string, (typeof tree.children)[number]>();
    const nodesById = new Map<string, PromptTreeNode>();
    const visit = (nodes: typeof tree.children): void => {
      for (const node of nodes) {
        if (node.tag) nodesByTag.set(node.tag, node);
        nodesById.set(node.id, node);
        visit(node.children);
      }
    };
    visit(tree.children);

    const profilesById = new Map(definition.profiles.map((profile) => [profile.id, profile]));
    const sectionNodeIds: Record<string, string> = {};
    const nodeFor = (section: CanonicalPromptSection) =>
      section.nodeId ? nodesById.get(section.nodeId) : nodesByTag.get(section.tag);
    const textFor = (section: CanonicalPromptSection): string => {
      const node = nodeFor(section);
      if (section.nodeId) return node?.text ?? '';
      const children = definition.sections.flatMap((candidate) => {
        const child = candidate.parentId === section.id && !candidate.nodeId ? nodeFor(candidate) : undefined;
        return child ? [{ tag: candidate.tag, node: child }] : [];
      });
      return canonicalSectionText(text, section.tag, node, children);
    };
    const sections = definition.sections.map((section): VerificationSectionResult => {
      const profile = profilesById.get(section.profileId);
      if (profile?.scope !== 'section') {
        throw new TypeError(`Canonical section ${section.id} has no section verification profile`);
      }
      const node = nodeFor(section);
      if (node) sectionNodeIds[section.id] = node.id;
      const sectionText = textFor(section);
      const dependencyIds = new Set(
        profile.principles.flatMap((principle) => principle.sectionIds).filter((id) => id !== section.id),
      );
      const dependencies = definition.sections.flatMap((candidate) => {
        if (!dependencyIds.has(candidate.id)) return [];
        const dependencyNode = nodeFor(candidate);
        if (!dependencyNode) return [];
        return [
          {
            sectionId: candidate.id,
            text: textFor(candidate),
          },
        ];
      });
      return { sectionId: section.id, heading: section.heading, text: sectionText, profile, dependencies };
    });
    const findings = [
      ...sections.flatMap((section) =>
        runPromptVerificationProfile(section.profile, section.text, {
          toolNames: definition.toolNames,
          dynamicVariableNames,
          outputContract: root.design?.sectionDesigns.find((design) => design.sectionId === section.sectionId)?.output,
        }),
      ),
      ...definition.profiles
        .filter((profile) => profile.scope !== 'section')
        .flatMap((profile) =>
          runPromptVerificationProfile(profile, text, {
            toolNames: definition.toolNames,
            dynamicVariableNames,
            outputContract: root.design?.output,
          }),
        ),
    ];
    const promptScopes = root.design
      ? definition.profiles.flatMap((profile): VerificationSectionResult[] =>
          profile.scope === 'consolidated' &&
          profile.principles.some((principle) => principle.id.startsWith(`${root.id}.structure.`))
            ? [{ sectionId: root.id, heading: 'Whole prompt', text, profile, dependencies: [] }]
            : [],
        )
      : [];
    return {
      promptKey: promptKey ?? root.id,
      text,
      state: derivePromptVerificationState('not-run', findings),
      principles: uniquePrinciples(definition.profiles),
      findings,
      profiles: definition.profiles,
      sections: [...sections, ...promptScopes],
      sectionNodeIds,
    };
  }

  if (!promptKey || !(promptKey in PROMPT_STRUCTURE_CONTRACTS)) return null;

  const profile = getLegacyConsolidatedVerificationProfile(promptKey);
  const doc = PROMPT_VARIABLE_DOCS[promptKey];
  const knownVariables = doc ? [...doc.variables.map((variable) => variable.key), ...(doc.alsoResolves ?? [])] : [];
  const toolNames = PROMPT_KEY_TOOL_NAMES[promptKey] ?? [];

  const findings = runLegacyVerificationProfile(promptKey, text, profile, { knownVariables, toolNames });
  return {
    promptKey,
    text,
    state: derivePromptVerificationState('not-run', findings),
    principles: profile.principles,
    findings,
    profiles: [profile],
    sections: [],
    sectionNodeIds: {},
  };
}
