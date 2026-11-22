// @module-tag dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RunOutput } from './RunOutput';
import { CAPTURED_RUN } from './run-fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('explains when browser clipboard access is unavailable and keeps Download output available', async () => {
  vi.stubGlobal('navigator', { clipboard: undefined });
  render(<RunOutput run={CAPTURED_RUN} busy={false} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy output' }));
  expect(await screen.findByText(/Copy failed/)).toHaveAttribute('role', 'status');
  expect(screen.getByRole('button', { name: 'Download output' })).toBeEnabled();
});
