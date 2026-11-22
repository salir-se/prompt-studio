import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { Label } from '@prompt-studio/ui/label';
import { useMcpSettings } from './use-mcp-settings';
export function McpSettings(props: {
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const { servers, draft, loading, busy, error, notice, save, edit, changeDraft, retry, discover, remove, cancel } =
    useMcpSettings(props);
  return (
    <section aria-label="MCP servers" className="mx-auto grid w-full max-w-2xl gap-5 p-4 sm:p-6">
      <div>
        <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Tool connections</p>
        <h3 className="text-xl font-semibold">MCP servers</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect tool catalogs once, then choose real or mocked responses for each prompt run and test case.
        </p>
      </div>
      {loading && <p role="status">Loading MCP servers…</p>}
      {error && (
        <div role="alert" className="grid gap-2 text-sm text-destructive">
          <p>{error}</p>
          {!servers.length && (
            <Button type="button" variant="outline" onClick={retry}>
              Retry loading MCP servers
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {!loading && servers.length === 0 && (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          No MCP servers registered. Add an HTTP endpoint below, then discover its tools.
        </p>
      )}
      {servers.map((server) => (
        <article key={server.id} className="grid min-w-0 gap-3 rounded-xl border bg-card p-4">
          <div>
            <h4 className="break-words font-medium">{server.name}</h4>
            <p className="break-all text-xs text-muted-foreground">{server.url}</p>
          </div>
          <p className="text-xs">
            {server.tools.length} discovered tools ·{' '}
            {server.credentialAvailable ? 'Bearer available for this session' : 'No bearer saved in this session'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => edit(server)}>
              Edit {server.name}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void discover(server)}>
              Discover tools
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void remove(server)}>
              Remove {server.name}
            </Button>
          </div>
          {server.tools.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs">Discovered tool names</summary>
              <ul className="mt-2 grid gap-1 text-xs">
                {server.tools.map((tool) => (
                  <li key={tool.name} className="break-all font-mono">
                    {tool.name}
                    {!tool.canCall ? ' · mock only' : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </article>
      ))}
      {!loading && (
        <form
          className="grid gap-4 rounded-xl border bg-muted/20 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h4 className="font-medium">{draft.id ? 'Edit MCP server' : 'Register MCP server'}</h4>
          <fieldset disabled={busy} className="grid min-w-0 gap-4">
            <Label className="grid gap-1 text-sm">
              Server name
              <Input
                required
                maxLength={100}
                value={draft.name}
                onChange={(event) => changeDraft({ name: event.target.value })}
              />
            </Label>
            <Label className="grid gap-1 text-sm">
              MCP endpoint URL
              <Input
                required
                type="url"
                value={draft.url}
                placeholder="https://example.com/mcp"
                onChange={(event) => changeDraft({ url: event.target.value })}
              />
              <span className="text-xs text-muted-foreground">
                Streamable HTTP. HTTPS, or HTTP on localhost. Local stdio processes are not supported.
              </span>
            </Label>
            <Label className="grid gap-1 text-sm">
              Bearer token (optional)
              <Input
                type="password"
                autoComplete="off"
                value={draft.apiKey}
                onChange={(event) => changeDraft({ apiKey: event.target.value })}
              />
              <span className="text-xs text-muted-foreground">
                Leave blank to keep the token for an unchanged endpoint. Tokens stay in server memory; reconnect after
                restarting Studio.
              </span>
            </Label>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Connections stay on this computer and are excluded from project exports. Saving registers an address; it
            does not invoke tools.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Working…' : 'Save server'}
            </Button>
            {draft.id && (
              <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
                Cancel editing
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
