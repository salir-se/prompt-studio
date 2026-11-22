import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { McpSettings } from './McpSettings';
import { ToolBindingsEditor } from './ToolBindingsEditor';
import { ToolCallHistory } from './ToolCallHistory';
import type { StudioMcpServer, ToolBinding } from './contracts';
import { MCP_BINDING, MCP_SERVER, MCP_TRACE } from './mcp-fixtures';

function Bindings({
  initial = [MCP_BINDING],
  server = MCP_SERVER,
}: {
  initial?: ToolBinding[];
  server?: StudioMcpServer;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="studio min-h-dvh bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-2xl">
        <ToolBindingsEditor value={value} servers={[server]} onChange={setValue} />
      </div>
    </div>
  );
}
const noop = () => {};
const meta = {
  title: 'Prompts/PromptStudio/MCP tools',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="studio min-h-dvh bg-background text-foreground">
      <McpSettings onDirtyChange={noop} onBusyChange={noop} />
    </div>
  ),
  beforeEach: ({ parameters }) => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (!String(input).includes('/__studio/run/')) return original(input, init);
      if (parameters.mcpState === 'loading') return new Promise<Response>(() => {});
      if (init?.method === 'POST' && parameters.mcpState === 'error')
        return Response.json(
          { error: 'The MCP server did not respond. Check the URL and retry discovery.' },
          { status: 503 },
        );
      if (String(input).endsWith('/settings'))
        return Response.json({
          provider: 'openai',
          model: 'configured-model',
          baseUrl: '',
          skillsFolder: '',
          connected: false,
          skills: [],
          mcpServers: [MCP_SERVER],
        });
      return Response.json({ servers: parameters.mcpState === 'empty' ? [] : [MCP_SERVER] });
    };
    return () => {
      globalThis.fetch = original;
    };
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const RegisteredServers: Story = {};
export const Empty: Story = { parameters: { mcpState: 'empty' } };
export const Loading: Story = { parameters: { mcpState: 'loading' } };
export const DiscoveryError: Story = {
  parameters: { mcpState: 'error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Discover tools' }));
    await expect(canvas.getByRole('alert')).toHaveTextContent('did not respond');
    await expect(canvas.getByText('Research tools', { exact: true })).toBeVisible();
  },
};
export const MockResponses: Story = { render: () => <Bindings /> };
export const RealCalls: Story = { render: () => <Bindings initial={[{ ...MCP_BINDING, mode: 'real' }]} /> };
export const InvalidMock: Story = { render: () => <Bindings initial={[{ ...MCP_BINDING, mock: '{"unfinished":' }]} /> };
export const SchemaChanged: Story = {
  render: () => <Bindings initial={[{ ...MCP_BINDING, schemaHash: 'b'.repeat(64) }]} />,
};
export const CapturedCalls: Story = {
  render: () => (
    <div className="studio min-h-dvh bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-2xl">
        <ToolCallHistory
          calls={[
            MCP_TRACE,
            {
              ...MCP_TRACE,
              id: 'real-failure',
              mode: 'real',
              result: undefined,
              error: 'The server connection timed out. No mock was substituted.',
            },
            {
              ...MCP_TRACE,
              id: 'refused',
              mode: 'refused',
              name: 'unselected_tool',
              result: undefined,
              error: 'This tool was not selected for the run.',
            },
          ]}
        />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const summaries = canvasElement.querySelectorAll('summary');
    for (const summary of summaries) await userEvent.click(summary);
  },
};

export const MockOnlyTool: Story = {
  render: () => (
    <Bindings
      server={{ ...MCP_SERVER, tools: [{ ...MCP_SERVER.tools[0], name: 'email_send_message', canCall: false }] }}
      initial={[
        { ...MCP_BINDING, name: 'email_send_message', toolName: 'email_send_message', mock: '{"simulated":true}' },
      ]}
    />
  ),
};
