// @module-tag dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { ShortcutEducation } from '../shortcuts/ShortcutEducation';
import { useShortcutEducation } from '../shortcuts/shortcut-context';
import { MCP_SERVER } from './mcp-fixtures';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn() }));
afterEach(() => {
  document.querySelector('meta[name="studio-workspace"]')?.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
function Open() {
  const education = useShortcutEducation();
  return (
    <button type="button" onClick={() => education.open('settings', 'mcp')}>
      Tool connections
    </button>
  );
}
it('registers and discovers servers through app settings, clears a submitted bearer, and guards pending changes', async () => {
  const calls: Record<string, unknown>[] = [];
  vi.mocked(studioJson).mockImplementation(async (path, init) => {
    if (path.endsWith('/settings'))
      return {
        provider: 'openai',
        model: 'fixture',
        baseUrl: '',
        skillsFolder: '',
        skills: [],
        connected: false,
        mcpServers: [MCP_SERVER],
      };
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body!);
      calls.push(body);
      return { servers: [MCP_SERVER] };
    }
    return { servers: [] };
  });
  vi.stubGlobal(
    'confirm',
    vi.fn(() => false),
  );
  document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
  render(
    <ShortcutEducation>
      <Open />
    </ShortcutEducation>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tool connections' }));
  const name = await screen.findByLabelText('Server name');
  fireEvent.change(name, { target: { value: 'Research tools' } });
  fireEvent.change(screen.getByLabelText(/^MCP endpoint URL/), { target: { value: MCP_SERVER.url } });
  const bearer = screen.getByLabelText(/^Bearer token/);
  fireEvent.change(bearer, { target: { value: 'test-private-bearer' } });
  fireEvent.keyDown(bearer, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'App settings' })).toBeVisible();
  expect(window.confirm).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save server' }));
  await waitFor(() => expect(bearer).toHaveValue(''));
  expect(calls[0]).toMatchObject({ action: 'save', server: { name: 'Research tools', apiKey: 'test-private-bearer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Discover tools' }));
  await screen.findByText(/Tool catalog refreshed/);
  expect(calls[1]).toEqual({ action: 'discover', id: MCP_SERVER.id });
  expect(Object.values(localStorage).join('')).not.toContain('test-private-bearer');
  fireEvent.click(screen.getByRole('tab', { name: 'Models & skills' }));
  fireEvent.click(screen.getByRole('tab', { name: 'MCP servers' }));
  expect(screen.getByText('Research tools', { exact: true })).toBeVisible();
});
