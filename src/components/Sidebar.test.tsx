// @module-tag dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { starterCatalog } from '../test-fixtures/starter-catalog';
import { Sidebar } from './Sidebar';

afterEach(cleanup);

it('finds a prompt by name and lets the author recover from no search results', () => {
  // Given: the sidebar listing the starter project's prompts
  render(
    <Sidebar
      catalog={starterCatalog()}
      selectedRootId={null}
      selectedVariantSymbol={undefined}
      onSelectRoot={vi.fn()}
      onSelectVariant={vi.fn()}
    />,
  );
  // When: the author searches by a prompt's name
  const search = screen.getByRole('searchbox', { name: 'Find a prompt' });
  fireEvent.change(search, { target: { value: 'triage' } });
  // Then: only the matching prompt stays listed
  expect(screen.getByTestId('prompt-root-support-triage')).toBeInTheDocument();
  expect(screen.queryByTestId('prompt-root-release-notes')).not.toBeInTheDocument();
  // When: the search matches nothing
  fireEvent.change(search, { target: { value: 'a prompt that does not exist' } });
  expect(screen.getByText('No matching prompts')).toBeInTheDocument();
  // Then: Clear search brings every prompt back
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByTestId('prompt-root-release-notes')).toBeInTheDocument();
});
