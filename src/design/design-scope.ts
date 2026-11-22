/**
 * Design-contract operations shared by the Design panel and the remote-control design commands (roadmap #7):
 * read one scope (the whole prompt, or one section's sub-prompt design), change it, check a JSON sample against
 * its contract, and list what blocks a save. One implementation, so an agent's change is checked exactly like a
 * person's.
 */

import { validateMermaidDiagram } from '@prompt-studio/prompt-graph-ui';
import {
  type PromptDesign,
  type PromptSectionDesign,
  validatePromptDesign,
  verifyStructuredJsonInput,
  verifyStructuredJsonOutput,
} from '@prompt-studio/prompts';
import { withSectionDesign } from './section-metadata';

/** The contracts of one scope: the whole prompt's or one section's. */
export type DesignContracts = Pick<PromptSectionDesign, 'input' | 'workflow' | 'output'>;

/** The scope's contracts; a section without a design yet gets the starter design the panel shows. */
export function designScope(design: PromptDesign, sectionId: string | undefined): DesignContracts | undefined {
  if (sectionId === undefined) return design;
  return withSectionDesign(design, sectionId).sectionDesigns.find((section) => section.sectionId === sectionId);
}

/** Applies `update` to one scope's contracts and bumps the design version, as every panel edit does. */
export function updateDesignScope(
  design: PromptDesign,
  sectionId: string | undefined,
  update: (scope: DesignContracts) => DesignContracts,
): PromptDesign {
  if (sectionId === undefined) {
    const { input, workflow, output } = update(design);
    return { ...design, input, workflow, output, version: design.version + 1 };
  }
  const prepared = withSectionDesign(design, sectionId);
  return {
    ...prepared,
    version: design.version + 1,
    sectionDesigns: prepared.sectionDesigns.map((section) =>
      section.sectionId === sectionId ? { ...section, ...update(section) } : section,
    ),
  };
}

export interface SampleVerification {
  /** The contract the sample was checked against. */
  readonly axis: 'input' | 'output';
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Checks a pasted JSON sample against the scope's JSON contract ("Verify sample"). `preferred` picks the contract
 * when both input and output are JSON; otherwise the one JSON contract is used. Null when neither is JSON.
 */
export function verifyDesignSample(
  scope: DesignContracts,
  preferred: 'input' | 'output',
  sample: string,
): SampleVerification | null {
  if (scope.input.kind === 'json' && (preferred === 'input' || scope.output.kind !== 'json')) {
    const result = verifyStructuredJsonInput(scope.input, sample);
    return { axis: 'input', valid: result.valid, errors: result.valid ? [] : result.errors };
  }
  if (scope.output.kind === 'json') {
    const result = verifyStructuredJsonOutput(scope.output, sample);
    return { axis: 'output', valid: result.valid, errors: result.valid ? [] : result.errors };
  }
  return null;
}

/** Readiness issues that block saving the design (the panel's Readiness list). */
export function designIssueMessages(design: PromptDesign, text: string): string[] {
  return validatePromptDesign(design, text).map((issue) => issue.message);
}

type MermaidCheck = (diagram: string) => Promise<{ valid: true } | { valid: false; error: string }>;

/** Workflows (the prompt's and every section's) that Mermaid cannot render. */
export async function workflowProblems(
  design: PromptDesign,
  validate: MermaidCheck = validateMermaidDiagram,
): Promise<string[]> {
  const workflows = [
    { label: 'Major workflow', diagram: design.workflow },
    ...design.sectionDesigns.map((section) => ({
      label: `Workflow for ${section.sectionId}`,
      diagram: section.workflow,
    })),
  ].filter((workflow) => workflow.diagram.trim() !== '');
  const results = await Promise.all(
    workflows.map(async (workflow) => ({ ...workflow, result: await validate(workflow.diagram) })),
  );
  return results.flatMap((workflow) =>
    workflow.result.valid ? [] : [`${workflow.label} cannot render: ${workflow.result.error}`.trim()],
  );
}
