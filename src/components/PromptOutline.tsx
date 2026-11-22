import type { PromptTreeNode } from '@prompt-studio/prompts';
import { Button } from '@prompt-studio/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@prompt-studio/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@prompt-studio/ui/dropdown-menu';
import { Input } from '@prompt-studio/ui/input';
import { useRef, useState } from 'react';
import { cn } from './ui-classes';
import { usePromptOutline } from './use-prompt-outline';

export interface PromptOutlineProps {
  sections: readonly PromptTreeNode[];
  selectedNodeId?: string;
  onSelect: (nodeId: string) => void;
  onEdit: (nodeId: string) => void;
  onDesign?: (nodeId: string) => void;
  onAddAfter: (nodeId: string, name?: string) => void;
  onAddChild: (nodeId: string, name?: string) => void;
  onMove: (nodeId: string, direction: 'up' | 'down') => void;
  onRemove: (nodeId: string) => void;
}

/** A prompt outline changes Markdown through the same commands as the graph. */
export function PromptOutline(props: PromptOutlineProps) {
  const [adding, setAdding] = useState<{ parent: string; child: boolean; name: string } | null>(null);
  // The naming dialog opens only after the actions menu has released focus. Opening it from the menu item's
  // own `onSelect` mounts two focus traps at once; when the menu and dialog ship different Radix focus-scope
  // copies they trap focus against each other until the call stack overflows.
  const pendingAdd = useRef<{ parent: string; child: boolean } | null>(null);
  const { tree, items, selected, focusWithin } = usePromptOutline(props.sections, props.selectedNodeId, props.onSelect);
  const selectedGraphId = selected?.node ? `section:${selected.node.id}` : undefined;
  return (
    <section aria-label="Prompt structure" className="mt-2 min-w-0 border-l border-border pl-2">
      <div className="flex items-center justify-between gap-2 px-1 py-2">
        <span className="text-[11px] font-medium text-muted-foreground">Structure</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="xs" variant="ghost" disabled={!selected?.node} aria-label="Section actions">
              Actions{' '}
              <svg
                aria-hidden="true"
                data-icon="inline-end"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="studio w-52"
            onCloseAutoFocus={(event) => {
              const pending = pendingAdd.current;
              if (!pending) return;
              pendingAdd.current = null;
              event.preventDefault();
              setAdding({ ...pending, name: '' });
            }}
          >
            <DropdownMenuLabel className="truncate">{selected?.node?.title}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => selectedGraphId && props.onEdit(selectedGraphId)}>
              Edit section
            </DropdownMenuItem>
            {props.onDesign && (
              <DropdownMenuItem onSelect={() => selectedGraphId && props.onDesign?.(selectedGraphId)}>
                Design sub-prompt
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                if (selectedGraphId) pendingAdd.current = { parent: selectedGraphId, child: false };
              }}
            >
              Add section after
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (selectedGraphId) pendingAdd.current = { parent: selectedGraphId, child: true };
              }}
            >
              Add sub-section
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={selected?.position === 1}
              onSelect={() => selectedGraphId && props.onMove(selectedGraphId, 'up')}
            >
              Move section up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={selected?.position === selected?.size}
              onSelect={() => selectedGraphId && props.onMove(selectedGraphId, 'down')}
            >
              Move section down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => selectedGraphId && props.onRemove(selectedGraphId)}>
              Remove section
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        {...tree.getContainerProps('Prompt sections')}
        className="space-y-1 outline-offset-1"
        tabIndex={items.length ? undefined : 0}
        onFocusCapture={() => {
          focusWithin.current = true;
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusWithin.current = false;
        }}
      >
        {items.map((item, index) => {
          const node = item.getItemData().node!;
          return (
            <div
              key={item.getId()}
              {...item.getProps()}
              role="treeitem"
              tabIndex={item.isFocused() ? 0 : -1}
              aria-selected={selected?.node?.id === node.id}
              onFocus={() => item.setFocused()}
              onClick={() => {
                item.setFocused();
                item.primaryAction();
              }}
              className={cn(
                'flex min-w-0 cursor-pointer items-center gap-1 rounded-md py-1.5 pr-2 text-xs outline-offset-1',
                selected?.node?.id === node.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
              style={{ paddingLeft: `calc(var(--spacing) * ${(item.getItemMeta().level + 1) * 3})` }}
            >
              {item.isFolder() ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  tabIndex={-1}
                  aria-label={`${item.isExpanded() ? 'Collapse' : 'Expand'} ${node.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (item.isExpanded()) item.collapse();
                    else item.expand();
                  }}
                >
                  <span aria-hidden="true">{item.isExpanded() ? '▾' : '▸'}</span>
                </Button>
              ) : (
                <span aria-hidden="true" className="w-6 shrink-0 text-center text-muted-foreground">
                  <span className="font-mono text-[11px]">{String(index + 1).padStart(2, '0')}</span>
                </span>
              )}
              <span className="min-w-0 truncate" title={node.title}>
                {node.title}
              </span>
            </div>
          );
        })}
        {!items.length && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No sections. Add a heading in Write to start the outline.
          </p>
        )}
      </div>
      <p className="px-1 pt-3 text-[11px] leading-5 text-muted-foreground">
        Select a section, then use Actions to build its structure.
      </p>
      <Dialog
        open={adding !== null}
        onOpenChange={(open) => {
          if (!open) setAdding(null);
        }}
      >
        <DialogContent className="studio">
          <DialogHeader>
            <DialogTitle>{adding?.child ? 'Add sub-section' : 'Add section'}</DialogTitle>
            <DialogDescription>Name this part of your prompt. You can write its instructions next.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!adding || !/^[a-z][a-z0-9_]*$/i.test(adding.name.trim())) return;
              (adding.child ? props.onAddChild : props.onAddAfter)(adding.parent, adding.name.trim());
              setAdding(null);
            }}
          >
            <label htmlFor="outline-section-name" className="grid gap-2 text-sm">
              Section name
              <Input
                id="outline-section-name"
                value={adding?.name ?? ''}
                onChange={(event) => setAdding((current) => current && { ...current, name: event.target.value })}
                placeholder="research_evidence"
                required
                pattern="[A-Za-z][A-Za-z0-9_]*"
              />
            </label>
            <p className="text-xs text-muted-foreground">Use letters, numbers, and underscores. Start with a letter.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdding(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!adding || !/^[a-z][a-z0-9_]*$/i.test(adding.name.trim())}>
                Add section
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
