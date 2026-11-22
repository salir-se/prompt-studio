/**
 * FragmentNode — a presentational, read-only card rendering one parsed
 * prompt section (`PromptTreeNode` from `@prompt-studio/prompts`).
 *
 * Pure by design: no data fetching, no `useEffect`, no filesystem/network
 * access, and no dependency on the protected-skill-content package — it
 * renders only what its props hand it, so it can never load protected skill
 * content. This is also what makes it dependency-free of any graph-rendering
 * library: a future canvas node wraps this component, but this component
 * itself knows nothing about graphs.
 *
 * Colour vocabulary matches `TOKEN_KIND_CLASSES` in
 * `www/app.salir.se/src/components/prompts/PromptHighlightedEditor.tsx` so
 * the graph studio and the highlighted prompt editor read as one system:
 * variable = violet, tool = sky.
 */

import { type PromptVerificationState, type SectionDelimiterKind, tokenizePromptText } from '@prompt-studio/prompts';
import { Badge } from '@prompt-studio/ui/badge';
import { Button } from '@prompt-studio/ui/button';
import { cn } from '@prompt-studio/ui/utils';
import { useMemo } from 'react';
import { FragmentNodeBody } from './FragmentNodeBody';
import {
  CollapseChevronIcon,
  EditIcon,
  SectionActionBar,
  SectionActionMenu,
  stopPropagationAnd,
} from './FragmentNodeControls';
import {
  type OpenSectionVerification,
  type SectionVerificationCoverage,
  VerificationCoverage,
} from './VerificationCoverage';

