import type {
  PromptGraphModel,
  PromptGraphNode,
  PromptGraphNodeKind,
  PromptVerificationState,
  SectionDelimiterKind,
} from '@prompt-studio/prompts';
import { type Edge, Handle, type Node, type NodeProps, NodeResizer, type NodeTypes, Position } from '@xyflow/react';
import { FragmentNode, type FragmentNodeProps } from './FragmentNode';
import { LabelChip } from './LabelChip';
import type { OpenSectionVerification, SectionVerificationCoverage } from './VerificationCoverage';
import { CONNECTION_SIDES } from './facing-handles';
import { LABEL_NODE_WIDTH, LAYOUT_COLLAPSED_CARD_HEIGHT, SECTION_NODE_WIDTH } from './layout';

// ── xyflow node data shapes ──────────────────────────────────────────────────

interface SectionNodeData extends Record<string, unknown> {
  title: string;
  delimiter: SectionDelimiterKind;
  depth: number;
  text: string;
  variables: string[];
  toolMentions: string[];
  promptAnchor: FragmentNodeProps['promptAnchor'];
  selected: boolean;
  /**
   * Whether this section sits on the ancestor path between the current selection and its root —
   * see `selectionPath`'s doc and `PromptGraphCanvas`'s `selectionHighlight` memo below. Never
   * `true` for the selected node itself (it keeps its own stronger `selected` ring instead).
   */
  onPath: boolean;
  /** Canvas-owned per-node collapse state — see `PromptGraphCanvas`'s `collapsedByNodeId` map. */
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Only set when the host passed `onEditNode` — `FragmentNode` renders no edit button otherwise. */
  onEditRequest: (() => void) | undefined;
  /** This node's entry in the host's `verificationByNodeId` record — `undefined` when absent, which
   *  renders no verification treatment at all (see `PromptGraphCanvasProps.verificationByNodeId`). */
  verification: { state: PromptVerificationState; findingCount: number } | undefined;
  /** Per-node bound structure actions — see `PromptGraphCanvasProps.onAddSiblingSection` etc.;
   *  `undefined` when the host provided none, which renders no action row. */
  sectionActions: FragmentNodeProps['sectionActions'];
  coverage: SectionVerificationCoverage | undefined;
  onOpenVerification: OpenSectionVerification | undefined;
}

interface LabelNodeData extends Record<string, unknown> {
  kind: Exclude<PromptGraphNodeKind, 'section'>;
  label: string;
  selected: boolean;
  /** See `SectionNodeData.onPath`'s doc — the same ancestor-path highlight, applied to root/variable/tool chips. */
  onPath: boolean;
}

type SectionFlowNode = Node<SectionNodeData, 'section'>;
type LabelFlowNode = Node<LabelNodeData, 'label'>;
export type PromptFlowNode = SectionFlowNode | LabelFlowNode;

/** Four unobtrusive native anchors; connections remain non-interactive. */
const HANDLE_CLASSES = '!h-1.5 !w-1.5 !min-w-0 !border-none !bg-muted-foreground/50';
const HANDLE_POSITIONS = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom };

function ConnectionHandles() {
  return CONNECTION_SIDES.flatMap((side) =>
    (['source', 'target'] as const).map((type) => (
      <Handle
        key={`${type}-${side}`}
        id={`${type}-${side}`}
        type={type}
        position={HANDLE_POSITIONS[side]}
        isConnectable={false}
        className={HANDLE_CLASSES}
      />
    )),
  );
}

/**
 * Minimum (and initial) section-node footprint, matching `FragmentNode`'s original `fixedSize`
 * 360x220 so a freshly-laid-out, never-resized node renders identically to before this file added
 * resizing. Passed as the node's INITIAL `width`/`height` in `toFlowNode` (giving `NodeResizer`
 * something concrete to grow from, and giving the `fillContainer` card below a real ancestor size
 * to fill instead of an auto-height 0px box) and as `NodeResizer`'s `minWidth`/`minHeight` floor.
 */
