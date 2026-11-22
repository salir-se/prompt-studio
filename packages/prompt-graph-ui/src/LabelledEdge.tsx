import { BaseEdge, type Edge, type EdgeProps, getSmoothStepPath, Position } from '@xyflow/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { EDGE_ROUTE_OFFSET, type EdgeLabelBounds, placeCompactEdgeLabel, placeEdgeLabel } from './edge-label-placement';

const MAX_LABEL_CHARACTERS = 28;

export type LabelledFlowEdge = Edge<{
  labelX?: number;
  onLabelWidth?: (id: string, width: number) => void;
  nodeBounds?: readonly EdgeLabelBounds[];
  compact?: boolean;
}>;

/** Display is bounded; the graph model and accessible label keep the complete binding. */
export function visibleEdgeLabel(label: string): string {
  const characters = Array.from(label);
  return characters.length > MAX_LABEL_CHARACTERS
    ? `${characters.slice(0, MAX_LABEL_CHARACTERS - 1).join('')}…`
    : label;
}

/** Keep measured labels clear of nodes while retaining the preferred automatic gutter. */
export function LabelledEdge({
  id,
  data,
  label,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
  ...props
}: EdgeProps<LabelledFlowEdge>) {
  const group = useRef<SVGGElement>(null);
  const [labelSize, setLabelSize] = useState<{ width: number; height: number }>();
  const onLabelWidth = data?.onLabelWidth;
  const needsPlacement = data?.nodeBounds !== undefined;
  const horizontalPadding = props.labelBgPadding?.[0] ?? 2;
  const verticalPadding = props.labelBgPadding?.[1] ?? 4;
  const fullLabel = typeof label === 'string' ? label : '';
  const visibleLabel = visibleEdgeLabel(fullLabel);
  useLayoutEffect(() => {
    if (!visibleLabel) return;
    const element = group.current?.querySelector<SVGTextElement>('.react-flow__edge-text');
    if (!element || (!onLabelWidth && !needsPlacement)) return;
    let current = true;
    const measure = () => {
      if (!current) return;
      const box = element.getBBox?.();
      if (!box || box.width <= 0) return;
      const width = box.width + 2 * horizontalPadding;
      const height = box.height + 2 * verticalPadding;
      onLabelWidth?.(id, width);
      if (needsPlacement)
        setLabelSize((previous) =>
          previous?.width === width && previous.height === height ? previous : { width, height },
        );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    void document.fonts?.ready.then(measure);
    return () => {
      current = false;
      observer.disconnect();
    };
  }, [id, onLabelWidth, horizontalPadding, verticalPadding, visibleLabel, needsPlacement]);
  const route = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, offset: EDGE_ROUTE_OFFSET };
  const [nativePath, nativeX, nativeY] = getSmoothStepPath(route);
  const nativeCenter = { x: nativeX, y: nativeY };
  const center =
    data?.nodeBounds && labelSize
      ? data.compact
        ? placeCompactEdgeLabel({
            center: nativeCenter,
            labelWidth: labelSize.width,
            labelHeight: labelSize.height,
            nodeBounds: data.nodeBounds,
          })
        : placeEdgeLabel({
            sourceX,
            sourceY,
            targetX,
            targetY,
            sourcePosition,
            targetPosition,
            preferredX: data.labelX,
            labelWidth: labelSize.width,
            labelHeight: labelSize.height,
            nodeBounds: data.nodeBounds,
          })
      : data?.compact
        ? nativeCenter
        : { x: data?.labelX ?? (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };
  const path = data?.compact ? nativePath : getSmoothStepPath({ ...route, centerX: center.x, centerY: center.y })[0];
  return (
    <g ref={group}>
      <title>{fullLabel}</title>
      <BaseEdge
        id={id}
        path={path}
        labelX={center.x}
        labelY={center.y}
        label={visibleLabel}
        style={props.style}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        interactionWidth={props.interactionWidth}
        labelStyle={props.labelStyle}
        labelBgStyle={props.labelBgStyle}
        labelShowBg={props.labelShowBg}
        labelBgPadding={props.labelBgPadding}
        labelBgBorderRadius={props.labelBgBorderRadius}
      />
    </g>
  );
}
