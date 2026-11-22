import type { CommandDescriptor } from './protocol.ts';

/**
 * The commands a Studio editor tab executes (spec RC-05). The gateway advertises this list in `welcome`,
 * rejects unknown actions before routing, and validates `params` against these schemas. The tab runs each
 * command through the same handlers its UI uses.
 */
const documentParams = {
  type: 'object',
  additionalProperties: false,
  required: ['rootId'],
  properties: {
    rootId: { type: 'string', minLength: 1, description: 'Document id, from listDocuments.' },
    variantSymbol: { type: 'string', minLength: 1, description: 'Variant of a document, when it has variants.' },
  },
} as const;

const none = { type: 'object', additionalProperties: false, properties: {} } as const;

/** Params of a command on the open document: `rootId` (+ `variantSymbol`) plus the command's own fields. */
function onDocument(
  required: readonly string[],
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    ...documentParams,
    required: ['rootId', ...required],
    properties: { ...documentParams.properties, ...properties },
  };
}

const sectionId = {
  type: 'string',
  minLength: 1,
  description: 'Section id, from listSections (for example "role" or "output-format").',
} as const;
const designScope = {
  type: 'string',
  description: 'A section id from listSections (or its xml tag). Leave it out for the whole prompt.',
} as const;
const commitMessage = { type: 'string', description: 'Commit message.' } as const;

function command(
  name: string,
  description: string,
  sideEffects: CommandDescriptor['sideEffects'],
  params: Readonly<Record<string, unknown>>,
): CommandDescriptor {
  return {
    name,
    description,
    executor: 'browser',
    requiresBrowser: true,
    sideEffects,
    completionLevels: ['applied'],
    defaultCompletion: 'applied',
    params,
  };
}

export const COMMAND_CATALOG: readonly CommandDescriptor[] = [
  command('listDocuments', 'List every prompt and skill in the open project.', 'none', none),
  command('openDocument', 'Open a document in the editor tab.', 'view', documentParams),
  command('readDocument', "Return a document's text (the working copy when it is open).", 'none', documentParams),
  command('editDocument', "Replace the open document's text and save it as a commit.", 'document', {
    ...documentParams,
    required: ['rootId', 'text'],
    properties: {
      ...documentParams.properties,
      text: { type: 'string', description: 'The complete new document text.' },
      message: { type: 'string', description: 'Commit message.' },
    },
  }),
  command('resetDocument', 'Reset the open document to its baseline text (a new commit).', 'document', documentParams),
  command('history', "List a document's commits, newest first.", 'none', documentParams),
  command('listConfigurations', 'List configurations of the open project; the active one is marked.', 'none', none),
  command('createConfiguration', 'Create a configuration, optionally from a baseline.', 'project', {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      fromBaseline: { type: 'string', minLength: 1 },
    },
  }),
  command('switchConfiguration', 'Switch the active configuration.', 'project', {
    type: 'object',
    additionalProperties: false,
    required: ['projectId'],
    properties: { projectId: { type: 'string', minLength: 1 } },
  }),
  // Sections of the open document (roadmap #6). Each edit is one text change through the editor's save path.
  command(
    'listSections',
    'List the sections of the open document in document order: id, title, nesting, delimiter kind, variables.',
    'none',
    documentParams,
  ),
  command(
    'readSection',
    "Return one section's own body (without its sub-sections) and its place in the tree.",
    'none',
    onDocument(['sectionId'], { sectionId }),
  ),
  command(
    'editSection',
    "Replace one section's own body; its heading, its sub-sections and every other section stay byte-identical.",
    'document',
    onDocument(['sectionId', 'body'], {
      sectionId,
      body: { type: 'string', description: 'The new body text of the section, without its heading or tags.' },
      message: commitMessage,
    }),
  ),
  command(
    'insertSection',
    'Insert a new section after a section (a sibling) or as its first sub-section.',
    'document',
    onDocument(['sectionId', 'tag'], {
      sectionId: { ...sectionId, description: 'The section to insert after, or under (position firstChild).' },
      position: { type: 'string', enum: ['after', 'firstChild'], description: 'Default: after.' },
      tag: {
        type: 'string',
        minLength: 1,
        description: 'Name of the new section: letters, digits and _, starting with a letter (for example "examples").',
      },
      body: { type: 'string', description: 'Body text of the new section. Default: a placeholder line.' },
      message: commitMessage,
    }),
  ),
  command(
    'moveSection',
    'Move a section one place up or down among its siblings, with its sub-sections.',
    'document',
    onDocument(['sectionId', 'direction'], {
      sectionId,
      direction: { type: 'string', enum: ['up', 'down'] },
    }),
  ),
  command(
    'removeSection',
    'Remove a section with its sub-sections.',
    'document',
    onDocument(['sectionId'], { sectionId }),
  ),
  // Design contracts and workflow patterns (roadmap #7). Writes are checked like the Design panel's Save.
  command(
    'getDesign',
    'Return the input contract, Mermaid workflow and output contract of the whole prompt or of one section.',
    'none',
    onDocument([], { sectionId: designScope }),
  ),
  command(
    'setDesign',
    'Change the input contract, workflow or output contract of the whole prompt or of one section, and save it.',
    'document',
    onDocument([], {
      sectionId: designScope,
      input: {
        type: 'object',
        description: '{ kind: "free-text", description } or { kind: "json", description, jsonSchema, examples }.',
      },
      workflow: { type: 'string', description: 'A Mermaid flowchart, for example "flowchart LR\n  A --> B".' },
      output: {
        type: 'object',
        description:
          '{ kind: "freeform" | "tool-call" | "json", description, … } — json needs jsonSchema and examples; tool-call needs requiredToolName.',
      },
    }),
  ),
  command(
    'verifySample',
    "Check a JSON sample against the scope's JSON output (or input) contract, like the Design panel's Verify sample.",
    'none',
    onDocument(['sample'], {
      sectionId: designScope,
      sample: { type: 'string', description: 'The JSON text to check, for example a model reply.' },
      contract: { type: 'string', enum: ['output', 'input'], description: 'Default: output.' },
    }),
  ),
  command('listWorkflowPatterns', "List the Design panel's workflow patterns (id, name, Mermaid graph).", 'none', none),
  command(
    'applyWorkflowPattern',
    "Set the workflow of the whole prompt or of one section to a pattern's Mermaid graph and save it. Nothing runs.",
    'document',
    onDocument(['patternId'], {
      sectionId: designScope,
      patternId: { type: 'string', minLength: 1, description: 'Pattern id, from listWorkflowPatterns.' },
    }),
  ),
  // Verification (roadmap #8). The agent proposes checks; only the person saves them. AI review stays a person's action.
  command(
    'listChecks',
    'List the automatic checks and AI review criteria per scope (whole prompt and each section), saved and proposed.',
    'none',
    onDocument([], { sectionId: designScope }),
  ),
  command('runChecks', 'Run the automatic checks (the Verify button) and return the findings.', 'view', documentParams),
  command(
    'getFindings',
    'Return the latest automatic and AI-review findings, each marked current or stale.',
    'none',
    documentParams,
  ),
  command(
    'proposeCheck',
    'Propose an automatic check or an AI review criterion. It appears unsaved in Verify → Checks & criteria for the person to accept, edit or reject.',
    'view',
    onDocument(['kind'], {
      sectionId: designScope,
      kind: { type: 'string', enum: ['rule', 'criterion'] },
      rule: {
        type: 'object',
        description:
          'For kind "rule": { kind: "required-placeholder" | "required-tool" | "required-output-literal" | "minimum-length" | "forbidden-combination" | "valid-json-output" | …, …fields, severity?, enforcement? }.',
      },
      statement: { type: 'string', description: 'For kind "criterion": what the AI reviewer should assess.' },
      severity: {
        type: 'string',
        enum: ['info', 'warning', 'error'],
        description: 'For a criterion. Default: warning.',
      },
    }),
  ),
  command(
    'getProposalStatus',
    'Return whether the person accepted, edited or rejected a proposed check, or has not decided yet (pending).',
    'none',
    {
      type: 'object',
      additionalProperties: false,
      required: ['proposalId'],
      properties: { proposalId: { type: 'string', minLength: 1, description: 'From proposeCheck.' } },
    },
  ),
];

