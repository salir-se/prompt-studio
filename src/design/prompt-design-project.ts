import {
  type PromptDesign,
  type PromptTreeNode,
  type PromptVerificationPrinciple,
  type PromptVerificationProfile,
  parsePromptDesign,
  parsePromptTree,
  promptDesignSections,
  promptSectionId,
} from '@prompt-studio/prompts';
import type { CanonicalPromptRoot, CanonicalPromptSection } from '../catalog/canonical-prompt-contract';
import type { CatalogRoot } from '../catalog/root-catalog';
import { initializeSectionMetadata } from './section-metadata';

const PROMPT_DESIGN_KEY_PREFIX = '__prompt-design__-';

export function promptDesignProviderKey(rootId: string): string {
  return `${PROMPT_DESIGN_KEY_PREFIX}${rootId}`;
}

export function serializePromptDesign(design: PromptDesign): string {
  return `${JSON.stringify(design, null, 2)}\n`;
}

function titleForTag(tag: string): string {
  return tag
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function fallbackSectionProfile(sectionId: string): PromptVerificationProfile {
  return {
    id: `${sectionId}.verification`,
    version: 1,
    scope: 'section',
    sectionId,
    deterministicRules: [{ id: 'non-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' }],
    principles: [],
  };
}

function structurePrinciples(
  id: string,
  version: number,
  contract: Pick<PromptDesign, 'input' | 'workflow' | 'output'>,
  sectionIds: readonly string[],
): readonly PromptVerificationPrinciple[] {
  const inputContract =
    contract.input.kind === 'json'
      ? `${contract.input.description}\nJSON Schema:\n${JSON.stringify(contract.input.jsonSchema, null, 2)}`
      : contract.input.description;
  const outputContract =
    contract.output.kind === 'json'
      ? `${contract.output.description}\nJSON Schema:\n${JSON.stringify(contract.output.jsonSchema, null, 2)}`
      : contract.output.kind === 'tool-call'
        ? `${contract.output.description}\nRequired terminal tool: ${contract.output.requiredToolName}`
        : contract.output.description;
  const workflow = contract.workflow.trim() || 'No workflow is defined.';
  return [
    {
      id: `${id}.structure.input`,
      version,
      owner: 'configuration',
      statement: `The prompt must clearly define and correctly handle this ${contract.input.kind} input contract:\n${inputContract}`,
      severity: 'warning',
      allowedCustomization: 'Change the input contract and prompt instructions together so they remain consistent.',
      sectionIds,
    },
    {
      id: `${id}.structure.workflow`,
      version,
      owner: 'configuration',
      statement: `The prompt instructions must be consistent with this authored workflow:\n${workflow}`,
      severity: 'warning',
      allowedCustomization:
        'Use any Mermaid diagram or workflow language; keep the prompt instructions consistent with it.',
      sectionIds,
    },
    {
      id: `${id}.structure.output`,
      version,
      owner: 'configuration',
      statement: `The prompt must clearly require and correctly produce this ${contract.output.kind} output contract:\n${outputContract}`,
      severity: 'warning',
      allowedCustomization: 'Change the output contract and prompt instructions together so they remain consistent.',
      sectionIds,
    },
  ];
}

function addStructurePrinciples(
  profile: PromptVerificationProfile,
  principles: readonly PromptVerificationPrinciple[],
): PromptVerificationProfile {
  const ids = new Set(principles.map((principle) => principle.id));
  return {
    ...profile,
    principles: [...principles, ...profile.principles.filter((principle) => !ids.has(principle.id))],
  };
}

function canonicalRootFromDesign(design: PromptDesign, text: string): CanonicalPromptRoot {
  const tree = parsePromptTree({ key: design.id, text, toolNames: design.tools });
  const sections: CanonicalPromptSection[] = [];
  const designNodeIds = new Set(promptDesignSections(tree.children).map((node) => node.id));
  const profiles = [...design.verificationProfiles];
  const sectionProfiles = new Map<string, PromptVerificationProfile>();
  for (const profile of profiles) {
    if (profile.scope === 'section') sectionProfiles.set(profile.sectionId, profile);
  }

  function visit(nodes: readonly PromptTreeNode[], parentId?: string, heading?: string): void {
    for (const node of nodes) {
      const nextHeading = node.delimiter === 'atx-heading' ? node.title : heading;
      if (!designNodeIds.has(node.id)) {
        visit(node.children, parentId, nextHeading);
        continue;
      }
      const sectionId = promptSectionId(design.id, node);
      let profile = sectionProfiles.get(sectionId);
      if (!profile) {
        profile = fallbackSectionProfile(sectionId);
        profiles.push(profile);
        sectionProfiles.set(sectionId, profile);
      }
      sections.push({
        id: sectionId,
        tag: node.tag ?? '',
        ...(!node.tag ? { nodeId: node.id } : {}),
        heading: node.tag ? (nextHeading ?? titleForTag(node.tag)) : node.title,
        profileId: profile.id,
        ...(parentId ? { parentId } : {}),
      });
      visit(node.children, sectionId, undefined);
    }
  }
  visit(tree.children);
  for (const section of sections) {
    const profileIndex = profiles.findIndex((profile) => profile.id === section.profileId);
    const profile = profiles[profileIndex];
    const sectionDesign = design.sectionDesigns.find((candidate) => candidate.sectionId === section.id);
    if (profile?.scope !== 'section' || !sectionDesign) continue;
    profiles[profileIndex] = addStructurePrinciples(
      profile,
      structurePrinciples(section.id, design.version, sectionDesign, [section.id]),
    );
  }
  const sectionIds = sections.map((section) => section.id);
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    if (profile?.scope !== 'consolidated') continue;
    profiles[index] = addStructurePrinciples(
      {
        ...profile,
        deterministicRules: [
          ...profile.deterministicRules.filter((rule) => rule.id !== 'cache-sensitive-dynamic'),
          {
            id: 'cache-sensitive-dynamic',
            kind: 'cache-sensitive-dynamic',
            severity: 'warning',
            enforcement: 'edit',
          },
        ],
      },
      structurePrinciples(design.id, design.version, design, sectionIds),
    );
  }
  return { id: design.id, text, toolNames: design.tools, sections, profiles };
}

