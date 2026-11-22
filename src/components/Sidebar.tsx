/**
 * The studio's prompt-roots sidebar (ADR-200/ADR-202): the full catalog grouped by loadability —
 * constants and resolver variants are selectable, inline/external roots render disabled with a
 * tooltip explaining why (`unreadableReason`). Selecting a resolver-variants root reveals its
 * variant picker row beneath it. Pure and prop-driven: App.tsx owns the catalog, the selection,
 * and every handler — this component never loads text itself.
 */

import { Input } from '@prompt-studio/ui/input';
import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { useState } from 'react';
import type { CatalogRoot, CatalogVariant, RootLoadability } from '../catalog/root-catalog';
import { cn } from './ui-classes';

const STATUS_DOT_CLASSES: Record<CatalogRoot['status'], string> = {
  live: 'bg-current',
  callable: 'border border-current',
  evaluation: 'bg-current opacity-40',
};

/** Human explanation for why an `'inline'`/`'external'` root cannot be opened — surfaced as a native tooltip. */
export function unreadableReason(loadability: Extract<RootLoadability, 'inline' | 'external'>): string {
  return loadability === 'inline'
    ? 'Assembled inline at call time — there is no single readable prompt root text to load.'
    : 'Defined in an external module the studio cannot read as prompt text.';
}

function RootRowContent({ root }: { root: CatalogRoot }): React.JSX.Element {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT_CLASSES[root.status])} />
        <span className="truncate" title={root.title}>
          {root.title}
        </span>
      </span>
      <span className="shrink-0 text-xs">
        {root.toolNames.length} tool{root.toolNames.length === 1 ? '' : 's'}
      </span>
    </>
  );
}

export interface SidebarProps {
  catalog: readonly CatalogRoot[];
  selectedRootId: string | null;
  selectedVariantSymbol: string | undefined;
  onSelectRoot: (root: CatalogRoot) => void;
  onSelectVariant: (root: CatalogRoot, variant: CatalogVariant) => void;
  /** Shown when the folder has no prompts yet, so the person can start one. */
  onCreatePrompt?: () => void;
  canCreatePrompt?: boolean;
  outline?: React.ReactNode;
}

export function Sidebar({
  catalog,
  selectedRootId,
  selectedVariantSymbol,
  onSelectRoot,
  onSelectVariant,
  onCreatePrompt,
  canCreatePrompt = false,
  outline,
}: SidebarProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const matching = catalog.filter((root) =>
    `${root.title} ${root.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const groups: Array<{ label: string; roots: CatalogRoot[] }> = [
    { label: 'Prompts', roots: matching.filter((root) => root.loadability === 'constant') },
    { label: 'Variants', roots: matching.filter((root) => root.loadability === 'resolver-variants') },
    {
      label: 'Unavailable',
      roots: matching.filter((root) => root.loadability === 'inline' || root.loadability === 'external'),
    },
  ];

  return (
    <nav
      aria-label="Prompt Roots"
      className="studio-sidebar flex h-full w-full shrink-0 flex-col border-r border-border bg-card md:w-64"
      data-testid="prompt-studio-sidebar"
    >
      <TimelineScrollRegion className="min-h-0 flex-1" viewportClassName="overflow-x-hidden">
        <div className="shrink-0 space-y-3 border-b border-border p-4">
          <h2 className="text-sm font-semibold">
            Prompts{' '}
            <span className="font-normal text-muted-foreground" data-testid="prompt-root-count">
              ({catalog.length})
            </span>
          </h2>
          <Input
            type="search"
            aria-label="Find a prompt"
            placeholder="Find a prompt…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-4 p-3">
          {matching.length === 0 && catalog.length > 0 && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
              <p>No matching prompts</p>
              <button type="button" onClick={() => setQuery('')} className="text-primary underline">
                Clear search
              </button>
            </div>
          )}
          {catalog.length === 0 && (
            <button
              type="button"
              disabled={!canCreatePrompt}
              onClick={onCreatePrompt}
              className="rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create a prompt
            </button>
          )}
          {groups.map(
            (group) =>
              group.roots.length > 0 && (
                <div key={group.label}>
                  <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.roots.map((root) => {
                      const unreadable = root.loadability === 'inline' || root.loadability === 'external';
                      const isSelected = root.id === selectedRootId;
                      return (
                        <div key={root.id}>
                          <button
                            type="button"
                            disabled={unreadable}
                            data-testid={`prompt-root-${root.id}`}
                            title={unreadable ? unreadableReason(root.loadability as 'inline' | 'external') : undefined}
                            aria-pressed={unreadable ? undefined : isSelected}
                            onClick={unreadable ? undefined : () => onSelectRoot(root)}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                              unreadable
                                ? 'cursor-not-allowed opacity-50'
                                : isSelected
                                  ? 'bg-primary text-primary-foreground shadow-sm'
                                  : 'hover:bg-muted',
                            )}
                          >
                            <RootRowContent root={root} />
                          </button>
                          {root.loadability === 'resolver-variants' && isSelected && (
                            <div
                              className="ml-4 mt-1 flex flex-wrap gap-1"
                              data-testid={`prompt-variant-picker-${root.id}`}
                            >
                              {(root.variants ?? []).map((variant) => (
                                <button
                                  key={variant.symbol}
                                  type="button"
                                  data-testid={`prompt-variant-${root.id}-${variant.symbol}`}
                                  aria-pressed={variant.symbol === selectedVariantSymbol}
                                  onClick={() => onSelectVariant(root, variant)}
                                  className={cn(
                                    'rounded-sm px-1.5 py-0.5 font-mono text-xs',
                                    variant.symbol === selectedVariantSymbol
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted text-muted-foreground hover:text-foreground',
                                  )}
                                >
                                  {variant.symbol}
                                </button>
                              ))}
                            </div>
                          )}
                          {isSelected && outline}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ),
          )}
        </div>
      </TimelineScrollRegion>
    </nav>
  );
}
