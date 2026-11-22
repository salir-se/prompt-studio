// @module-tag dom
import { describe, expect, it } from 'vitest';
import { parseExportedToolArray } from './tools-literal-parser';

/**
 * The contract the Tools panel depends on (task #12): parsing a real tool module's source must reproduce its
 * exported `*_TOOLS` list exactly — same order, same names, descriptions, and input-schema keys. If an authoring
 * pattern appears that the conservative parser refuses (an interpolation, a helper call), the parser must be
 * extended or that array explicitly re-homed — never silently emptied.
 */

/** A tool module as a project would author it: typed export, comments, nested schemas, template literals. */
const SUPPORT_TOOLS_SOURCE = `import type { ToolDefinition } from './types';

// Tools the support triage prompt may call.
export const SUPPORT_TOOLS: ToolDefinition[] = [
  {
    name: 'lookup_customer',
    description: 'Find the customer record by email address.',
    input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
  },
  /* Opening a ticket is the terminal step. */
  {
    name: "create_ticket",
    description: \`Open a support ticket with the chosen category and urgency.\`,
    input_schema: {
      type: 'object',
      properties: { urgency: { type: 'string' }, category: { type: 'string' }, summary: { type: 'string' } },
    },
  },
  { name: 'web_search', type: 'web_search_20250305' },
];
`;

describe('parseExportedToolArray — contract against an authored tool module', () => {
  it('reproduces the exported tool array exactly, in order, with sorted input keys', () => {
    // Given: a tool module source with comments, quotes of every kind, and nested schemas
    // When: its exported array is parsed
    const parsed = parseExportedToolArray(SUPPORT_TOOLS_SOURCE, 'SUPPORT_TOOLS');

    // Then: every tool comes back in order with its description and sorted schema property names
    expect(parsed).toEqual([
      { name: 'lookup_customer', description: 'Find the customer record by email address.', inputKeys: ['email'] },
      {
        name: 'create_ticket',
        description: 'Open a support ticket with the chosen category and urgency.',
        inputKeys: ['category', 'summary', 'urgency'],
      },
      { name: 'web_search', description: undefined, inputKeys: [] },
    ]);
  });
});

describe('parseExportedToolArray — refusal semantics', () => {
  it('refuses interpolations, helper calls, and spreads — never returns a partial guess', () => {
    expect(parseExportedToolArray(`export const X = [{ name: \`a\${b}\`, description: "d" }];`, 'X')).toBeNull();
    expect(parseExportedToolArray('export const X = [makeTool()];', 'X')).toBeNull();
    expect(parseExportedToolArray('export const X = [...OTHER_TOOLS];', 'X')).toBeNull();
    expect(parseExportedToolArray('export const X = SOMETHING;', 'X')).toBeNull();
  });

  // Issue: a member that IS a plain literal but is NOT a valid tool definition (missing `name`,
  // mistyped field) used to be silently dropped by a `.filter` — a PARTIAL list, violating the
  // whole-array contract above. One malformed member must refuse the entire array.
  it('refuses the whole array when any member is not a valid tool definition', () => {
    const oneValidTwoMalformed =
      'export const X = [{ name: "ok", description: "d" }, "not-an-object", { description: "no-name" }];';
    expect(parseExportedToolArray(oneValidTwoMalformed, 'X')).toBeNull();
    expect(parseExportedToolArray('export const X = [{ name: 42 }];', 'X')).toBeNull();
    expect(parseExportedToolArray('export const X = [{ name: "ok", description: 7 }];', 'X')).toBeNull();
  });

  it('returns null for an absent symbol and accepts comments + nested literals', () => {
    expect(parseExportedToolArray('export const Y = [];', 'X')).toBeNull();
    const parsed = parseExportedToolArray(
      'export const X /* c */ = [\n  // leading comment\n  { name: "t", description: `multi`, input_schema: { type: "object", properties: { b: {}, a: {} } } },\n];',
      'X',
    );
    expect(parsed).toEqual([{ name: 't', description: 'multi', inputKeys: ['a', 'b'] }]);
  });
});
