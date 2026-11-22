import { ToolDefinitionNode } from '@prompt-studio/prompt-graph-ui';
import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { useState } from 'react';
import { buildToolDirectory } from '../catalog/tool-directory';
import { CloseButton } from '../components/CloseButton';

/** Top-bar "Tools" drawer: every built-in (non-MCP) tool definition, unioned across all agents. */

const SOURCE_CHIP_CLASSES = 'bg-muted text-muted-foreground';
const CHIP_BASE_CLASSES = 'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px]';

export interface ToolsPanelProps {
  onClose: () => void;
  usedToolNames?: readonly string[];
}

export function ToolsPanel({ onClose, usedToolNames }: ToolsPanelProps): React.JSX.Element {
  const directory = buildToolDirectory();
  const [query, setQuery] = useState('');
  const [usedOnly, setUsedOnly] = useState(false);
  const search = query.trim().toLowerCase();
  const visible = directory.filter(
    (entry) =>
      (!usedOnly || usedToolNames?.includes(entry.name)) &&
      [entry.name, entry.description, ...entry.sources].join(' ').toLowerCase().includes(search),
  );

  return (
    <aside
      aria-label="Tools"
      data-testid="tools-drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[560px] max-w-full flex-col border-l border-border bg-card shadow-xl"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">
          Tools <span className="font-normal text-muted-foreground">({directory.length})</span>
        </h2>
        <CloseButton onClick={onClose} />
      </header>
      <div className="space-y-3 border-b border-border bg-muted/20 px-4 py-3">
        <p className="text-xs leading-5 text-muted-foreground">
          Read-only runtime catalog. Tools available to agents in the developer manifest; these are not project tool
          definitions.
        </p>
        <label className="block text-xs font-medium">
          Find a tool
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, description or agent"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        {usedToolNames !== undefined && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={usedOnly} onChange={(event) => setUsedOnly(event.target.checked)} />
            Used by selected prompt
          </label>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span role="status">
            {visible.length} of {directory.length} tools
          </span>
          {(query || usedOnly) && (
            <button
              type="button"
              className="text-foreground underline"
              onClick={() => {
                setQuery('');
                setUsedOnly(false);
              }}
            >
              Clear filter
            </button>
          )}
        </div>
      </div>
      <TimelineScrollRegion className="min-h-0 flex-1" viewportClassName="flex flex-col gap-4 p-4">
        {visible.length === 0 && <p className="text-sm text-muted-foreground">No tools match these filters.</p>}
        {visible.map((entry) => (
          <div
            key={entry.name}
            className="flex min-w-0 flex-col gap-1 [&>article]:w-full [&_p]:line-clamp-none [&_p]:break-words"
          >
            <ToolDefinitionNode
              name={entry.name}
              description={entry.description}
              inputKeys={entry.inputKeys}
              source="builtin"
            />
            <div className="flex flex-wrap items-center gap-1 pl-1">
              <span className="text-[11px] text-muted-foreground">used by</span>
              {entry.sources.map((source) => (
                <span key={source} className={`${CHIP_BASE_CLASSES} ${SOURCE_CHIP_CLASSES}`}>
                  {source}
                </span>
              ))}
            </div>
          </div>
        ))}
      </TimelineScrollRegion>
    </aside>
  );
}
