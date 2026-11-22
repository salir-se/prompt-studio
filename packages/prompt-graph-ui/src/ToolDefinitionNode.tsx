/**
 * ToolDefinitionNode — a presentational, read-only card rendering one tool's
 * contract (name, description, input keys) for the prompt graph studio.
 *
 * Per ADR-202 §7: tool nodes are READ-ONLY REGISTRY PROJECTIONS, never
 * authored objects. A blueprint's tool extension point references a
 * capability by name; it never redeclares a schema. This component reflects
 * that: it has no way to look a tool up, edit one, or fetch anything — it
 * only renders whatever contract shape its caller (eventually a registry
 * lookup over `@prompt-studio/tools`' `ToolRegistry` for `source: 'builtin'`, or
 * `McpServerConfig`/`mcpToolsToDefinitions` metadata per ADR-013 for
 * `source: 'mcp'`) hands it as props.
 *
 * Pure by design, matching `FragmentNode`/`LabelChip`: no data fetching, no
 * `useEffect`, no graph-rendering library import. A future canvas node wraps
 * this component; this component itself knows nothing about graphs.
 *
 * Colour vocabulary matches `FragmentNode`'s tool chips and
 * `TOKEN_KIND_CLASSES` in `PromptHighlightedEditor.tsx`: tool = sky.
 */

import { Badge } from '@prompt-studio/ui/badge';
import { cn } from '@prompt-studio/ui/utils';

export interface ToolDefinitionNodeProps {
  /** The tool's stable name, as referenced from a prompt (e.g. `web_search`). */
  name: string;
  /** The tool's contract description — what it does, from the registry/MCP metadata. */
  description?: string;
  /** The tool's input schema keys, shown as a quick-scan chip row (not the full JSON schema). */
  inputKeys?: readonly string[];
  /** Where this tool's contract comes from — a built-in in `@prompt-studio/tools`' `ToolRegistry`, or an MCP server. */
  source: 'builtin' | 'mcp';
  /** For `source: 'mcp'` — the configured MCP server's label (ADR-013), shown as `mcp · <serverLabel>`. */
  serverLabel?: string;
  /** Whether this node is the current selection in a containing graph/list view. */
  selected?: boolean;
}

const TOOL_KIND_CHIP_CLASSES = 'bg-sky-100/70 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300';
const INPUT_KEY_CHIP_CLASSES = 'bg-muted text-muted-foreground';
const CHIP_BASE_CLASSES = 'inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-xs';

function sourceBadgeLabel(source: ToolDefinitionNodeProps['source'], serverLabel: string | undefined): string {
  if (source === 'builtin') return 'builtin';
  return serverLabel ? `mcp · ${serverLabel}` : 'mcp';
}

export function ToolDefinitionNode({
  name,
  description,
  inputKeys = [],
  source,
  serverLabel,
  selected = false,
}: ToolDefinitionNodeProps): React.JSX.Element {
  return (
    <article
      aria-label={name}
      aria-current={selected ? 'true' : undefined}
      data-selected={selected}
      data-testid="tool-definition-node"
      className={cn(
        'flex w-[360px] flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground',
        selected && 'ring-2 ring-ring',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn(CHIP_BASE_CLASSES, TOOL_KIND_CHIP_CLASSES, 'shrink-0')}>tool</span>
          <h3 className="truncate text-sm font-semibold">{name}</h3>
        </div>
        <Badge variant="outline" className="shrink-0 font-mono">
          {sourceBadgeLabel(source, serverLabel)}
        </Badge>
      </div>
      {description && (
        <p data-testid="tool-definition-node-description" className="line-clamp-3 text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {inputKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Input keys</span>
          <ul className="flex flex-wrap gap-1" aria-label="Input keys">
            {inputKeys.map((key) => (
              <li key={key} className={cn(CHIP_BASE_CLASSES, INPUT_KEY_CHIP_CLASSES)}>
                {key}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
