import {
  Background,
  ControlButton,
  Controls,
  type Edge,
  type NodeMouseHandler,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
/**
 * PromptGraphCanvas — renders a source-owned `PromptGraphModel` (ADR-200).
 *
 * The canvas and its flow adapter own `@xyflow/react` imports;
 * that isolation is deliberate (see `@prompt-studio/prompts/src/tree/types.ts`'s
 * module doc on why the graph projection itself must stay framework-free).
 * Never import `@xyflow/react` from outside this package.
 *
 * Automatic layout and manual positions belong to this view. No data
 * fetching, no filesystem access, and no import of
 * `@prompt-studio/skills`, so this component can never load protected skill content.
 *
 * `'section'` nodes render the existing `FragmentNode` leaf, passed
 * title/delimiter/depth/text/variables/toolMentions straight from the
 * node's `PromptTreeNode` payload. `'root'`/`'variable'`/`'tool'` nodes render
 * the `LabelChip` leaf instead, using the same kind-based colour vocabulary as
 * `FragmentNode`'s chips (variable = violet, tool = sky) so the canvas reads
 * as one system.
 *
 * Dragging arranges the current view; explicit host actions own source edits.
 * Connections remain non-interactive.
 *
 * Section headers drag; selected expanded sections retain resize handles.
 * Fixed node footprints feed automatic layout and label clearance. An empty
 * model renders a centered message rather than a bare pane.
 */
import type { OpenSectionVerification, SectionVerificationCoverage } from './VerificationCoverage';
import {
  ArrangeIcon,
  ChevronsDownIcon,
  ChevronsUpIcon,
  CONTROLS_THEME_STYLE,
  NODE_TYPES,
  type PromptFlowNode,
  toFlowEdge,
  toFlowNode,
} from './flow-adapter';
import '@xyflow/react/dist/style.css';
import type { PromptGraphModel, PromptVerificationState } from '@prompt-studio/prompts';
import type { FragmentNodeProps } from './FragmentNode';
import { LabelledEdge } from './LabelledEdge';
import { closestFacingHandles } from './facing-handles';
import { layoutGraph, referenceLabelCenter } from './layout';
import { selectionPath } from './selection-path';
import { useCanvasLayout } from './use-canvas-layout';

const EDGE_TYPES = { labelled: LabelledEdge };

export interface PromptGraphCanvasProps {
  model: PromptGraphModel;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  /**
   * Requests that a host open an edit affordance for a section node. Wired straight from
   * `FragmentNode`'s `onEditRequest` (via the `'section'` node type below) through to this prop with
   * the node's id — this canvas never owns a dialog itself (see `FragmentNode`'s doc comment).
   * Omitted (the default) renders no edit button on any card, so every existing caller is unaffected.
   */
  onEditNode?: (nodeId: string) => void;
  /**
   * Per-node verification readout (ADR-202 Stage D), keyed by graph node id — the studio computes
   * `{ state, findingCount }` per node and this canvas forwards each entry straight into that node's
   * `FragmentNode` `verification` prop (border treatment + finding-count chip; see that prop's doc).
   * A node id absent from the record gets NO `verification` prop at all — same "absent means
   * untouched" contract as `collapsedByNodeId`. Section nodes only: `'root'`/`'variable'`/`'tool'`
   * label chips are not sections and never receive an entry's treatment, even if one is keyed by
   * their id. Omitted (the default) renders no verification treatment on any card.
   */
  verificationByNodeId?: Readonly<Record<string, { state: PromptVerificationState; findingCount: number }>>;
  coverageByNodeId?: Readonly<Record<string, SectionVerificationCoverage>>;
  onOpenVerification?: OpenSectionVerification;
  /**
   * Structure-action requests (ADR-202 §3: the HOST implements each as a text edit and re-parses;
   * this canvas only forwards them into the selected section card's action row — see
   * `FragmentNodeProps.sectionActions`). Each is optional and independently gates its own button.
   * All receive the SECTION graph node id (`section:<treeNodeId>`).
   */
  onAddSiblingSection?: (nodeId: string) => void;
  onAddChildSection?: (nodeId: string) => void;
  onRemoveSection?: (nodeId: string) => void;
  onMoveSection?: (nodeId: string, direction: 'up' | 'down') => void;
}

/**
 * INITIAL-VIEWPORT CROP FIX — screenshot-verified defect: on a tall graph (many stacked section
 * rows — see `layout.ts`'s `LAYOUT_ROW_HEIGHT` column stacking), the first `fitView` render cropped
 * the top card row, which sat half above the visible frame.
 *
 * ROOT CAUSE, traced through xyflow's actual shipped source (`@xyflow/system`'s
 * `fitViewport`/`getViewportForBounds` in `dist/esm/index.mjs`), not a repeat guess: `<ReactFlow>`'s
 * own `minZoom` prop DEFAULTS TO `0.5` when unset, and `fitViewport` clamps the zoom it computes to
 * fit the graph's full bounding box into `clamp(requiredZoom, minZoom, maxZoom)` — it does NOT let
 * the fit zoom out below that floor. Measured directly against the real `RealScoutPrompt` model
 * (`PromptGraphCanvas.stories.tsx`), the laid-out bounding box is ~1460x2116px; fitting that into a
 * typical ~700-900px-tall canvas requires a zoom of roughly 0.26-0.34 — well BELOW the default 0.5
 * floor. `getViewportForBounds` clamps the zoom UP to 0.5 (more zoomed-in than the content actually
 * needs) and then centers the viewport on the bounding box's center at that clamped zoom, so both the
 * top and bottom edges of the now-too-large content overflow the frame equally — the crop is a direct
 * consequence of the clamp, not a centering bug.
 *
 * FIX: lower the canvas's own `minZoom` floor (below, `CANVAS_MIN_ZOOM`) far enough that even a much
 * taller future prompt still computes a fit zoom above the floor, so `fitView` is never forced to
 * clamp up. This is a single `<ReactFlow minZoom>` change (not a `fitViewOptions.minZoom` override)
 * so the INTERACTIVE zoom-out floor a user can reach by scrolling/pinching stays consistent with the
 * initial fitted zoom — overriding only `fitViewOptions.minZoom` would leave the interactive floor at
 * 0.5, which sits ABOVE the fitted zoom and would snap-correct jarringly on the user's very first
 * zoom gesture (`@xyflow/system`'s scale-extent clamp applies to the resulting zoom regardless of the
 * current value, not just to the requested delta).
 *
 * `fitViewOptions.padding` is passed explicitly (rather than left to xyflow's own `0.1` default) so
 * the fixed floor above has a LITTLE extra breathing room on every edge, not just enough to exactly
 * touch the frame.
 */
const CANVAS_MIN_ZOOM = 0.05;
const CANVAS_MAX_ZOOM = 2;
const FIT_VIEW_OPTIONS = { padding: 0.15 } as const;

export function PromptGraphCanvas(props: PromptGraphCanvasProps): React.JSX.Element {
  const {
    model,
    selectedNodeId,
    onSelectNode,
    onEditNode,
    verificationByNodeId,
    coverageByNodeId,
    onOpenVerification,
    onAddSiblingSection,
    onAddChildSection,
    onRemoveSection,
    onMoveSection,
  } = props;
  const controlledSelection = Object.hasOwn(props, 'selectedNodeId');
  // Ancestor-path highlight (left-to-right selection readout): `selectionPath` (pure, no React/xyflow
  // — see its own module doc) walks `selectedNodeId`'s ancestry back to the root(s) it descends from.
  // Recomputed only when `model`/`selectedNodeId` actually change, then consulted below by both the
  // `nodes` memo (`onPath` per node, `toFlowNode`) and the `edges` memo (`toFlowEdge`) so neither
  // recomputes the walk itself. `selectedNodeId === undefined` yields empty sets (`selectionPath`'s
  // own contract), which both memos already treat as "no highlight at all" — the same as before this
  // feature existed.
  const container = useRef<HTMLDivElement>(null);
  const flow = useRef<ReactFlowInstance<PromptFlowNode> | null>(null);
  const [edgeLabelWidths, setEdgeLabelWidths] = useState<ReadonlyMap<string, number>>(new Map());
  const onLabelWidth = useCallback((id: string, width: number) => {
    setEdgeLabelWidths((previous) => (previous.get(id) === width ? previous : new Map(previous).set(id, width)));
  }, []);
  const [resizedNodes, setResizedNodes] = useState<ReadonlyMap<string, { width: number; height: number }>>(new Map());
  const nodeMeasurements = useMemo(
    () => ({
      nodeWidths: new Map([...resizedNodes].map(([id, size]) => [id, size.width])),
      nodeHeights: new Map([...resizedNodes].map(([id, size]) => [id, size.height])),
    }),
    [resizedNodes],
  );
  const hasNodes = model.nodes.length > 0;
  useEffect(() => {
    if (!hasNodes || !container.current) return;
    // A host inspector can shrink the canvas after its initial fit.
    const resize = new ResizeObserver(() => {
      void flow.current?.fitView(FIT_VIEW_OPTIONS);
    });
    resize.observe(container.current);
    return () => resize.disconnect();
  }, [hasNodes]);
  const selectionHighlight = useMemo(() => selectionPath(model, selectedNodeId), [model, selectedNodeId]);

  // Collapse changes automatic spacing and the bounds used by native edge handles.
  // Bulk actions replace the map, so later per-card toggles always flip the current state.
  const [collapsedByNodeId, setCollapsedByNodeId] = useState<Map<string, boolean>>(new Map());

  const handleToggleCollapse = useCallback((nodeId: string) => {
    setCollapsedByNodeId((prev) => {
      const next = new Map(prev);
      next.set(nodeId, !(prev.get(nodeId) ?? false));
      return next;
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    const sectionNodeIds = model.nodes.filter((node) => node.kind === 'section').map((node) => node.id);
    setCollapsedByNodeId(new Map(sectionNodeIds.map((nodeId) => [nodeId, true])));
  }, [model]);

  const handleExpandAll = useCallback(() => {
    setCollapsedByNodeId(new Map());
  }, []);

  // The collapsed set `layoutGraph` compacts around (see its `collapsedNodeIds` doc). Derived as its
  // own memo (ids whose map entry is `true`, not just present — a chevron toggled twice leaves a
  // `false` entry behind) so `positions` only recomputes when collapse state actually changes.
  const collapsedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [nodeId, collapsed] of collapsedByNodeId) {
      if (collapsed) {
        ids.add(nodeId);
      }
    }
    return ids;
  }, [collapsedByNodeId]);

  const automaticPositions = useMemo(
    () => layoutGraph(model, collapsedNodeIds, { ...nodeMeasurements, edgeLabelWidths }),
    [model, collapsedNodeIds, nodeMeasurements, edgeLabelWidths],
  );
  const layout = useCanvasLayout(model, automaticPositions);
  const positions = layout.positions;
  const labelX = referenceLabelCenter(model, automaticPositions, nodeMeasurements.nodeWidths);

  const sectionAnchorById = useMemo(() => {
    const ids = model.nodes.filter((node) => node.kind === 'section').map((node) => node.id);
    if (ids.length === 1 && ids[0]) return new Map([[ids[0], 'both' as const]]);
    const anchors = new Map<string, 'opening' | 'closing'>();
    if (ids[0]) anchors.set(ids[0], 'opening');
    if (ids.at(-1)) anchors.set(ids.at(-1) as string, 'closing');
    return anchors;
  }, [model]);

  // One bound action object per section node, only when the host provided ANY structure callback —
  // `undefined` otherwise so `FragmentNode` renders no action row (see its `sectionActions` doc).
  const sectionActionsFor = useCallback(
    (nodeId: string): FragmentNodeProps['sectionActions'] => {
      if (!onAddSiblingSection && !onAddChildSection && !onRemoveSection && !onMoveSection) return undefined;
      return {
        onAddSiblingSection: onAddSiblingSection ? () => onAddSiblingSection(nodeId) : undefined,
        onAddChildSection: onAddChildSection ? () => onAddChildSection(nodeId) : undefined,
        onRemoveSection: onRemoveSection ? () => onRemoveSection(nodeId) : undefined,
        onMoveUp: onMoveSection ? () => onMoveSection(nodeId, 'up') : undefined,
        onMoveDown: onMoveSection ? () => onMoveSection(nodeId, 'down') : undefined,
      };
    },
    [onAddSiblingSection, onAddChildSection, onRemoveSection, onMoveSection],
  );

  const nodes = useMemo<PromptFlowNode[]>(
    () =>
      model.nodes.map((node) => {
        const flowNode = toFlowNode(
          node,
          positions.get(node.id) ?? { x: 0, y: 0 },
          controlledSelection ? selectedNodeId : layout.selected.has(node.id) ? node.id : undefined,
          selectionHighlight.nodeIds,
          sectionAnchorById.get(node.id),
          collapsedByNodeId,
          handleToggleCollapse,
          onEditNode,
          verificationByNodeId,
          sectionActionsFor,
          coverageByNodeId,
          onOpenVerification,
        );
        const resized = resizedNodes.get(node.id);
        const sized = resized
          ? {
              ...flowNode,
              width: resized.width,
              height: collapsedByNodeId.get(node.id) ? flowNode.height : resized.height,
            }
          : flowNode;
        return sized;
      }),
    [
      model,
      positions,
      selectedNodeId,
      selectionHighlight,
      sectionAnchorById,
      collapsedByNodeId,
      handleToggleCollapse,
      onEditNode,
      verificationByNodeId,
      sectionActionsFor,
      coverageByNodeId,
      onOpenVerification,
      resizedNodes,
      controlledSelection,
      layout.selected,
    ],
  );

  const hasSelection = selectedNodeId !== undefined;
  const boundsById = useMemo(
    () =>
      new Map(nodes.map((node) => [node.id, { ...node.position, width: node.width ?? 0, height: node.height ?? 0 }])),
    [nodes],
  );
  const nodeBounds = useMemo(() => [...boundsById.values()], [boundsById]);
  const edges = useMemo<Edge[]>(
    () =>
      model.edges.map((edge) => {
        const source = boundsById.get(edge.source);
        const target = boundsById.get(edge.target);
        return {
          ...toFlowEdge(edge, selectionHighlight.edgeIds.has(edge.id), hasSelection),
          ...(source && target ? closestFacingHandles(source, target) : {}),
          data: { labelX: layout.moved ? undefined : labelX, compact: layout.moved, onLabelWidth, nodeBounds },
        };
      }),
    [model, selectionHighlight, hasSelection, labelX, onLabelWidth, nodeBounds, boundsById, layout.moved],
  );

  const handleNodeClick: NodeMouseHandler<PromptFlowNode> = (_event, node) => {
    onSelectNode?.(node.id);
    if (node.type === 'label' && node.data.kind === 'file') onEditNode?.(node.id);
  };

  // Double-clicking a section card toggles its collapse state — the same flip as the card's own
  // chevron, just with a bigger hit target (the whole card). Double-clicking the ROOT chip opens
  // the host's edit affordance for the whole prompt document (the studio's full-markdown editor —
  // ADR-202 §3's "root is a markdown editor from which the sections are extracted"). Variable/tool
  // chips have neither a collapsed form nor an editable document, so a double-click on one is
  // ignored. Pairs with `zoomOnDoubleClick={false}` on `<ReactFlow>` below: xyflow's default
  // double-click zoom would fire on the SAME gesture (its d3-zoom listener sits on the pane
  // wrapper the node event bubbles through), making every toggle also lurch the viewport a zoom
  // step.
  const handleNodeDoubleClick: NodeMouseHandler<PromptFlowNode> = (_event, node) => {
    if (node.type === 'section') {
      handleToggleCollapse(node.id);
    } else if (node.type === 'label' && (node.data.kind === 'root' || node.data.kind === 'file')) {
      onEditNode?.(node.id);
    }
  };

  if (model.nodes.length === 0) {
    return (
      <div className="h-full w-full" data-testid="prompt-graph-canvas">
        <div
          className="flex h-full w-full items-center justify-center text-sm text-muted-foreground"
          data-testid="prompt-graph-empty-state"
        >
          No prompt sections to display.
        </div>
      </div>
    );
  }

  return (
    <div
      ref={container}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Enter' || !(event.target instanceof Element) || !event.target.matches('.react-flow__node'))
          return;
        const id = event.target.getAttribute('data-id');
        const node = model.nodes.find((node) => node.id === id);
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        onSelectNode?.(node.id);
        if (node.kind === 'file') onEditNode?.(node.id);
      }}
      className="h-full w-full"
      data-testid="prompt-graph-canvas"
      style={CONTROLS_THEME_STYLE}
    >
      <ReactFlowProvider>
        <ReactFlow
          onViewportChange={({ zoom }) => container.current?.toggleAttribute('data-zoomed-out', zoom < 1)}
          onInit={(instance) => {
            flow.current = instance;
            container.current?.toggleAttribute('data-zoomed-out', instance.getZoom() < 1);
          }}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClick={handleNodeClick}
          onNodesChange={(changes) => {
            for (const change of changes) {
              if (change.type === 'position' && change.position) layout.move(change.id, change.position);
              if (change.type === 'select') {
                if (!controlledSelection) layout.select(change.id, change.selected);
                if (change.selected) onSelectNode?.(change.id);
              }
              if (change.type === 'dimensions' && change.resizing !== undefined && change.dimensions) {
                const dimensions = change.dimensions;
                setResizedNodes((previous) => {
                  const existing = previous.get(change.id);
                  return existing?.width === dimensions.width && existing.height === dimensions.height
                    ? previous
                    : new Map(previous).set(change.id, dimensions);
                });
              }
            }
          }}
          onNodeDoubleClick={handleNodeDoubleClick}
          zoomOnDoubleClick={false}
          selectNodesOnDrag={false}
          nodesConnectable={false}
          elementsSelectable
          minZoom={CANVAS_MIN_ZOOM}
          maxZoom={CANVAS_MAX_ZOOM}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
        >
          <Background />
          <Controls showInteractive={false}>
            <ControlButton
              onClick={layout.arrange}
              disabled={!layout.moved}
              title="Auto arrange graph"
              aria-label="Auto arrange graph"
            >
              <ArrangeIcon />
            </ControlButton>
            <ControlButton onClick={handleCollapseAll} title="Collapse all sections" aria-label="Collapse all sections">
              <ChevronsUpIcon />
            </ControlButton>
            <ControlButton onClick={handleExpandAll} title="Expand all sections" aria-label="Expand all sections">
              <ChevronsDownIcon />
            </ControlButton>
          </Controls>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
