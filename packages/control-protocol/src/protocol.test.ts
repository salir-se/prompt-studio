// @module-tag pure
import { describe, expect, it } from 'vitest';
import { COMMAND_CATALOG, findCommand, validateParams } from './catalog.ts';
import {
  BROWSER_ERROR_CODES,
  ERROR_CODES,
  readBrowserErrorCode,
  EXIT_CODES,
  exitCodeFor,
  isValidClientId,
  negotiateVersion,
  readBrowserState,
} from './protocol.ts';

/**
 * The protocol's pure rules (docs/remote-control.md): parameter validation the gateway runs before routing,
 * version negotiation in the handshake, and the CLI exit code of every stable error code.
 */

function descriptor(name: string) {
  const found = findCommand(name);
  if (found === undefined) throw new Error(`missing ${name}`);
  return found;
}

describe('validateParams', () => {
  it('accepts valid params and an omitted params object for commands without required fields', () => {
    // Given: catalog commands with and without required params
    // When / Then: valid inputs pass
    expect(validateParams(descriptor('listDocuments'), undefined)).toBeNull();
    expect(validateParams(descriptor('listDocuments'), {})).toBeNull();
    expect(validateParams(descriptor('readDocument'), { rootId: 'scout', variantSymbol: 'CRITIC' })).toBeNull();
    expect(validateParams(descriptor('editDocument'), { rootId: 'scout', text: '', message: 'm' })).toBeNull();
  });

  it('names the first problem: missing, wrong type, empty, unknown, not an object', () => {
    // Given / When / Then: each invalid input yields a readable message naming the parameter
    expect(validateParams(descriptor('readDocument'), {})).toBe('params.rootId is required.');
    expect(validateParams(descriptor('readDocument'), { rootId: 3 })).toBe('params.rootId must be a string.');
    expect(validateParams(descriptor('readDocument'), { rootId: '' })).toBe('params.rootId must not be empty.');
    expect(validateParams(descriptor('editDocument'), { rootId: 'a' })).toBe('params.text is required.');
    expect(validateParams(descriptor('listDocuments'), { extra: 1 })).toMatch(/params.extra is not a parameter/);
    expect(validateParams(descriptor('listDocuments'), [])).toBe('params must be an object.');
    expect(validateParams(descriptor('listDocuments'), 'x')).toBe('params must be an object.');
  });

  it('checks enums, numbers and nested objects of the section and design commands', () => {
    // Given / When / Then: enum values, wrong types and unknown nested keys are named
    const move = descriptor('moveSection');
    expect(validateParams(move, { rootId: 'r', sectionId: 's', direction: 'up' })).toBeNull();
    expect(validateParams(move, { rootId: 'r', sectionId: 's', direction: 'left' })).toBe(
      'params.direction must be one of: "up", "down".',
    );
    expect(validateParams(descriptor('insertSection'), { rootId: 'r', sectionId: 's', tag: 't', body: 3 })).toBe(
      'params.body must be a string.',
    );
    const setDesign = descriptor('setDesign');
    expect(validateParams(setDesign, { rootId: 'r', output: { kind: 'json' } })).toBeNull();
    expect(validateParams(setDesign, { rootId: 'r', output: '{"kind":"json"}' })).toBe(
      'params.output must be an object.',
    );
    expect(validateParams(descriptor('verifySample'), { rootId: 'r' })).toBe('params.sample is required.');
  });

  it('covers the editor and section commands, all executed in the browser at the applied level', () => {
    // Given: the catalog
    // Then: unique commands, each applied-only in phase 1, including the six section commands
    const names = COMMAND_CATALOG.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'listDocuments',
        'editDocument',
        'listSections',
        'readSection',
        'editSection',
        'insertSection',
        'moveSection',
        'removeSection',
        'getDesign',
        'setDesign',
        'verifySample',
        'listWorkflowPatterns',
        'applyWorkflowPattern',
      ]),
    );
    expect(names).toHaveLength(20);
    for (const command of COMMAND_CATALOG) {
      expect(command).toMatchObject({
        executor: 'browser',
        completionLevels: ['applied'],
        defaultCompletion: 'applied',
      });
    }
  });
});

describe('readBrowserErrorCode', () => {
  it('lets a tab report only command-level codes; anything else is command_failed', () => {
    // Given: the codes a tab may send
    // When / Then: allowed codes pass through, transport codes and junk do not
    for (const code of BROWSER_ERROR_CODES) expect(readBrowserErrorCode(code)).toBe(code);
    expect(readBrowserErrorCode('timeout')).toBe('command_failed');
    expect(readBrowserErrorCode(undefined)).toBe('command_failed');
    expect(readBrowserErrorCode(7)).toBe('command_failed');
  });
});

describe('negotiateVersion', () => {
  it('picks the first supported version the peer offers, or null', () => {
    // Given / When / Then
    expect(negotiateVersion(['1.0'])).toBe('1.0');
    expect(negotiateVersion(['2.0', '1.0'])).toBe('1.0');
    expect(negotiateVersion(['2.0', '1.1'], ['2.0', '1.0'])).toBe('2.0');
    expect(negotiateVersion(['9.9'])).toBeNull();
    expect(negotiateVersion([])).toBeNull();
    expect(negotiateVersion('1.0')).toBeNull();
    expect(negotiateVersion(undefined)).toBeNull();
  });
});

describe('exitCodeFor', () => {
  it('maps every stable error code to a documented exit code', () => {
    // Given: the exit-code table of the CLI
    const expected: Record<string, number> = {
      invalid_input: EXIT_CODES.usage,
      unsupported_command: EXIT_CODES.usage,
      unsupported_completion: EXIT_CODES.usage,
      unsupported_version: EXIT_CODES.connection,
      unauthorized: EXIT_CODES.connection,
      forbidden: EXIT_CODES.connection,
      payload_too_large: EXIT_CODES.connection,
      too_many_pending: EXIT_CODES.connection,
      ambiguous_target: EXIT_CODES.target,
      missing_target: EXIT_CODES.target,
      not_ready: EXIT_CODES.target,
      timeout: EXIT_CODES.timeout,
      disconnected: EXIT_CODES.timeout,
      duplicate_command: EXIT_CODES.commandFailed,
      command_failed: EXIT_CODES.commandFailed,
      internal: EXIT_CODES.commandFailed,
    };
    // Then: every code has an entry and none exits 0
    expect(Object.keys(expected).sort()).toEqual([...ERROR_CODES].sort());
    for (const code of ERROR_CODES) expect(exitCodeFor(code), code).toBe(expected[code]);
  });
});

describe('untrusted input readers', () => {
  it('accepts short printable ids and well-formed tab state only', () => {
    // Given / When / Then
    expect(isValidClientId('tab-123_a.b:c')).toBe(true);
    expect(isValidClientId('')).toBe(false);
    expect(isValidClientId('has space')).toBe(false);
    expect(isValidClientId('x'.repeat(129))).toBe(false);
    expect(
      readBrowserState({ ready: true, projectId: 'p', projectName: null, documentId: undefined, view: 'write' }),
    ).toEqual({
      ready: true,
      projectId: 'p',
      projectName: null,
      documentId: null,
      view: 'write',
    });
    expect(readBrowserState({ ready: 'yes' })).toBeNull();
    expect(readBrowserState({ ready: true, projectId: 4 })).toBeNull();
    expect(readBrowserState(null)).toBeNull();
  });
});
