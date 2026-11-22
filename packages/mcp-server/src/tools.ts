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