const SECTION_NODE_MIN_WIDTH = SECTION_NODE_WIDTH;
const SECTION_NODE_MIN_HEIGHT = 220;

/**
 * Fixed footprint of a `'label'` node (`LabelChip`'s own `h-9 w-[200px]` classes — 36x200px). Passed
 * as the node's `width`/`height` in `toFlowNode`, mirroring `SECTION_NODE_MIN_WIDTH`/`_HEIGHT` above:
 * xyflow needs SOME explicit initial size for a node before its own `ResizeObserver` measurement
 * completes, or the node (and any edge touching it — every `'contains'`/`'declares'` edge on a
 * root/variable/tool node) renders `visibility: hidden` until that measurement resolves. A `LabelChip`
 * never actually resizes, so declaring its known-fixed size upfront is strictly more correct than
 * leaving it to resolve asynchronously.
 */
const LABEL_NODE_HEIGHT = 36;

function SectionFlowNodeComponent({ data, selected }: NodeProps<SectionFlowNode>): React.JSX.Element {
  return (
    <>
      {/* xyflow convention: only show resize handles for the currently-selected node (built-in
          per-node `selected`, not this canvas's own `selectedNodeId`-driven `data.selected`) — a
          resizer on every node at once would be visual noise. Hidden while collapsed too: a
          collapsed card renders auto-height (ignoring its container), so resize handles would drag
          a box the card doesn't follow. Raising the resized/selected node's
          z-index above its siblings (so the resize handles and an enlarged card aren't clipped by
          neighbouring nodes) needs no extra code here: xyflow's `elevateNodesOnSelect` is `true` by
          default and this canvas never overrides it. */}
      <NodeResizer
        color="var(--foreground)"
        minWidth={SECTION_NODE_MIN_WIDTH}
        minHeight={SECTION_NODE_MIN_HEIGHT}
        isVisible={selected && !data.collapsed}
      />
      <ConnectionHandles />
      <FragmentNode
        title={data.title}
        delimiter={data.delimiter}
        depth={data.depth}
        text={data.text}
        variables={data.variables}
        toolMentions={data.toolMentions}
        promptAnchor={data.promptAnchor}
        selected={data.selected}
        onPath={data.onPath}
        fillContainer
        collapsed={data.collapsed}
        onToggleCollapse={data.onToggleCollapse}
        onEditRequest={data.onEditRequest}
        verification={data.verification}
        coverage={data.coverage}
        onOpenVerification={data.onOpenVerification}
        sectionActions={data.sectionActions}
      />
    </>
  );
}

function LabelFlowNodeComponent({ data }: NodeProps<LabelFlowNode>): React.JSX.Element {
  return (
    <>
      <ConnectionHandles />
      <LabelChip kind={data.kind} label={data.label} selected={data.selected} onPath={data.onPath} />
    </>
  );
}

export const NODE_TYPES: NodeTypes = {
  section: SectionFlowNodeComponent,
  label: LabelFlowNodeComponent,
};

