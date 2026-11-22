/**
 * Design commands for remote control (roadmap #7; docs/remote-control.md): read and change the input contract,
 * Mermaid workflow and output contract of the whole prompt or of one section, check a JSON sample against the
 * output contract, and apply a workflow pattern from the Design panel's catalog.
 *
 * A change is checked exactly as the Design panel's Save checks it (`designIssueMessages`, `workflowProblems`),
 * saved through the same save function, and then the Design panel opens on that scope so the person sees it.
 * Applying a pattern only sets the workflow diagram; nothing runs.
 */

import { ControlCommandError } from '@prompt-studio/control-protocol';
import {
  parsePromptDesign,
  type PromptDesign,
  type PromptTree,
  promptDesignSections,
  promptSectionId,
} from '@prompt-studio/prompts';
import {
  type DesignContracts,
  designIssueMessages,
  designScope,
  updateDesignScope,
  verifyDesignSample,
  workflowProblems,
} from '../design/design-scope';
import { WORKFLOW_PATTERNS } from '../design/workflow-patterns';
import { findSectionNode } from '../hooks/section-edit';
import type { ControlHandler } from './control-channel';

export interface DesignCommandSurface {
  readonly loadedDocument: { readonly rootId: string; readonly variantSymbol?: string; readonly text: string } | null;
  readonly tree: PromptTree | null;
  /** The open prompt's design, with section metadata initialized (what the Design panel edits). */
  readonly design: PromptDesign | undefined;
  confirmDiscard(): boolean;
  /** The Design panel's save. */
  saveDesign(design: PromptDesign): Promise<void>;
  /** Opens the Design panel on the whole prompt (undefined) or on one section's design id. */
  showDesign(designSectionId: string | undefined): void;
  /** Mermaid check; the default renders with Mermaid in the tab. */
  validateWorkflow?: Parameters<typeof workflowProblems>[1];
}

type Args = Record<string, unknown>;

function record(args: unknown): Args {
  return typeof args === 'object' && args !== null ? (args as Args) : {};
}

function optionalText(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ControlCommandError('invalid_input', `${key} must be a string.`);
  return value;
}

function contractsOf(scope: DesignContracts) {
  return { input: scope.input, workflow: scope.workflow, output: scope.output };
}

