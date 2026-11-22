import { z } from 'zod';

/**
 * The MCP tool table (task #20): one tool per control-API command (ADR-236), so an LLM can read
 * and edit the OPEN prompt-studio editor — list documents, open/read/edit, manage
 * configurations, inspect history. Table-driven: `TOOLS` is the single source both for
 * registration (index.ts) and for the tests.
 *
 * zod appears ONLY as the MCP SDK's input-schema language (its `registerTool` contract) — this
 * is SDK plumbing, not a repo validation boundary; the studio itself re-validates every command
 * server-side (app-commands.ts), so a malformed tool argument still fails safely there.
 */

/**
 * Injectable command caller so tests drive the table without a studio. `browserId` is passed only when the
 * tool input names one.
 */
export type CommandCaller = (command: string, args?: unknown, browserId?: string) => Promise<unknown>;

/** The pseudo-command of `list_targets`: answered by the Studio gateway, not by a tab. */
export const LIST_TARGETS_COMMAND = 'targets.list';

const browserIdArg = {
  browserId: z
    .string()
    .optional()
    .describe('The editor tab to drive (from list_targets). Needed only when more than one tab is open.'),
};

const documentArgs = {
  ...browserIdArg,
  rootId: z.string().describe('Document id — discover with list_documents'),
  variantSymbol: z
    .string()
    .optional()
    .describe('Variant symbol for variant-resolved documents (the error names the options)'),
};

const sectionIdArg = z
  .string()
  .describe('Section id from list_sections (for example "role"). Ids can change after a section is renamed.');
const designScopeArg = z
  .string()
  .optional()
  .describe('A section id from list_sections (or its xml tag). Leave it out for the whole prompt');
