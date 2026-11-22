/**
 * LabelChip — a PURE presentational component for the small labelled chip
 * `PromptGraphCanvas` uses to render `root`/`variable`/`tool` graph nodes.
 *
 * Extracted from `PromptGraphCanvas`'s `LabelFlowNodeComponent` so the label
 * visual is storyable and testable on its own, the same way `FragmentNode`
 * already is for `'section'` nodes — see that component's module doc for why
 * "pure, props-only, no graph-library import" is load-bearing here too. This
 * component knows nothing about xyflow; the canvas wraps it with `Handle`s.
 *
 * Colour vocabulary matches `FragmentNode`'s chips and
 * `TOKEN_KIND_CLASSES` in `PromptHighlightedEditor.tsx`: variable = violet,
 * tool = sky, root = neutral card colours.
 */

import { cn } from '@prompt-studio/ui/utils';

export interface LabelChipProps {
  /** Which graph-node kind this chip represents — drives the tint and `data-kind` hook. */
  kind: 'root' | 'variable' | 'tool' | 'file';
  /** The node's label text (e.g. a variable/tool name, or the prompt's root key). */
  label: string;
  /** Whether this chip is the current selection in a containing graph/list view. */
  selected?: boolean;
  /**
   * Whether this chip sits on the ancestor path between the current selection and its root (see
   * `selection-path.ts`'s `selectionPath` and `PromptGraphCanvas`'s left-to-right path-highlight
   * wiring). Renders a SUBTLER ring than `selected`'s `ring-2 ring-ring` — `selected` always wins
   * when both are `true`. Defaults to `false`, so every existing caller is unaffected.
   */
  onPath?: boolean;
}

const LABEL_CHIP_KIND_CLASSES: Record<LabelChipProps['kind'], string> = {
  file: 'border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  root: 'border-border bg-card text-card-foreground',
  variable:
    'border-violet-300 bg-violet-100/70 text-violet-800 dark:border-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
  tool: 'border-sky-300 bg-sky-100/70 text-sky-800 dark:border-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
};

/** Fixed compact footprint for root/variable/tool label chips — consistent with the shared column `layout.ts`
 *  assigns them, so a long label never grows wide/tall enough to sit under an adjacent card. */
const LABEL_CHIP_CLASSES = 'flex h-9 w-[200px] items-center justify-center px-3 py-1.5 text-center';

export function LabelChip({ kind, label, selected = false, onPath = false }: LabelChipProps): React.JSX.Element {
  return (
    <div
      data-testid="label-chip"
      data-kind={kind}
      title={kind === 'file' ? `File: ${label}` : label}
      data-selected={selected}
      data-on-path={onPath && !selected}
      className={cn(
        LABEL_CHIP_CLASSES,
        'rounded-md border text-xs font-medium',
        LABEL_CHIP_KIND_CLASSES[kind],
        selected ? 'ring-2 ring-ring' : onPath && 'ring-1 ring-ring/50',
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}
