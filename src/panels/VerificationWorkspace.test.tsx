// @module-tag dom
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { withPromptStructure } from '../design/prompt-design-project';
import { SUPPORT_TRIAGE_TEXT, supportTriageRoot } from '../test-fixtures/starter-catalog';
import { VerificationPanel } from './VerificationPanel';

it('distinguishes a cleared result from missing verification support', () => {
  // Given: this supported prompt has no current result after an edit.
  const root = withPromptStructure(supportTriageRoot(), SUPPORT_TRIAGE_TEXT);
  // When: the review workspace opens
  render(<VerificationPanel root={root} result={null} onClose={vi.fn()} />);
  // Then: the author gets an accurate next step instead of a missing-profile diagnosis.
  expect(screen.getByText(/checks have not run for the current source/i)).toBeVisible();
  expect(screen.queryByText(/no verification profile is available/i)).not.toBeInTheDocument();
});