export function withPromptStructure(root: CatalogRoot, text: string): CatalogRoot {
  if (!root.design) return root;
  const design = initializeSectionMetadata(root.design, text);
  return { ...root, design, verification: canonicalRootFromDesign(design, text) };
}

function authoredCatalogRoot(sourceDesign: PromptDesign, text: string): CatalogRoot {
  const design = initializeSectionMetadata(sourceDesign, text);
  return {
    id: design.id,
    title: design.title,
    loadability: 'constant',
    status: 'live',
    text,
    toolNames: design.tools,
    protectedSkills: [],
    ownerLabel: '<studio authored prompt>',
    design,
    verification: canonicalRootFromDesign(design, text),
    entry: {
      id: design.id,
      kind: 'system',
      status: 'live',
      owner: { module: '<prompt studio project>', symbol: '<studio authored prompt>' },
      consumers: [],
      editableKeys: [design.id],
      dynamicSources: [],
      toolSets: [],
      variants: [],
      ownedFragments: [],
      protectedSkills: [],
      legacyIdentity: [],
    },
  };
}

export function authoredPromptRootsFromHeads(heads: ReadonlyMap<string, string>): {
  readonly roots: readonly CatalogRoot[];
  readonly errors: readonly string[];
} {
  const roots: CatalogRoot[] = [];
  const errors: string[] = [];
  for (const [key, serialized] of heads) {
    if (!key.startsWith(PROMPT_DESIGN_KEY_PREFIX)) continue;
    const rootId = key.slice(PROMPT_DESIGN_KEY_PREFIX.length);
    const text = heads.get(rootId);
    if (text === undefined) {
      errors.push(`Authored prompt ${rootId} has a design but no prompt text.`);
      continue;
    }
    try {
      const design = parsePromptDesign(serialized);
      if (design.id !== rootId) throw new TypeError(`design id is ${design.id}`);
      roots.push(authoredCatalogRoot(design, text));
    } catch (error) {
      errors.push(`Authored prompt ${rootId} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  roots.sort((left, right) => left.title.localeCompare(right.title));
  return { roots, errors };
}