export interface FragmentNodeProps {
  /** Section heading/label text, delimiter syntax already stripped. */
  title: string;
  /** Which delimiter dialect produced this section — see `SectionDelimiterKind`. */
  delimiter: SectionDelimiterKind;
  /**
   * Nesting depth, 1-based — real `PromptTreeNode` tree information the
   * caller may display (e.g. as indentation or a badge). Deliberately NOT
   * used to pick the rendered heading tag: this component is a standalone
   * card whose container (a canvas node, a flat list, …) is unknown to it,
   * so conflating tree depth with HTML document structure would emit
   * multiple `<h1>`s (or worse) onto whatever page embeds it. Use
   * `headingLevel` to control the heading tag instead.
   */
  depth: number;
  /** The section's raw body text, rendered verbatim (whitespace preserved). */
  text: string;
  /** `{{variable}}` identifiers referenced within this section's own text. */
  variables: readonly string[];
  /** Known tool names mentioned within this section's own text. */
  toolMentions: readonly string[];
  /** Advisory position of this section in prompt source order. Text accompanies colour for accessibility. */
  promptAnchor?: 'opening' | 'closing' | 'both';
  /** Whether this node is the current selection in a containing graph/list view. */
  selected?: boolean;
  /**
   * Whether this node sits on the ancestor path between the current selection and its root (see
   * `selection-path.ts`'s `selectionPath` and `PromptGraphCanvas`'s left-to-right path-highlight
   * wiring). Renders a SUBTLER ring than `selected`'s `ring-2 ring-ring` — `selected` always wins
   * when both are `true` (the selected node itself never also renders the path ring). Defaults to
   * `false`, so every existing caller is unaffected.
   */
  onPath?: boolean;
  /**
   * Semantic heading level for `title`, independent of `depth`. Defaults to
   * `3` — a safe in-page level that never collides with a host page's own
   * `<h1>`/`<h2>`. Deliberately excludes `1`: this component never owns the
   * top of a document outline.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /**
   * Fix the card at 360x220px for the shared canvas grid, with internally scrolling
   * body/chips. Defaults to fluid sizing; `fillContainer` supports resized nodes.
   */
  fixedSize?: boolean;
  /**
   * Requests that a containing view open an edit affordance for this section. When provided, a
   * small ghost pencil icon button renders in the header row (`aria-label="Edit section"`) that
   * calls this back on click. This component never owns a dialog itself — opening/rendering one is
   * entirely the caller's responsibility (see `PromptGraphCanvasProps.onEditNode`). Omitted (the
   * default) renders no edit affordance at all, so every existing caller is unaffected.
   */
  onEditRequest?: () => void;
  /**
   * When `true`, renders the ONE-LINE collapsed form: header row only (title, delimiter badge, and
   * any header buttons) — the body `<pre>`/rendered-markdown region and the chip area are both
   * omitted entirely, and the card's height becomes `auto` (roughly 2.5rem) instead of its normal
   * fluid/fixed height. Defaults to `false`, which is the card's original always-expanded rendering.
   */
  collapsed?: boolean;
  /**
   * Requests a collapse/expand toggle. When provided, a chevron button renders in the header row
   * (`aria-expanded` reflecting the CURRENT — pre-toggle — `collapsed` state, i.e. `true` while
   * expanded) that calls this back on click; the caller owns the `collapsed` state itself (this
   * component is uncontrolled with respect to persistence — see `PromptGraphCanvas`'s per-node
   * `Map<nodeId, boolean>`). Omitted (the default) renders no toggle button, so `collapsed` can
   * still be read but never interactively changed from within the card.
   */
  onToggleCollapse?: () => void;
  /**
   * Whether the body renders as verbatim raw text (a `<pre>`, the original behaviour) or as
   * rendered Markdown (via `@prompt-studio/help-system`'s `Markdown`). Defaults to `'raw'`. This prop alone
   * controls which one actually renders — `onBodyModeChange` only gates whether the mode-switch UI
   * itself appears (see below), the same "prop drives behaviour, callback-presence drives the
   * affordance" split as `collapsed`/`onToggleCollapse`.
   */
  bodyMode?: FragmentBodyMode;
  /**
   * Requests a raw/rendered body mode change. When provided, a minimal two-state toggle renders
   * (its own row, above the body) so the caller can switch `bodyMode`; omitted (the default)
   * renders no toggle, so a caller that only wants to force one mode can pass `bodyMode` alone.
   */
  onBodyModeChange?: (mode: FragmentBodyMode) => void;
  /**
   * When `true`, the card fills whatever box its container provides (`h-full w-full`) instead of
   * `fixedSize`'s hardcoded 360x220 footprint — the shape a resizable canvas node needs so growing
   * the node (via xyflow's `NodeResizer`) actually reveals more of the body region rather than
   * leaving dead space around a card that stayed pinned at 360x220. Takes precedence over
   * `fixedSize` when both are `true`. Defaults to `false`, preserving `fixedSize`'s and the fluid
   * layout's existing footprints untouched.
   */
  fillContainer?: boolean;
  /** Result border and finding count; configured checks are shown separately in coverage. */
  verification?: { readonly state: PromptVerificationState; readonly findingCount: number };
  coverage?: SectionVerificationCoverage;
  onOpenVerification?: OpenSectionVerification;
  /**
   * Structure actions for this section (ADR-202 §3 — each is implemented by the HOST as a text
   * edit; this card only surfaces the affordances). When provided, a compact icon row renders
   * under the header — ONLY while the card is `selected`, mirroring how the canvas shows resize
   * handles just for the selected node, so an unselected graph stays free of button noise. Each
   * action renders its button only when its own callback is present. Omitted (the default)
   * renders no action row at all, so every existing caller is unaffected.
   */
  sectionActions?: {
    /** Insert a new sibling section after this one. */
    onAddSiblingSection?: () => void;
    /** Insert a new sub-section under this one. */
    onAddChildSection?: () => void;
    /** Remove this section (and its whole subtree). */
    onRemoveSection?: () => void;
    /** Swap this section with its previous sibling. */
    onMoveUp?: () => void;
    /** Swap this section with its next sibling. */
    onMoveDown?: () => void;
  };
}

/** Whether the card body shows the section's raw text verbatim, or that same text rendered as Markdown. */
export type FragmentBodyMode = 'raw' | 'rendered';

const DEFAULT_HEADING_LEVEL = 3;
const DEFAULT_BODY_MODE: FragmentBodyMode = 'raw';

const VARIABLE_CHIP_CLASSES = 'bg-violet-100/70 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300';
const TOOL_CHIP_CLASSES = 'bg-sky-100/70 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300';

const CHIP_BASE_CLASSES = 'inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-xs';

const PROMPT_ANCHOR_LABELS = {
  opening: 'Opening anchor',
  closing: 'Closing anchor',
  both: 'Opening + closing',
} as const;
const PROMPT_ANCHOR_BORDER_CLASSES = {
  opening: 'border-l-4 border-l-violet-500 dark:border-l-violet-400',
  closing: 'border-r-4 border-r-sky-500 dark:border-r-sky-400',
  both: 'border-l-4 border-r-4 border-l-violet-500 border-r-sky-500 dark:border-l-violet-400 dark:border-r-sky-400',
} as const;
const PROMPT_ANCHOR_BADGE_CLASSES = {
  opening: 'border-violet-300 text-violet-800 dark:border-violet-700 dark:text-violet-300',
  closing: 'border-sky-300 text-sky-800 dark:border-sky-700 dark:text-sky-300',
  both: 'border-violet-300 text-violet-800 dark:border-violet-700 dark:text-violet-300',
} as const;
const PROMPT_ANCHOR_TOOLTIP =
  'Long prompts can show positional attention bias toward their opening and closing sections; this is advisory, not guaranteed priority.';

