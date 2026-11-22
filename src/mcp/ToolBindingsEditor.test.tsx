// @module-tag dom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { ToolBindingsEditor } from './ToolBindingsEditor';
import type { ToolBinding } from './contracts';
import { MCP_BINDING, MCP_SERVER } from './mcp-fixtures';

function Editor({ initial = [] }: { initial?: ToolBinding[] }) {
  const [value, setValue] = useState(initial);
  return <ToolBindingsEditor value={value} servers={[MCP_SERVER]} onChange={setValue} />;
}
it('starts a selected tool with an explicit mock and retains its draft while switching modes', () => {
  render(<Editor />);
  fireEvent.change(screen.getByLabelText('Available MCP tool'), {
    target: { value: `${MCP_SERVER.id}/lookup_company` },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Add tool$/ }));
  expect(screen.getByLabelText('Execution mode')).toHaveValue('mock');
  const mock = screen.getByLabelText(/^Mock response/);
  expect(mock).toHaveValue('');
  expect(mock).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(mock, { target: { value: '{"found":true}' } });
  expect(mock).toHaveAttribute('aria-invalid', 'false');
  fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'real' } });
  expect(screen.getByRole('status')).toHaveTextContent('contact their MCP servers');
  expect(screen.queryByLabelText(/^Mock response/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'mock' } });
  expect(screen.getByLabelText(/^Mock response/)).toHaveValue('{"found":true}');
});
it('keeps focus while editing an alias and removes the execution grant when a tool is removed', () => {
  render(<Editor initial={[MCP_BINDING]} />);
  const alias = screen.getByLabelText('Prompt tool name');
  alias.focus();
  fireEvent.change(alias, { target: { value: 'company_lookup' } });
  expect(alias).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Remove company_lookup' }));
  expect(screen.queryByLabelText('Execution mode')).not.toBeInTheDocument();
});
