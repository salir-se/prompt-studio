import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { Label } from '@prompt-studio/ui/label';
import { Textarea } from '@prompt-studio/ui/textarea';
import { useState } from 'react';
import { useShortcutEducation } from '../shortcuts/shortcut-context';
import type { StudioMcpServer, ToolBinding } from './contracts';
import { mcpToolName } from './mcp-tool-name';

function mockError(value: string | undefined) {
  try {
    const parsed: unknown = JSON.parse(value ?? '');
    return parsed && typeof parsed === 'object' ? '' : 'Use a JSON object or array.';
  } catch {
    return 'Enter a valid JSON mock response before running.';
  }
}
/** Bindings are owned by a run profile or an individual test case, never by the connection catalog. */
export function ToolBindingsEditor({
  value,
  servers = [],
  onChange,
}: {
  value: ToolBinding[];
  servers?: StudioMcpServer[];
  onChange: (value: ToolBinding[]) => void;
}) {
  const [selection, setSelection] = useState('');
  const education = useShortcutEducation();
  const available = servers.flatMap((server) =>
    server.tools.map((tool) => ({ server, tool, key: `${server.id}/${tool.name}` })),
  );
  function add() {
    const entry = available.find((entry) => entry.key === selection);
    if (!entry || value.some((binding) => binding.serverId === entry.server.id && binding.toolName === entry.tool.name))
      return;
    const base = mcpToolName(entry.tool.name);
    let name = base;
    let suffix = 2;
    while (value.some((binding) => binding.name === name)) name = `${base}_${suffix++}`;
    onChange([
      ...value,
      {
        name,
        serverId: entry.server.id,
        toolName: entry.tool.name,
        schemaHash: entry.tool.schemaHash,
        mode: 'mock',
        mock: '',
      },
    ]);
    setSelection('');
  }
  const update = (index: number, patch: Partial<ToolBinding>) =>
    onChange(value.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  return (
    <section aria-label="Tool execution" className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Tools · {value.length} selected</h4>
        <Button type="button" size="sm" variant="ghost" onClick={() => education.open('settings', 'mcp')}>
          Manage MCP servers
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only selected tools are offered to the model. New selections use predefined mocks.
      </p>
      {value.some((binding) => binding.mode === 'real') && (
        <p role="status" className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs">
          Real tools contact their MCP servers and may change external data. Each selected real tool can run in every
          test and compared version.
        </p>
      )}
      {value.map((binding, index) => {
        const entry = available.find(
          (entry) => entry.server.id === binding.serverId && entry.tool.name === binding.toolName,
        );
        const error = binding.mode === 'mock' ? mockError(binding.mock) : '';
        return (
          <fieldset
            key={`${binding.serverId}/${binding.toolName}`}
            className="grid min-w-0 gap-3 rounded-lg border p-3"
          >
            <legend className="max-w-full break-all px-1 text-xs">
              {entry?.server.name ?? 'Unavailable server'} / {binding.toolName}
            </legend>
            {(!entry || entry.tool.schemaHash !== binding.schemaHash) && (
              <p role="alert" className="text-xs text-destructive">
                This tool is unavailable or its schema changed. Remove and reselect it before running.
              </p>
            )}
            <Label className="grid gap-1 text-xs">
              Prompt tool name
              <Input
                value={binding.name}
                maxLength={64}
                onChange={(event) => update(index, { name: event.target.value })}
              />
            </Label>
            <Label className="grid gap-1 text-xs">
              Execution mode
              <select
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
                value={binding.mode}
                onChange={(event) => update(index, { mode: event.target.value as ToolBinding['mode'] })}
              >
                <option value="mock">Predefined mock</option>
                <option value="real" disabled={!entry?.tool.canCall}>
                  Real MCP call
                </option>
              </select>
            </Label>
            {entry && !entry.tool.canCall && (
              <p className="text-xs text-muted-foreground">
                Real calls for this tool are unavailable in Studio. Use a mock to test the prompt.
              </p>
            )}
            {binding.mode === 'mock' && (
              <Label className="grid min-w-0 gap-1 text-xs">
                Mock response (JSON)
                <Textarea
                  rows={4}
                  value={binding.mock ?? ''}
                  placeholder={'{"company":"Example"}'}
                  onChange={(event) => update(index, { mock: event.target.value })}
                  aria-invalid={!!error}
                />
                {error && <span className="text-destructive">{error}</span>}
                <span className="text-muted-foreground">
                  Returned for every invocation of this tool in this run. The MCP server is not contacted.
                </span>
              </Label>
            )}
            {entry && (
              <details className="min-w-0 text-xs">
                <summary className="cursor-pointer">Description and expected arguments</summary>
                <p className="mt-2 break-words">{entry.tool.description}</p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(entry.tool.inputSchema, null, 2)}
                </pre>
              </details>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              Remove {binding.name || 'tool'}
            </Button>
          </fieldset>
        );
      })}
      {available.length ? (
        <div className="flex flex-wrap items-end gap-2">
          <Label className="grid min-w-0 flex-1 gap-1 text-xs">
            Available MCP tool
            <select
              className="w-full rounded-md border border-input bg-background p-2 text-sm"
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
            >
              <option value="">Select a discovered tool</option>
              {available.map((entry) => (
                <option
                  key={entry.key}
                  value={entry.key}
                  disabled={value.some(
                    (binding) => binding.serverId === entry.server.id && binding.toolName === entry.tool.name,
                  )}
                >
                  {entry.server.name} / {entry.tool.name}
                </option>
              ))}
            </select>
          </Label>
          <Button type="button" variant="outline" disabled={!selection || value.length >= 32} onClick={add}>
            Add tool
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Register an MCP server and discover its tools in App settings.</p>
      )}
    </section>
  );
}