export function findCommand(name: string): CommandDescriptor | undefined {
  return COMMAND_CATALOG.find((descriptor) => descriptor.name === name);
}

interface SchemaNode {
  readonly type?: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
  readonly enum?: readonly unknown[];
  readonly minLength?: number;
  readonly minimum?: number;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly additionalProperties?: boolean;
  readonly items?: SchemaNode;
}

/** Checks one value against a schema node; returns an error message, or null when valid. */
function checkValue(schema: SchemaNode, value: unknown, at: string, command: string): string | null {
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return `${at} must be a string.`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return `${at} must not be empty.`;
      break;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${at} must be a number.`;
      if (schema.type === 'integer' && !Number.isInteger(value)) return `${at} must be an integer.`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${at} must be at least ${schema.minimum}.`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `${at} must be true or false.`;
      break;
    case 'array':
      if (!Array.isArray(value)) return `${at} must be an array.`;
      if (schema.items !== undefined) {
        for (const [index, item] of value.entries()) {
          const problem = checkValue(schema.items, item, `${at}[${index}]`, command);
          if (problem !== null) return problem;
        }
      }
      break;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${at} must be an object.`;
      const record = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in record)) return `${at}.${key} is required.`;
      }
      for (const [key, entry] of Object.entries(record)) {
        const property = schema.properties?.[key];
        if (property === undefined) {
          if (schema.additionalProperties === false) return `${at}.${key} is not a parameter of ${command}.`;
          continue;
        }
        const problem = checkValue(property, entry, `${at}.${key}`, command);
        if (problem !== null) return problem;
      }
      break;
    }
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return `${at} must be one of: ${schema.enum.map((option) => JSON.stringify(option)).join(', ')}.`;
  }
  return null;
}

/**
 * Validates params against the small JSON Schema subset the catalog uses (type string / integer / number /
 * boolean / object / array, enum, minLength, minimum, required, properties, items, additionalProperties:
 * false). Returns an error message naming the first problem, or null when valid.
 */
export function validateParams(descriptor: CommandDescriptor, params: unknown): string | null {
  const value = params === undefined ? {} : params;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'params must be an object.';
  return checkValue({ ...(descriptor.params as SchemaNode), type: 'object' }, value, 'params', descriptor.name);
}
