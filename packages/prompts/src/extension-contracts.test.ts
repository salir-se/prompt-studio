// @module-tag pure
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  assertExtensionBinding,
  assertPromptExtensionPoint,
  assertPromptExtensionResolution,
  type PromptExtensionPoint,
} from './extension-contracts';

function base() {
  return {
    id: 'company_evidence',
    version: 1,
    purpose: 'Supply researched company evidence as data.',
    cardinality: 'one',
    required: true,
    failurePolicy: 'fail',
    authority: 'data',
    maxBytes: 4_096,
    presentation: 'resolved',
    allowedSectionIds: ['context'],
    provenanceRequired: true,
  } as const;
}

function inline(overrides: Partial<PromptExtensionPoint> = {}): PromptExtensionPoint {
  return {
    ...base(),
    delivery: 'inline',
    tag: 'company_evidence',
    schema: type({ company: 'string', '+': 'reject' }),
    encoding: 'json',
    ...overrides,
  } as PromptExtensionPoint;
}

describe('prompt extension contracts', () => {
  it('accepts strict inline, message, and tool point variants', () => {
    expect(assertPromptExtensionPoint(inline()).delivery).toBe('inline');
    expect(
      assertPromptExtensionPoint({
        ...base(),
        id: 'conversation',
        delivery: 'message',
        role: 'user',
        encoding: 'json',
        schema: type({ messages: 'string[]', '+': 'reject' }),
        allowedSectionIds: ['workflow'],
      }),
    ).toMatchObject({ delivery: 'message', role: 'user' });
    expect(
      assertPromptExtensionPoint({
        ...base(),
        id: 'outreach_capabilities',
        delivery: 'tool',
        allowedCapabilities: ['draft_email'],
      }),
    ).toMatchObject({ delivery: 'tool', allowedCapabilities: ['draft_email'] });
  });

  it('rejects unknown fields, invalid variants, duplicate capabilities, and missing fallback values', () => {
    expect(() => assertPromptExtensionPoint({ ...inline(), executableResolver: 'DROP TABLE' })).toThrow(
      /executableResolver/,
    );
    expect(() =>
      assertPromptExtensionPoint({ ...inline(), delivery: 'message', role: 'system', tag: undefined }),
    ).toThrow();
    expect(() =>
      assertPromptExtensionPoint({
        ...base(),
        delivery: 'tool',
        allowedCapabilities: ['draft_email', 'draft_email'],
      }),
    ).toThrow(/unique/);
    expect(() => assertPromptExtensionPoint({ ...inline(), failurePolicy: 'use-default' })).toThrow(/defaultValue/);
    expect(() => assertPromptExtensionPoint({ ...inline(), tag: 'Unsafe-Tag' })).toThrow(/snake_case/);
  });

  it('strictly validates binding and resolution provenance envelopes', () => {
    const binding = {
      extensionPoint: { id: 'company_evidence', version: 1 },
      resolver: { id: 'research.company-evidence', version: 1 },
    };
    expect(assertExtensionBinding(binding)).toEqual(binding);
    expect(
      assertPromptExtensionResolution({
        binding,
        sourceKind: 'database',
        value: { company: 'Acme' },
        provenance: { resolver: binding.resolver, retrievedAt: '2026-08-01T12:00:00.000Z' },
      }),
    ).toMatchObject({ sourceKind: 'database' });
    expect(() => assertExtensionBinding({ ...binding, sql: 'SELECT secret' })).toThrow(/sql/);
    expect(() =>
      assertPromptExtensionResolution({
        binding,
        sourceKind: 'database',
        value: {},
        provenance: { resolver: binding.resolver, secret: 'DO-NOT-ACCEPT' },
      }),
    ).toThrow(/secret/);
    expect(() =>
      assertPromptExtensionResolution({
        binding,
        sourceKind: 'database',
        value: {},
        provenance: { resolver: binding.resolver, sourceRevisionHash: 'not-a-hash' },
      }),
    ).toThrow(/sha256/);
  });

  it('requires actual ArkType schemas and strict object payloads', () => {
    expect(() => assertPromptExtensionPoint({ ...inline(), schema: 'string' })).toThrow(/ArkType payload schema/i);
    expect(() => assertPromptExtensionPoint({ ...inline(), schema: type({ company: 'string' }) })).toThrow(
      /reject undeclared fields/i,
    );
    expect(() =>
      assertPromptExtensionPoint({ ...inline(), schema: type({ company: 'string', '+': 'reject' }) }),
    ).not.toThrow();
  });

  it('validates value and tool fallbacks when the contract is registered', () => {
    expect(() => assertPromptExtensionPoint({ ...inline(), failurePolicy: 'use-default', defaultValue: 123 })).toThrow(
      /invalid defaultValue/i,
    );
    expect(() =>
      assertPromptExtensionPoint({
        ...base(),
        delivery: 'tool',
        allowedCapabilities: ['draft_email'],
        failurePolicy: 'use-default',
        defaultValue: ['send_email'],
      }),
    ).toThrow(/invalid defaultValue/i);
  });
});