export function buildDesignCommands(surface: DesignCommandSurface): Record<string, ControlHandler> {
  /** The open prompt and its design, after checking the caller targets the open document. */
  function openDesign(args: Args): { rootId: string; design: PromptDesign; text: string } {
    const rootId = optionalText(args, 'rootId');
    if (!rootId) throw new ControlCommandError('invalid_input', 'rootId is required.');
    const loaded = surface.loadedDocument;
    if (loaded === null) throw new ControlCommandError('command_failed', 'Open a document first (openDocument).');
    if (loaded.rootId !== rootId || loaded.variantSymbol !== optionalText(args, 'variantSymbol')) {
      throw new ControlCommandError(
        'command_failed',
        `Open "${rootId}" first (openDocument) — design commands apply to the open document, now "${loaded.rootId}".`,
      );
    }
    if (surface.design === undefined) {
      throw new ControlCommandError(
        'command_failed',
        `"${rootId}" has no design. Designs belong to prompts created or adopted in Prompt Studio (New prompt or Add existing).`,
      );
    }
    return { rootId, design: surface.design, text: loaded.text };
  }

  /**
   * The design section id for `sectionId`: a section id from listSections, an xml tag, or a design id such as
   * `order-status.output`. Undefined = the whole prompt.
   */
  function designSectionId(args: Args, rootId: string, design: PromptDesign): string | undefined {
    const requested = optionalText(args, 'sectionId');
    if (requested === undefined || requested === '') return undefined;
    if (design.sectionDesigns.some((section) => section.sectionId === requested)) return requested;
    const sections = surface.tree ? promptDesignSections(surface.tree.children) : [];
    const node =
      (surface.tree && findSectionNode(surface.tree.children, requested)) ??
      sections.find((candidate) => candidate.tag === requested);
    if (node && sections.includes(node)) return promptSectionId(rootId, node);
    throw new ControlCommandError(
      'missing_target',
      `No designable section "${requested}" — run listSections for ids, or leave sectionId out for the whole prompt.`,
    );
  }

  async function save(rootId: string, text: string, next: PromptDesign, sectionId: string | undefined) {
    let design: PromptDesign;
    try {
      design = parsePromptDesign(JSON.stringify(next));
    } catch (error) {
      throw new ControlCommandError('invalid_input', error instanceof Error ? error.message : String(error));
    }
    const issues = designIssueMessages(design, text);
    if (issues.length > 0) throw new ControlCommandError('invalid_input', issues.join('\n'));
    const broken = await workflowProblems(design, surface.validateWorkflow);
    if (broken.length > 0) throw new ControlCommandError('invalid_input', broken.join('\n'));
    if (!surface.confirmDiscard()) {
      throw new ControlCommandError(
        'command_failed',
        'The person kept unsaved changes in an open panel, so nothing changed. Ask them to save or close it.',
      );
    }
    try {
      await surface.saveDesign(design);
    } catch (error) {
      throw new ControlCommandError('command_failed', error instanceof Error ? error.message : String(error));
    }
    surface.showDesign(sectionId);
    return {
      rootId,
      sectionId: sectionId ?? null,
      version: design.version,
      ...contractsOf(designScope(design, sectionId)!),
    };
  }

  return {
    getDesign: (raw) => {
      const args = record(raw);
      const { rootId, design, text } = openDesign(args);
      const sectionId = designSectionId(args, rootId, design);
      const scope = designScope(design, sectionId);
      if (!scope) throw new ControlCommandError('missing_target', `No design for section "${sectionId}".`);
      return {
        rootId,
        sectionId: sectionId ?? null,
        version: design.version,
        ...(sectionId === undefined ? { tools: design.tools } : {}),
        ...contractsOf(scope),
        sections: design.sectionDesigns.map((section) => section.sectionId),
        readiness: designIssueMessages(design, text),
      };
    },

    setDesign: async (raw) => {
      const args = record(raw);
      const { rootId, design, text } = openDesign(args);
      const sectionId = designSectionId(args, rootId, design);
      const workflow = optionalText(args, 'workflow');
      if (args.input === undefined && args.output === undefined && workflow === undefined) {
        throw new ControlCommandError('invalid_input', 'Pass at least one of input, workflow or output.');
      }
      const next = updateDesignScope(design, sectionId, (scope) => ({
        input: (args.input as DesignContracts['input'] | undefined) ?? scope.input,
        workflow: workflow ?? scope.workflow,
        output: (args.output as DesignContracts['output'] | undefined) ?? scope.output,
      }));
      return save(rootId, text, next, sectionId);
    },

    verifySample: (raw) => {
      const args = record(raw);
      const { rootId, design } = openDesign(args);
      const sectionId = designSectionId(args, rootId, design);
      const sample = optionalText(args, 'sample');
      if (sample === undefined) throw new ControlCommandError('invalid_input', 'sample is required.');
      const contract = optionalText(args, 'contract') ?? 'output';
      if (contract !== 'input' && contract !== 'output') {
        throw new ControlCommandError('invalid_input', 'contract must be "input" or "output".');
      }
      const result = verifyDesignSample(designScope(design, sectionId)!, contract, sample);
      if (result === null) {
        throw new ControlCommandError(
          'command_failed',
          'This scope has no JSON input or output contract. Set a json contract with setDesign first.',
        );
      }
      return {
        rootId,
        sectionId: sectionId ?? null,
        contract: result.axis,
        valid: result.valid,
        errors: result.errors,
      };
    },

    listWorkflowPatterns: () =>
      WORKFLOW_PATTERNS.map(({ id, name, description, source, graph }) => ({ id, name, description, source, graph })),

    applyWorkflowPattern: async (raw) => {
      const args = record(raw);
      const { rootId, design, text } = openDesign(args);
      const sectionId = designSectionId(args, rootId, design);
      const patternId = optionalText(args, 'patternId');
      const pattern = WORKFLOW_PATTERNS.find((candidate) => candidate.id === patternId);
      if (!pattern) {
        throw new ControlCommandError(
          'missing_target',
          `No workflow pattern "${patternId}" — one of: ${WORKFLOW_PATTERNS.map((candidate) => candidate.id).join(', ')}.`,
        );
      }
      const next = updateDesignScope(design, sectionId, (scope) => ({ ...scope, workflow: pattern.graph }));
      return { ...(await save(rootId, text, next, sectionId)), patternId: pattern.id };
    },
  };
}
