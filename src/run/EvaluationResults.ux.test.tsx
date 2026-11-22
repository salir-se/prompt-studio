// @module-tag dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EvaluationResults } from './EvaluationResults';
import { CAPTURED_EVALUATION } from './run-fixtures';

afterEach(cleanup);
it('summarizes output scores and filters to test cases needing attention', () => {
  const failed = CAPTURED_EVALUATION.suite.cases[0];
  const evaluation = {
    ...CAPTURED_EVALUATION,
    suite: { ...CAPTURED_EVALUATION.suite, cases: [failed, { ...failed, id: 'passing', name: 'Clean case' }] },
    results: [
      ...CAPTURED_EVALUATION.results,
      ...CAPTURED_EVALUATION.results.map((result) => ({
        ...result,
        caseId: 'passing',
        status: 'passed' as const,
        checks: result.checks.map((check) => ({ ...check, passed: true })),
      })),
    ],
  };
  render(<EvaluationResults evaluation={evaluation} busy={false} onCancel={vi.fn()} />);
  expect(screen.getByText('3 passed')).toBeVisible();
  expect(screen.getByText('1 failed')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Needs attention (1)' }));
  expect(screen.getByRole('region', { name: `Results for ${failed.name}` })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Results for Clean case' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All tests (2)' }));
  expect(screen.getByRole('region', { name: 'Results for Clean case' })).toBeVisible();
});
