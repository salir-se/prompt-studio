// @module-tag dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FragmentNode } from './FragmentNode';
import type { SectionVerificationCoverage } from './VerificationCoverage';

afterEach(cleanup);
const coverage: SectionVerificationCoverage = {
  sectionId: 'example.mission',
  automatic: { basic: 1, custom: 2, status: 'not-checked' },
  ai: { generated: 3, custom: 1, status: 'stale' },
};

it('#2488: collapses coverage and actions into one row without losing edit, expand or verification access', () => {
  const onEditRequest = vi.fn();
  const onToggleCollapse = vi.fn();
  const onOpenVerification = vi.fn();
  render(
    <FragmentNode
      title="Mission"
      delimiter="xml-tag"
      depth={1}
      text="Instructions"
      variables={[]}
      toolMentions={[]}
      collapsed
      selected
      fillContainer
      promptAnchor="opening"
      coverage={coverage}
      onOpenVerification={onOpenVerification}
      onEditRequest={onEditRequest}
      onToggleCollapse={onToggleCollapse}
      sectionActions={{ onAddChildSection: vi.fn() }}
    />,
  );
  expect(screen.getByRole('article').children).toHaveLength(1);
  expect(screen.queryByText('1 basic · 2 custom')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Automatic checks for Mission/ })).toHaveTextContent('Auto 3');
  fireEvent.click(screen.getByRole('button', { name: /AI criteria for Mission/ }));
  expect(onOpenVerification).toHaveBeenCalledWith('example.mission', 'ai');
  fireEvent.click(screen.getByRole('button', { name: 'Edit section' }));
  expect(onEditRequest).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Expand section' }));
  expect(onToggleCollapse).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Section actions' })).toBeInTheDocument();
});

it('shows configured tests before checking, separates Design-derived criteria, and opens the requested section', () => {
  const onOpenVerification = vi.fn();
  render(
    <FragmentNode
      title="Mission"
      delimiter="xml-tag"
      depth={1}
      text="Do the task."
      variables={[]}
      toolMentions={[]}
      coverage={coverage}
      onOpenVerification={onOpenVerification}
    />,
  );
  const automatic = screen.getByRole('button', {
    name: /Automatic checks for Mission: 1 basic, 2 custom, not checked/i,
  });
  expect(automatic).toHaveTextContent('Auto 3');
  expect(screen.getByText('1 basic · 2 custom')).toBeInTheDocument();
  expect(screen.getByText('3 Design · 1 custom')).toBeInTheDocument();
  expect(screen.getByText(/Stale/)).toBeInTheDocument();
  automatic.focus();
  expect(automatic).toHaveFocus();
  fireEvent.click(automatic);
  expect(onOpenVerification).toHaveBeenLastCalledWith('example.mission', 'checks');
  fireEvent.click(screen.getByRole('button', { name: /AI criteria for Mission/ }));
  expect(onOpenVerification).toHaveBeenLastCalledWith('example.mission', 'ai');
});

it('keeps zero coverage visible and does not claim checks passed just because criteria exist', () => {
  render(
    <FragmentNode
      title="Empty"
      delimiter="xml-tag"
      depth={1}
      text=""
      variables={[]}
      toolMentions={[]}
      coverage={{
        sectionId: 'empty',
        automatic: { basic: 0, custom: 0, status: 'not-checked' },
        ai: { generated: 0, custom: 0, status: 'not-checked' },
      }}
    />,
  );
  expect(screen.getByText('Auto 0')).toBeInTheDocument();
  expect(screen.getByText('AI 0')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText(/passed|verified|good coverage/i)).not.toBeInTheDocument();
});
