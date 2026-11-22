import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { Label } from '@prompt-studio/ui/label';
import { useState } from 'react';
import type { ProjectTool } from '../prompt-repo/project-definitions';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { useShortcutEducation } from '../shortcuts/shortcut-context';
import type { StudioMcpServer } from './contracts';
import { mcpToolName } from './mcp-tool-name';
export function McpToolImport({ onChoose, disabled }: { onChoose: (tool: ProjectTool) => boolean; disabled: boolean }) {
  const education = useShortcutEducation();
  const [servers, setServers] = useState<StudioMcpServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const matches = (servers ?? [])
    .flatMap((server) => server.tools.map((tool) => ({ server, tool })))
    .filter(({ server, tool }) =>
      `${server.name} ${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()),
    );
  async function load() {
    setBusy(true);
    setError('');
    try {
      setServers((await studioJson<{ servers: StudioMcpServer[] }>('/__studio/run/mcp-servers')).servers);
    } catch {
      setError('MCP tools could not be loaded. Register a server in App settings, then retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Import MCP tool" className="grid min-w-0 gap-3 rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy || disabled} onClick={() => void load()}>
          {busy ? 'Loading tools…' : 'Browse MCP tools'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => education.open('settings', 'mcp')}>
          Manage MCP servers
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {servers && (
        <div className="grid min-w-0 gap-3">
          <Label className="grid gap-1 text-xs">
            Find an MCP tool
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, server or description"
            />
          </Label>
          <p className="text-xs text-muted-foreground">
            {matches.length} matching tools{matches.length > 50 ? ' · Showing the first 50. Narrow your search.' : ''}
          </p>
          {matches.slice(0, 50).map(({ server, tool }) => (
            <div key={`${server.id}/${tool.name}`} className="grid min-w-0 gap-2 rounded-lg border bg-card p-3">
              <p className="break-all text-xs text-muted-foreground">
                {server.name} / {tool.name}
              </p>
              <p className="break-words text-sm">{tool.description}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                disabled={disabled}
                onClick={() => {
                  if (
                    onChoose({
                      name: mcpToolName(tool.name),
                      description: tool.description,
                      inputSchema: tool.inputSchema,
                    })
                  )
                    setServers(null);
                }}
              >
                Use {tool.name} definition
              </Button>
            </div>
          ))}
          {!servers.some((server) => server.tools.length) && (
            <p className="text-sm text-muted-foreground">
              No discovered tools yet. Register a server and discover its tools in App settings.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
