import type { CommandDescriptor } from './protocol';

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
];

export function findCommand(name: string): CommandDescriptor | undefined {
  return COMMAND_CATALOG.find((descriptor) => descriptor.name === name);
}

/**
 * Validates params against the small JSON Schema subset the catalog uses (object, required, string,
 * minLength, additionalProperties: false). Returns an error message, or null when valid.
 */
export function validateParams(descriptor: CommandDescriptor, params: unknown): string | null {
  const schema = descriptor.params as {
    required?: readonly string[];
    properties?: Record<string, { type?: string; minLength?: number }>;
    additionalProperties?: boolean;
  };
  const value = params === undefined ? {} : params;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'params must be an object.';
  const record = value as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!(key in record)) return `params.${key} is required.`;
  }
  for (const [key, entry] of Object.entries(record)) {
    const property = schema.properties?.[key];
    if (property === undefined) {
      if (schema.additionalProperties === false) return `params.${key} is not a parameter of ${descriptor.name}.`;
      continue;
    }
    if (property.type === 'string') {
      if (typeof entry !== 'string') return `params.${key} must be a string.`;
      if (property.minLength !== undefined && entry.length < property.minLength) return `params.${key} must not be empty.`;
    }
  }
  return null;
}