/** Converts one `PromptGraphNode` into its xyflow `Node`, at the position `layoutGraph` computed for it. */
export function toFlowNode(
  node: PromptGraphNode,
  position: { x: number; y: number },
  selectedNodeId: string | undefined,
  onPathNodeIds: ReadonlySet<string>,
  promptAnchor: FragmentNodeProps['promptAnchor'],
  collapsedByNodeId: ReadonlyMap<string, boolean>,
  onToggleCollapse: (nodeId: string) => void,
  onEditNode: ((nodeId: string) => void) | undefined,
  verificationByNodeId: Readonly<Record<string, { state: PromptVerificationState; findingCount: number }>> | undefined,
  sectionActionsFor: (nodeId: string) => FragmentNodeProps['sectionActions'],
  coverageByNodeId?: Readonly<Record<string, SectionVerificationCoverage>>,
  onOpenVerification?: OpenSectionVerification,
): PromptFlowNode {
  const selected = node.id === selectedNodeId;
  // Excludes the selected node itself — see `SectionNodeData.onPath`'s doc: the selection keeps its
  // own stronger ring rather than also rendering the subtler path ring.
  const onPath = !selected && onPathNodeIds.has(node.id);

  if (node.data.kind === 'section') {
    const section = node.data.node;
    const collapsed = collapsedByNodeId.get(node.id) ?? false;
    const sectionData: SectionNodeData = {
      title: section.title,
      delimiter: section.delimiter,
      depth: section.depth,
      text: section.text,
      variables: section.variables,
      toolMentions: section.toolMentions,
      promptAnchor,
      selected,
      onPath,
      collapsed,
      onToggleCollapse: () => onToggleCollapse(node.id),
      onEditRequest: onEditNode ? () => onEditNode(node.id) : undefined,
      verification: verificationByNodeId?.[node.id],
      coverage: coverageByNodeId?.[node.id],
      onOpenVerification,
      sectionActions: sectionActionsFor(node.id),
    };
    return {
      id: node.id,
      type: 'section',
      selected,
      position,
      data: sectionData,
      dragHandle: '[data-prompt-drag-handle]',
      connectable: false,
      width: SECTION_NODE_MIN_WIDTH,
      // Collapsed cards get a matching collapsed box — see `LAYOUT_COLLAPSED_CARD_HEIGHT`'s doc.
      height: collapsed ? LAYOUT_COLLAPSED_CARD_HEIGHT : SECTION_NODE_MIN_HEIGHT,
    };
  }

  const labelData: LabelNodeData = {
    kind: node.data.kind,
    label: node.label,
    selected,
    onPath,
  };
  return {
    id: node.id,
    type: 'label',
    selected,
    position,
    data: labelData,
    connectable: false,
    ariaLabel: `${node.kind}: ${node.label}`,
    width: LABEL_NODE_WIDTH,
    height: LABEL_NODE_HEIGHT,
  };
}

/**
 * Visible stroke for every edge, against the dotted `<Background>` — xyflow's
 * unstyled default edge stroke reads as invisible next to overlapping cards
 * (the defect this module fixes), so every edge gets an explicit, theme-aware
 * colour via the same `--muted-foreground` CSS custom property `@prompt-studio/ui`
 * wires into the `muted-foreground` Tailwind token (see the host app's
 * `index.css`), rather than a hardcoded hex that would not track light/dark.
 */
const EDGE_STROKE_STYLE: React.CSSProperties = { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 };

/**
 * Ancestor-path highlight (left-to-right selection readout) — see `selection-path.ts`'s
 * `selectionPath` and this canvas's `selectionHighlight` memo below.
 *
 * An edge on the path from the current selection to its root renders with the same `--primary`
 * token `@prompt-studio/ui` uses elsewhere for emphasis (not a hardcoded hex, so it tracks light/dark like
 * `EDGE_STROKE_STYLE` above), at a heavier `strokeWidth` and full opacity so the path reads as one
 * continuous, unmistakable line against the rest of the graph. Raised `zIndex` (set on the `Edge`
 * object itself in `toFlowEdge`, not here) keeps it drawn above any overlapping non-path edge.
 */
const EDGE_ON_PATH_STROKE_STYLE: React.CSSProperties = { stroke: 'var(--primary)', strokeWidth: 2.5, opacity: 1 };

/** `zIndex` for an on-path edge — just above the implicit default (`0`) every other edge/`Edge.zIndex`-less
 *  edge renders at, so the highlighted path draws on top of any edge it happens to cross or overlap. */
const EDGE_ON_PATH_Z_INDEX = 1;

/**
 * Opacity applied to every edge NOT on the current selection's path, but ONLY once a selection
 * exists (`selectedNodeId !== undefined` — see `toFlowEdge`'s `hasSelection` param). Dimming the
 * rest of the graph is what makes the on-path edges above read as a path "at a glance" rather than
 * just one more highlighted edge among equals. No selection at all → every edge renders at its
 * normal, undimmed opacity exactly as before this feature (see `toFlowEdge`'s early return).
 */