const commitMessageArg = z.string().optional().describe('Commit message shown in History');

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, import('zod').ZodTypeAny>;
  readonly command: string;
  /** Maps the (already zod-validated) tool input onto the control command's args. */
  readonly toArgs: (input: Record<string, unknown>) => unknown;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'list_documents',
    title: 'List documents',
    description:
      'Every editable document in the studio catalog (agent prompts, fragments, skills) with its loadability.',
    inputSchema: { ...browserIdArg },
    command: 'listDocuments',
    toArgs: () => ({}),
  },
  {
    name: 'open_document',
    title: 'Open a document',
    description:
      'Open a document in the editor tab. Edits and resets apply to the OPEN document, so open before editing. Variant-resolved documents need variantSymbol.',
    inputSchema: documentArgs,
    command: 'openDocument',
    toArgs: (input) => input,
  },
  {
    name: 'read_document',
    title: 'Read a document',
    description: "A document's text — the working copy when it is open in the editor, otherwise the shipped text.",
    inputSchema: documentArgs,
    command: 'readDocument',
    toArgs: (input) => input,
  },
  {
    name: 'edit_document',
    title: 'Edit a document',
    description:
      "Replace the OPEN document's whole text (open_document first). Lands through the editor's transactional write path as an auto-commit with the given message.",
    inputSchema: {
      ...documentArgs,
      text: z.string().describe('The complete new document text'),
      message: z.string().optional(),
    },
    command: 'editDocument',
    toArgs: (input) => input,
  },
  {
    name: 'list_configurations',
    title: 'List configurations',
    description: 'The prompt configurations (projects) with the active one marked.',
    inputSchema: { ...browserIdArg },
    command: 'listConfigurations',
    toArgs: () => ({}),
  },
  {
    name: 'create_configuration',
    title: 'Create a configuration',
    description: 'Create a new configuration, optionally seeded from a reference baseline (e.g. repository).',
    inputSchema: { ...browserIdArg, name: z.string(), fromBaseline: z.string().optional() },
    command: 'createConfiguration',
    toArgs: (input) => input,
  },
  {
    name: 'switch_configuration',
    title: 'Switch configuration',
    description:
      "Make another configuration active (projectId from list_configurations). Switching replaces the working text with that configuration's heads.",
    inputSchema: { ...browserIdArg, projectId: z.string() },
    command: 'switchConfiguration',
    toArgs: (input) => input,
  },
  {
    name: 'reset_document',
    title: 'Reset a document',
    description: 'Reset the OPEN document to its shipped text as an append-only commit (open_document first).',
    inputSchema: documentArgs,
    command: 'resetDocument',
    toArgs: (input) => input,
  },
  {
    name: 'history',
    title: 'Document history',
    description:
      "The OPEN configuration's commits for a document, newest first (baseline seeds, edits, resets, restores).",
    inputSchema: documentArgs,
    command: 'history',
    toArgs: (input) => input,
  },
  {
    name: 'list_sections',
    title: 'List sections',
    description:
      'The sections of the OPEN document (open_document first), in document order: id, title, depth, parentId, index among siblings, delimiter kind (xml-tag, atx-heading, caps-label), childIds and the {{variables}} each uses. Call this before any other section tool to get ids; call it again after inserting, moving or removing sections.',
    inputSchema: documentArgs,
    command: 'listSections',
    toArgs: (input) => input,
  },
  {
    name: 'read_section',
    title: 'Read a section',
    description:
      "One section's OWN body (its text without the heading or tags and without its sub-sections), plus its place in the tree. Use it instead of read_document when you will change one section.",
    inputSchema: { ...documentArgs, sectionId: sectionIdArg },
    command: 'readSection',
    toArgs: (input) => input,
  },
  {
    name: 'edit_section',
    title: 'Edit a section',
    description:
      "Replace one section's OWN body. The heading/tags, its sub-sections and every other section stay byte-identical. Saved as one commit; the person sees the graph and outline update live. Prefer this over edit_document for a change to one section.",
    inputSchema: {
      ...documentArgs,
      sectionId: sectionIdArg,
      body: z.string().describe('The new body, without the heading or tags'),
      message: commitMessageArg,
    },
    command: 'editSection',
    toArgs: (input) => input,
  },
  {
    name: 'insert_section',
    title: 'Insert a section',
    description:
      'Insert a new section after an existing one (position "after", a sibling in the same style) or as its first sub-section (position "firstChild", an <tag> section). Returns the new section id. Saved as one commit.',
    inputSchema: {
      ...documentArgs,
      sectionId: sectionIdArg.describe('The section to insert after, or under'),
      position: z.enum(['after', 'firstChild']).optional().describe('Default: after'),
      tag: z.string().describe('Name of the new section: letters, digits and _, starting with a letter'),
      body: z.string().optional().describe('Body of the new section. Default: a placeholder line to replace'),
      message: commitMessageArg,
    },
    command: 'insertSection',
    toArgs: (input) => input,
  },
  {
    name: 'move_section',
    title: 'Move a section',
    description:
      'Move a section one place up or down among its siblings, together with its sub-sections. Fails when it is already first or last. Saved as one commit.',
    inputSchema: { ...documentArgs, sectionId: sectionIdArg, direction: z.enum(['up', 'down']) },
    command: 'moveSection',
    toArgs: (input) => input,
  },
  {
    name: 'remove_section',
    title: 'Remove a section',
    description:
      'Remove a section and its sub-sections from the open document. Saved as one commit, so the person can undo it or restore it from History.',
    inputSchema: { ...documentArgs, sectionId: sectionIdArg },
    command: 'removeSection',
    toArgs: (input) => input,
  },
  {
    name: 'get_design',
    title: 'Get a design',
    description:
      'The design contracts of the OPEN prompt (whole prompt, or one section with sectionId): input contract (free-text or json with JSON Schema), Mermaid workflow, output contract (freeform, tool-call or json with JSON Schema), plus the readiness issues the person sees in Design. Call before set_design. Only prompts created or adopted in Prompt Studio have a design.',
    inputSchema: { ...documentArgs, sectionId: designScopeArg },
    command: 'getDesign',
    toArgs: (input) => input,
  },
  {
    name: 'set_design',
    title: 'Set a design',
    description:
      "Change the input contract, workflow and/or output contract of the whole prompt or of one section, and save it as a new design version. Checked like the Design panel's Save: an invalid contract, an example that does not match its JSON Schema, a readiness issue or a workflow Mermaid cannot render fails with invalid_input and the validator's messages, and nothing is saved. The Design panel opens on the changed scope. Omitted fields stay as they are.",
    inputSchema: {
      ...documentArgs,
      sectionId: designScopeArg,
      input: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('{ kind: "free-text", description } or { kind: "json", description, jsonSchema, examples: [...] }'),
      workflow: z
        .string()
        .optional()
        .describe('A Mermaid flowchart, e.g. "flowchart LR\n  Message --> Lookup --> Reply"'),
      output: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          '{ kind: "freeform", description } | { kind: "tool-call", description, requiredToolName } | { kind: "json", description, jsonSchema, examples: [...] }',
        ),
    },
    command: 'setDesign',
    toArgs: (input) => input,
  },
  {
    name: 'verify_sample',
    title: 'Verify a JSON sample',
    description:
      'Check a JSON sample (for example a model reply) against the scope\'s JSON output contract, or its input contract with contract "input" — the Design panel\'s Verify sample. Returns valid and the schema errors. Changes nothing.',
    inputSchema: {
      ...documentArgs,
      sectionId: designScopeArg,
      sample: z.string().describe('The JSON text to check'),
      contract: z.enum(['output', 'input']).optional().describe('Default: output'),
    },
    command: 'verifySample',
    toArgs: (input) => input,
  },
  {
    name: 'list_workflow_patterns',
    title: 'List workflow patterns',
    description:
      "The Design panel's workflow patterns (direct prompt, agent with tools, sequential, parallel, routing, handoff, review, …): id, name, when to use it, and its Mermaid graph. Use with apply_workflow_pattern.",
    inputSchema: { ...browserIdArg },
    command: 'listWorkflowPatterns',
    toArgs: () => ({}),
  },
  {
    name: 'apply_workflow_pattern',
    title: 'Apply a workflow pattern',
    description:
      "Set the workflow of the whole prompt or of one section to a pattern's Mermaid graph (patternId from list_workflow_patterns) and save the design. It only records the workflow; nothing is executed. Edit the graph afterwards with set_design.",
    inputSchema: { ...documentArgs, sectionId: designScopeArg, patternId: z.string() },
    command: 'applyWorkflowPattern',
    toArgs: (input) => input,
  },
  {
    name: 'list_targets',
    title: 'List editor tabs',
    description:
      'The open Prompt Studio editor tabs: browserId, whether each is ready, its project, open document and view. Use a browserId on other tools when several tabs are open.',
    inputSchema: {},
    command: LIST_TARGETS_COMMAND,
    toArgs: () => ({}),
  },
];

/**
 * The executor for one tool, bound to a command caller — what `registerTool` hands MCP. Results
 * become MCP text content: a `read_document` result's text is returned as-is (an LLM reads the
 * prompt, not JSON-escaped prose); everything else is pretty-printed JSON.
 */
export function toolExecutor(
  tool: ToolDefinition,
  call: CommandCaller,
): (input: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return async (input) => {
    const { browserId, ...rest } = input;
    const args = tool.toArgs(rest);
    const result =
      typeof browserId === 'string' ? await call(tool.command, args, browserId) : await call(tool.command, args);
    const text =
      tool.command === 'readDocument' && typeof (result as { text?: unknown })?.text === 'string'
        ? (result as { text: string }).text
        : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text', text }] };
  };
}
