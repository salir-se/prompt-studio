// @module-tag dom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { McpToolImport } from './McpToolImport';
import { MCP_SERVER } from './mcp-fixtures';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it('searches discovered tools, normalizes the model alias and collapses the catalog after acceptance', async () => {
  vi.mocked(studioJson).mockResolvedValue({
    servers: [
      {
        ...MCP_SERVER,
        tools: [
          ...MCP_SERVER.tools,
          { ...MCP_SERVER.tools[0], name: 'documents.fetch', description: 'Fetch a document' },
        ],
      },
    ],
  });
  const choose = vi.fn(() => true);
  render(<McpToolImport onChoose={choose} disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse MCP tools' }));
  const query = await screen.findByLabelText('Find an MCP tool');
  fireEvent.change(query, { target: { value: 'document' } });
  expect(screen.queryByRole('button', { name: 'Use lookup_company definition' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use documents.fetch definition' }));
  expect(choose).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'documents_fetch', description: 'Fetch a document' }),
  );
  expect(screen.queryByLabelText('Find an MCP tool')).not.toBeInTheDocument();
});