const EDGE_NON_PATH_OPACITY = 0.35;

/**
 * Edge label styling — the model's `PromptGraphEdge.label` (WHY the edge exists: a `{{variable}}`
 * name or a bare tool name, see `@prompt-studio/prompts`'s doc on the field) is rendered by xyflow as an SVG
 * `<text>`/background `<rect>` pair positioned at the edge midpoint. Both use the same token-based
 * approach as `EDGE_STROKE_STYLE`/`CONTROLS_THEME_STYLE` above — CSS custom properties, not a
 * hardcoded hex — so the label stays legible against the dotted `<Background>` in both themes:
 * `labelStyle` sets a small, low-emphasis fill (`--muted-foreground`, matching the edge stroke
 * itself) so the label reads as an annotation rather than competing with node text; `labelBgStyle`
 * paints a `--card`-coloured backing rect (with the default `labelBgPadding`) so the label stays
 * readable over an edge line or an overlapping node rather than blending into the canvas.
 */
const EDGE_LABEL_STYLE: React.CSSProperties = { fill: 'var(--muted-foreground)', fontSize: 10 };
const EDGE_LABEL_BG_STYLE: React.CSSProperties = { fill: 'var(--card)', fillOpacity: 0.9 };

/**
 * Bulk collapse/expand-all icons for the two `<ControlButton>`s appended to `<Controls>` below.
 * Drawn as plain filled polygons (no curves) rather than lucide-style strokes, matching how xyflow's
 * OWN built-in glyphs (`PlusIcon`/`MinusIcon`/`FitViewIcon` in `@xyflow/react`'s bundled source) are
 * simple solid `<path>`/shape fills, not strokes: `fill="currentColor"` on the root `<svg>` is what
 * lets both glyphs pick up the exact same `--xy-controls-button-color(-hover)` custom properties
 * `CONTROLS_THEME_STYLE` below already maps to `@prompt-studio/ui` tokens, so they render correctly in both
 * themes with zero extra theming code — the same reason xyflow's own buttons need none.
 */
export function ChevronsUpIcon(): React.JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="4,20 12,13 20,20 20,17 12,10 4,17" />
      <polygon points="4,12 12,5 20,12 20,9 12,2 4,9" />
    </svg>
  );
}

export function ArrangeIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="9" width="6" height="6" rx="1" />
      <path d="M8 12h4M12 5v14M12 5h4M12 19h4" />
      <rect x="16" y="2" width="6" height="6" rx="1" />
      <rect x="16" y="16" width="6" height="6" rx="1" />
    </svg>
  );
}

export function ChevronsDownIcon(): React.JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="4,4 12,11 20,4 20,7 12,14 4,7" />
      <polygon points="4,12 12,19 20,12 20,15 12,22 4,15" />
    </svg>
  );
}

