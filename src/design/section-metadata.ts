import {
  PROMPT_WORKFLOW_TEMPLATE,
  type PromptDesign,
  type PromptSectionDesign,
  parsePromptTree,
  promptDesignSections,
  promptSectionId,
} from '@prompt-studio/prompts';

function sectionDesign(sectionId: string): PromptSectionDesign {
  return {
    sectionId,
    input: { kind: 'free-text', description: 'Content and context entering this section.' },
    workflow: PROMPT_WORKFLOW_TEMPLATE,
    output: { kind: 'freeform', description: 'Instructions produced by this section.' },
  };
}

export function withSectionDesign(design: PromptDesign, sectionId: string | undefined): PromptDesign {
  if (!sectionId) return design;
  const profileId = `${sectionId}.verification`;
  const hasDesign = design.sectionDesigns.some((section) => section.sectionId === sectionId);
  const hasProfile = design.verificationProfiles.some(
    (profile) => profile.scope === 'section' && profile.sectionId === sectionId,
  );
  if (hasDesign && hasProfile) return design;
  return {
    ...design,
    sectionDesigns: hasDesign ? design.sectionDesigns : [...design.sectionDesigns, sectionDesign(sectionId)],
    verificationProfiles: hasProfile
      ? design.verificationProfiles
      : [
          ...design.verificationProfiles.map((profile) =>
            profile.scope === 'consolidated'
              ? { ...profile, dependsOn: [...new Set([...(profile.dependsOn ?? []), profileId])] }
              : profile,
          ),
          {
            id: profileId,
            version: design.version,
            scope: 'section',
            sectionId,
            deterministicRules: [{ id: 'non-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' }],
            principles: [],
          },
        ],
  };
}

/** Missing metadata follows the Markdown; existing authored contracts are retained. */
export function initializeSectionMetadata(design: PromptDesign, text: string): PromptDesign {
  const tree = parsePromptTree({ key: design.id, text, toolNames: design.tools });
  const sectionIds = new Set(promptDesignSections(tree.children).map((node) => promptSectionId(design.id, node)));
  // Only discard untouched scaffolding; authored contracts remain available for repair.
  const unused = new Set(
    design.sectionDesigns
      .filter((section) => {
        if (sectionIds.has(section.sectionId)) return false;
        const starter = sectionDesign(section.sectionId);
        const profiles = design.verificationProfiles.filter(
          (profile) => profile.scope === 'section' && profile.sectionId === section.sectionId,
        );
        return (
          section.input.kind === starter.input.kind &&
          section.input.description === starter.input.description &&
          section.output.kind === starter.output.kind &&
          section.output.description === starter.output.description &&
          section.workflow === starter.workflow &&
          profiles.length === 1 &&
          profiles.every(
            (profile) =>
              profile.id === `${section.sectionId}.verification` &&
              profile.principles.length === 0 &&
              !profile.dependsOn?.length &&
              profile.deterministicRules.length === 1 &&
              profile.deterministicRules.every(
                (rule) =>
                  rule.id === 'non-empty' &&
                  rule.kind === 'non-empty' &&
                  rule.severity === 'error' &&
                  rule.enforcement === 'runtime',
              ),
          )
        );
      })
      .map((section) => section.sectionId),
  );
  const removedProfiles = new Set(
    design.verificationProfiles
      .filter((profile) => profile.scope === 'section' && unused.has(profile.sectionId))
      .map((profile) => profile.id),
  );
  let next = unused.size
    ? {
        ...design,
        sectionDesigns: design.sectionDesigns.filter((section) => !unused.has(section.sectionId)),
        verificationProfiles: design.verificationProfiles
          .filter((profile) => !removedProfiles.has(profile.id))
          .map((profile) =>
            profile.dependsOn
              ? { ...profile, dependsOn: profile.dependsOn.filter((id) => !removedProfiles.has(id)) }
              : profile,
          ),
      }
    : design;
  for (const sectionId of sectionIds) next = withSectionDesign(next, sectionId);
  return next;
}
