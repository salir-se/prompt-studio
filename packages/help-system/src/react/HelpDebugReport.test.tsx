// @module-tag dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TargetIssue } from '../core/targetScanner';
import { HelpDebugReport } from './HelpDebugReport';

describe('HelpDebugReport', () => {
  it('shows a healthy message when there are no issues', () => {
    render(<HelpDebugReport issues={[]} />);
    expect(screen.getByText(/Help targets healthy/i)).toBeInTheDocument();
  });

  it('lists each issue with its detail and kind', () => {
    const issues: TargetIssue[] = [
      { kind: 'missing_target', helpId: 'scout.gone', detail: 'missing scout.gone' },
      { kind: 'missing_video', videoId: 'v1', detail: 'unknown video v1' },
    ];
    render(<HelpDebugReport issues={issues} />);
    const list = screen.getByRole('list', { name: 'Help target issues' });
    expect(list).toBeInTheDocument();
    expect(screen.getByText('missing scout.gone')).toBeInTheDocument();
    expect(screen.getByText('unknown video v1')).toBeInTheDocument();
  });
});
