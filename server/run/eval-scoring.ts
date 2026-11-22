import { type } from 'arktype';
import type { EvalCase, EvalCaseResult, RunRecord } from '../../src/run/contracts';

export function scoreCase(test: EvalCase, candidateId: string, run: RunRecord): EvalCaseResult {
  const checks: EvalCaseResult['checks'] = [];
  for (const value of test.checks.contains ?? [])
    checks.push({ label: `Contains: ${value}`, passed: run.output.includes(value) });
  for (const value of test.checks.notContains ?? [])
    checks.push({ label: `Excludes: ${value}`, passed: !run.output.includes(value) });
  if (test.checks.equals !== undefined)
    checks.push({ label: 'Exact match', passed: run.output === test.checks.equals });
  if (test.checks.json) {
    let valid = false;
    try {
      JSON.parse(run.output);
      valid = true;
    } catch {
      /* A failed JSON check is an ordinary test failure. */
    }
    checks.push({ label: 'Valid JSON', passed: valid });
  }
  return {
    caseId: test.id,
    candidateId,
    runId: run.runId,
    output: run.output,
    ...(run.toolCalls ? { toolCalls: run.toolCalls, toolDefinitions: run.toolDefinitions } : {}),
    checks,
    status:
      run.status !== 'completed'
        ? 'error'
        : checks.length === 0
          ? 'unscored'
          : checks.every((check) => check.passed)
            ? 'passed'
            : 'failed',
    ...(run.status !== 'completed' ? { error: run.error ?? `Run ${run.status}.` } : {}),
  };
}
const verdict = type({ '+': 'reject', verdict: '"A" | "B" | "tie"', reason: type('string > 0').atMostLength(20_000) });
export function judgeVerdict(output: string) {
  const result = verdict(JSON.parse(output));
  if (result instanceof type.errors) throw new Error('Judge returned an invalid verdict.');
  return result;
}