/**
 * Border treatment per verification state (see `FragmentNodeProps.verification`). All colours are
 * paired light/dark (raw Tailwind palette classes with `dark:` variants, the same vocabulary as the
 * variable/tool chips above) or theme-aware shadcn tokens (`destructive`, `muted-foreground`), so
 * every state reads correctly in both themes. `'valid'` maps to `false` on purpose: a valid section
 * keeps the card's default `border-border` untouched. `cn` (tailwind-merge) drops the conflicting
 * `border-border` whenever one of these supplies a border colour.
 */
const VERIFICATION_BORDER_CLASSES: Record<PromptVerificationState, string | false> = {
  valid: false,
  verified: 'border-emerald-600 dark:border-emerald-400',
  warning: 'border-amber-500 dark:border-amber-400',
  invalid: 'border-destructive',
  degraded: 'border-dashed border-muted-foreground/50',
};

/** Finding-count chip colours per verification state — same light/dark pairing discipline as
 *  `VARIABLE_CHIP_CLASSES`/`TOOL_CHIP_CLASSES` so the badge reads as part of the same chip system. */
const VERIFICATION_BADGE_CLASSES: Record<PromptVerificationState, string> = {
  valid: 'bg-muted text-muted-foreground',
  verified: 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  warning: 'bg-amber-100/70 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  invalid: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  degraded: 'bg-muted text-muted-foreground',
};

