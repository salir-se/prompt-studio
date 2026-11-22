// @module-tag dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EvaluationResults } from './EvaluationResults';
import { CAPTURED_EVALUATION } from './run-fixtures';

afterEach(cleanup);
it('lets a keyboard reader focus and scroll each compared output and captured prompt source', () => {
  render(<EvaluationResults evaluation={CAPTURED_EVALUATION} busy={false} onCancel={() => {}} />);
  const output = screen.getByRole('region', { name: 'prompt-v1 output for Evidence in recommendations' });
  expect(output).toHaveAttribute('tabindex', '0');
  output.focus();
  expect(output).toHaveFocus();
  const source = screen.getByRole('region', { name: 'prompt-v1 prompt source' });
  expect(source).toHaveAttribute('tabindex', '0');
});
