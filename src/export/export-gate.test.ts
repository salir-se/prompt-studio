// @module-tag dom
import type { PromptVerificationFinding, PromptVerificationSeverity } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import { buildForceRecord, describeRefusalReason, evaluateExportGate } from './export-gate';

/**
 * Single fabrication point for findings — a minimal literal satisfying the REAL
 * `PromptVerificationFinding` union (deterministic, consolidated scope by default). Only the fields
 * the gate reads (`severity`, `message`, `source`, `ruleId`) vary per test.
 */
function makeFinding(
  severity: PromptVerificationSeverity,
  overrides: {
    readonly message?: string;
    readonly ruleId?: string;
    readonly enforcement?: 'edit' | 'activation' | 'runtime';
  } = {},
): PromptVerificationFinding {
  return {
    source: 'deterministic',
    scope: 'consolidated',
    profile: { id: 'legacy-consolidated-test', version: 1 },
    ruleId: overrides.ruleId ?? 'known-placeholder',
    severity,
    enforcement: overrides.enforcement ?? 'activation',
    message: overrides.message ?? 'Placeholder {{mystery}} is not a known variable.',
  };
}

/** Semantic branch of the union — carries `principleId`, no `ruleId`. */
function makeSemanticFinding(severity: PromptVerificationSeverity, message: string): PromptVerificationFinding {
  return {
    source: 'semantic',
    scope: 'consolidated',
    profile: { id: 'legacy-consolidated-test', version: 1 },
    principleId: 'no-fabricated-claims',
    severity,
    message,
    evidenceQuote: 'we guarantee 10x replies',
    proposedCorrection: 'Remove the unverifiable guarantee.',
  };
}

describe('evaluateExportGate', () => {
  it('allows clean input with zero reasons and an empty force record', () => {
    const result = evaluateExportGate({ undeclaredVariables: [], findings: [] });
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(buildForceRecord(result, false)).toEqual({ forced: false, overriddenReasons: [] });
  });

  it('refuses on undeclared variables — one reason each, deduped and sorted', () => {
    const result = evaluateExportGate({
      undeclaredVariables: ['zeta', 'alpha', 'zeta', 'mid'],
      findings: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual([
      { kind: 'undeclared-variable', name: 'alpha' },
      { kind: 'undeclared-variable', name: 'mid' },
      { kind: 'undeclared-variable', name: 'zeta' },
    ]);
  });

  it('refuses only on deterministic activation/runtime errors', () => {
    const advisory = evaluateExportGate({
      undeclaredVariables: [],
      findings: [
        makeFinding('warning'),
        makeFinding('info'),
        makeFinding('error', { enforcement: 'edit' }),
        makeSemanticFinding('error', 'soft concern'),
      ],
    });
    expect(advisory.allowed).toBe(true);
    expect(advisory.reasons).toEqual([]);

    const refused = evaluateExportGate({
      undeclaredVariables: [],
      findings: [makeFinding('warning'), makeFinding('error', { message: 'Missing required section.' })],
    });
    expect(refused.allowed).toBe(false);
    expect(refused.reasons).toEqual([
      { kind: 'error-finding', message: 'Missing required section.', ruleId: 'known-placeholder' },
    ]);
  });

  it('keeps semantic error findings advisory', () => {
    const result = evaluateExportGate({
      undeclaredVariables: [],
      findings: [makeSemanticFinding('error', 'Fabricated claim detected.')],
    });
    expect(result).toEqual({ allowed: true, reasons: [] });
  });

  it('mixes both reason kinds and describes each with the exact manifest wording', () => {
    const result = evaluateExportGate({
      undeclaredVariables: ['company_name'],
      findings: [makeFinding('error', { message: 'Body is empty.', ruleId: 'non-empty' })],
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.map((reason) => reason.kind)).toEqual(['undeclared-variable', 'error-finding']);
    expect(result.reasons.map(describeRefusalReason)).toEqual([
      'Undeclared variable {{company_name}} — declare it in the Variables panel before exporting.',
      'Verification error [non-empty]: Body is empty.',
    ]);
  });
});

describe('buildForceRecord', () => {
  const refused = evaluateExportGate({
    undeclaredVariables: ['tone'],
    findings: [makeFinding('error', { message: 'Body is empty.', ruleId: 'non-empty' })],
  });

  it('records forced: true with ALL overridden reasons described when a refused export is forced', () => {
    expect(buildForceRecord(refused, true)).toEqual({
      forced: true,
      overriddenReasons: [
        'Undeclared variable {{tone}} — declare it in the Variables panel before exporting.',
        'Verification error [non-empty]: Body is empty.',
      ],
    });
  });

  it('records nothing when refused but not forced', () => {
    expect(buildForceRecord(refused, false)).toEqual({ forced: false, overriddenReasons: [] });
  });

  it('records nothing when forcing an export the gate already allowed', () => {
    const allowed = evaluateExportGate({ undeclaredVariables: [], findings: [makeFinding('info')] });
    expect(allowed.allowed).toBe(true);
    expect(buildForceRecord(allowed, true)).toEqual({ forced: false, overriddenReasons: [] });
  });
});