function ChipList({
  label,
  values,
  chipClassName,
}: {
  label: string;
  values: readonly string[];
  chipClassName: string;
}): React.JSX.Element | null {
  if (values.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <ul className="flex flex-wrap gap-1" aria-label={label}>
        {values.map((value) => (
          <li key={value} className={cn(CHIP_BASE_CLASSES, chipClassName)}>
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FragmentNode({
  title,
  delimiter,
  text,
  variables,
  toolMentions,
  promptAnchor,
  selected = false,
  onPath = false,
  headingLevel = DEFAULT_HEADING_LEVEL,
  fixedSize = false,
  onEditRequest,
  collapsed = false,
  onToggleCollapse,
  bodyMode = DEFAULT_BODY_MODE,
  onBodyModeChange,
  fillContainer = false,
  verification,
  coverage,
  onOpenVerification,
  sectionActions,
}: FragmentNodeProps): React.JSX.Element {
  const HeadingTag = `h${headingLevel}` as `h${2 | 3 | 4 | 5 | 6}`;

  // Raw-body token highlighting — the same variable/tool/tag tinting the app's
  // `PromptHighlightedEditor` (and this package's edit dialog) applies, on the read-only card body.
  // The card's own props are the tokenizer's registries: `variables` are exactly the placeholders
  // this section references (so each renders as a KNOWN variable, violet, never amber) and
  // `toolMentions` are exactly the tool names its text mentions; XML-style tags need no registry
  // (see `tokenizePromptText`'s doc). Memoized: tokenization is pure but per-keystroke cheapness
  // doesn't matter here — this recomputes only when the section text itself changes.
  const bodyTokens = useMemo(
    () => tokenizePromptText(text, { variables, tools: toolMentions }),
    [text, variables, toolMentions],
  );

  // Height/width footprint: `collapsed` always wins (auto height, one line) regardless of
  // fixedSize/fillContainer; otherwise fillContainer (fills its container) beats fixedSize's
  const heightClass = collapsed
    ? fillContainer
      ? 'h-full'
      : 'h-auto min-h-[2.5rem]'
    : fillContainer
      ? 'h-full'
      : fixedSize && 'h-[220px]';
  const widthClass = fillContainer ? 'w-full' : fixedSize ? 'w-[360px]' : 'w-full';
  const clipsOverflow = !collapsed && (fillContainer || fixedSize);

  // Body/chip clamp follows the available node size.
  const bodyClasses = cn(
    'overflow-y-auto rounded-md bg-muted p-2 text-xs',
    fillContainer ? 'min-h-0 flex-1' : fixedSize ? 'max-h-24' : 'max-h-40',
  );

  return (
    <article
      aria-label={verification ? `${title} — verification: ${verification.state}` : title}
      aria-current={selected ? 'true' : undefined}
      data-selected={selected}
      data-on-path={onPath && !selected}
      data-prompt-anchor={promptAnchor}
      data-verification-state={verification?.state}
      data-testid="fragment-node"
      data-collapsed={collapsed}
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-card text-card-foreground',
        collapsed ? 'justify-center px-2 py-1' : 'p-3',
        widthClass,
        heightClass,
        clipsOverflow && 'overflow-hidden',
        // Border ≠ ring: the verification border below and the selection/on-path rings are distinct
        // utilities, so a selected invalid card renders BOTH treatments composed, never one clobbering
        // the other (see the `VerificationSelectedWarning` story).
        verification && VERIFICATION_BORDER_CLASSES[verification.state],
        promptAnchor && PROMPT_ANCHOR_BORDER_CLASSES[promptAnchor],
        selected ? 'ring-2 ring-ring' : onPath && 'ring-1 ring-ring/50',
      )}
    >
      <div
        data-prompt-drag-handle
        className="flex shrink-0 cursor-grab items-center justify-between gap-2 active:cursor-grabbing"
      >
        <div
          className="min-w-0"
          title={`${title} · ${delimiter}${promptAnchor ? ` · ${PROMPT_ANCHOR_LABELS[promptAnchor]}` : ''}`}
        >
          <HeadingTag className="truncate text-sm font-semibold">{title}</HeadingTag>
          {promptAnchor && (
            <Badge
              variant="outline"
              className={cn(collapsed ? 'sr-only' : 'mt-1 text-[10px]', PROMPT_ANCHOR_BADGE_CLASSES[promptAnchor])}
              title={PROMPT_ANCHOR_TOOLTIP}
            >
              {PROMPT_ANCHOR_LABELS[promptAnchor]}
            </Badge>
          )}
        </div>
        <div className="nodrag nopan nokey flex shrink-0 cursor-default items-center gap-1">
          {collapsed && coverage && (
            <VerificationCoverage title={title} coverage={coverage} onOpen={onOpenVerification} compact />
          )}
          {verification && verification.findingCount > 0 && (
            <span
              className={cn(CHIP_BASE_CLASSES, VERIFICATION_BADGE_CLASSES[verification.state])}
              title={`Verification state: ${verification.state}`}
              data-testid="fragment-node-finding-count"
            >
              {verification.findingCount}{' '}
              <span className={collapsed ? 'sr-only' : undefined}>
                {verification.findingCount === 1 ? 'finding' : 'findings'}
              </span>
            </span>
          )}
          <Badge variant="outline" className={collapsed ? 'sr-only' : 'shrink-0 font-mono'}>
            {delimiter}
          </Badge>
          {onEditRequest && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Edit section"
              title="Edit section"
              onClick={stopPropagationAnd(onEditRequest)}
            >
              <EditIcon className="size-3.5" />
            </Button>
          )}
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={collapsed ? 'Expand section' : 'Collapse section'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand section' : 'Collapse section'}
              onClick={stopPropagationAnd(onToggleCollapse)}
            >
              <CollapseChevronIcon expanded={!collapsed} className="size-3.5" />
            </Button>
          )}
          {collapsed && selected && sectionActions && <SectionActionMenu actions={sectionActions} />}
        </div>
      </div>
      {!collapsed && coverage && <VerificationCoverage title={title} coverage={coverage} onOpen={onOpenVerification} />}
      {!collapsed && selected && sectionActions && <SectionActionBar actions={sectionActions} />}
      {!collapsed && (
        <>
          {onBodyModeChange && (
            <fieldset className="nodrag nopan nokey m-0 flex shrink-0 items-center gap-1 border-0 p-0 text-xs">
              <legend className="sr-only">Body display mode</legend>
              <button
                type="button"
                aria-pressed={bodyMode === 'raw'}
                onClick={stopPropagationAnd(() => onBodyModeChange('raw'))}
                className={cn(
                  'rounded-sm px-1.5 py-0.5',
                  bodyMode === 'raw' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Raw
              </button>
              <button
                type="button"
                aria-pressed={bodyMode === 'rendered'}
                onClick={stopPropagationAnd(() => onBodyModeChange('rendered'))}
                className={cn(
                  'rounded-sm px-1.5 py-0.5',
                  bodyMode === 'rendered' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Rendered
              </button>
            </fieldset>
          )}
          <FragmentNodeBody title={title} text={text} mode={bodyMode} tokens={bodyTokens} className={bodyClasses} />
          {(variables.length > 0 || toolMentions.length > 0) && (
            <div
              className={cn(
                'flex flex-col gap-1.5',
                fillContainer && 'shrink-0',
                fixedSize && 'max-h-16 overflow-y-auto',
              )}
            >
              <ChipList label="Variables" values={variables} chipClassName={VARIABLE_CHIP_CLASSES} />
              <ChipList label="Tools" values={toolMentions} chipClassName={TOOL_CHIP_CLASSES} />
            </div>
          )}
        </>
      )}
    </article>
  );
}