/**
 * DARK-THEME `<Controls>` FIX — diagnosis below is from reading xyflow's actual shipped CSS/JS in
 * `node_modules/@xyflow/react/dist/{style.css,esm/index.mjs}`, not a repeat guess.
 *
 * ROOT CAUSE: every `.react-flow__controls-button` colour in xyflow's own `dist/style.css` reads
 * `var(--xy-controls-button-*, var(--xy-controls-button-*-default))` — e.g.
 * `background: var(--xy-controls-button-background-color, var(--xy-controls-button-background-color-default))`.
 * The `-default` fallbacks are declared twice: LIGHT values under plain `.react-flow`, and DARK
 * values under `.react-flow.dark` — a COMPOUND selector, meaning class `dark` must sit on the very
 * same element as class `react-flow` (that's what `<ReactFlow colorMode="dark">` would add). This
 * canvas never sets `colorMode`, so xyflow's dark fallback never activates — the LIGHT default
 * (`#fefefe` bg) wins no matter what ANCESTOR element (the app's `<html class="dark">`, Storybook's
 * theme wrapper) carries `.dark`; `.react-flow.dark` doesn't match through a `.dark` ancestor at all.
 *
 * The previous attempt overrode this via `<Controls className="[&>button]:!bg-card …">`. Tracing
 * `ControlsComponent`/`Panel` in xyflow's bundled source confirms the buttons ARE literal direct
 * children of the one element that prop lands on (no intermediate wrapper), so `[&>button]` isn't
 * broken by nesting today — but an `!important` fight that only works by assuming a vendored
 * component's CURRENT internal DOM shape is fragile by construction (a future xyflow patch adding
 * one wrapper span re-breaks it silently, with no compile-time signal), and it re-hardcodes
 * `.react-flow__controls-button`, an implementation detail this package doesn't own.
 *
 * FIX: xyflow ships a purpose-built, versioned extension point for exactly this — the
 * `--xy-controls-*` CSS CUSTOM PROPERTIES its own stylesheet already prefers over the `-default`
 * fallback. Setting them on an ANCESTOR needs no importance fight at all (a custom property set
 * anywhere in the inheritance chain simply IS the value `var()` resolves to); mapping them 1:1 to
 * the same `@prompt-studio/ui` tokens `FragmentNode` already uses (`--card`, `--card-foreground`, `--muted`,
 * `--border`) keeps this token-based and correct in both themes without touching xyflow's markup.
 */
export const CONTROLS_THEME_STYLE = {
  '--xy-controls-button-background-color': 'var(--card)',
  '--xy-controls-button-background-color-hover': 'var(--muted)',
  '--xy-controls-button-color': 'var(--card-foreground)',
  '--xy-controls-button-color-hover': 'var(--card-foreground)',
  '--xy-controls-button-border-color': 'var(--border)',
} as React.CSSProperties;

/**
 * Converts one `PromptGraphModel` edge into its xyflow `Edge`, applying the ancestor-path highlight
 * (see `EDGE_ON_PATH_STROKE_STYLE`/`EDGE_NON_PATH_OPACITY`'s docs above) on top of the base
 * stroke/dash styling every edge already had.
 *
 * `isOnPath`/`hasSelection` are look-ups the caller (`PromptGraphCanvas`) already computed once from
 * its `selectionHighlight` memo, not recomputed per edge here — see that memo's doc.
 */
export function toFlowEdge(edge: PromptGraphModel['edges'][number], isOnPath: boolean, hasSelection: boolean): Edge {
  const dashedIfDeclares: React.CSSProperties = edge.kind !== 'contains' ? { strokeDasharray: '4 4' } : {};

  // No selection at all → every edge renders exactly as it did before this feature (this canvas's
  // original, un-highlighted behaviour) — neither branch below ever applies.
  const style = !hasSelection
    ? { ...EDGE_STROKE_STYLE, ...dashedIfDeclares }
    : isOnPath
      ? { ...EDGE_ON_PATH_STROKE_STYLE, ...dashedIfDeclares }
      : { ...EDGE_STROKE_STYLE, ...dashedIfDeclares, opacity: EDGE_NON_PATH_OPACITY };

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    style,
    zIndex: hasSelection && isOnPath ? EDGE_ON_PATH_Z_INDEX : undefined,
    // Only `'declares'` edges carry a model `label` (see `PromptGraphEdge.label`'s doc) — a
    // `'contains'` edge's `label` is always `undefined`, and xyflow renders no label element at all
    // when `label` is undefined, so `'contains'` edges are unaffected by these two style props.
    type: edge.label ? 'labelled' : undefined,
    ariaLabel: edge.label ? `${edge.kind}: ${edge.label}` : undefined,
    label: edge.label,
    labelStyle: EDGE_LABEL_STYLE,
    labelBgStyle: EDGE_LABEL_BG_STYLE,
  };
}
