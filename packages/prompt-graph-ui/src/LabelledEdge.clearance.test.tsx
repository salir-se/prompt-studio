// @module-tag dom

import { cleanup, render } from '@testing-library/react';
import { getSmoothStepPath, Position } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LabelledEdge, type LabelledFlowEdge } from './LabelledEdge';
import type { EdgeLabelBounds } from './edge-label-placement';

const originalBBox = Object.getOwnPropertyDescriptor(SVGGraphicsElement.prototype, 'getBBox');
beforeEach(() => {
  Object.defineProperty(SVGGraphicsElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 80, height: 12 }),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalBBox) Object.defineProperty(SVGGraphicsElement.prototype, 'getBBox', originalBBox);
  else Reflect.deleteProperty(SVGGraphicsElement.prototype, 'getBBox');
});

function edge(data: LabelledFlowEdge['data'], reverse = false) {
  return (
    <svg>
      <title>Connection label fixture</title>
      <LabelledEdge
        id="reference"
        source="source"
        target="target"
        sourceX={reverse ? 600 : 0}
        sourceY={0}
        targetX={reverse ? 0 : 600}
        targetY={200}
        sourcePosition={Position.Right}
        targetPosition={Position.Left}
        label="{{document}}"
        data={data}
      />
    </svg>
  );
}

function labelBounds(container: HTMLElement) {
  const wrapper = container.querySelector('.react-flow__edge-textwrapper')!;
  const background = wrapper.querySelector('rect')!;
  expect(wrapper.getAttribute('visibility')).toBe('visible');
  const [x, y] = wrapper
    .getAttribute('transform')!
    .match(/-?\d+(?:\.\d+)?/g)!
    .map(Number);
  const left = x + Number(background.getAttribute('x'));
  const top = y + Number(background.getAttribute('y'));
  const right = left + Number(background.getAttribute('width'));
  const bottom = top + Number(background.getAttribute('height'));
  return { left, top, right, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
}

function expectClearance(container: HTMLElement, nodes: readonly EdgeLabelBounds[]) {
  const label = labelBounds(container);
  for (const node of nodes) {
    const gap = Math.max(
      label.left - node.x - node.width,
      node.x - label.right,
      label.top - node.y - node.height,
      node.y - label.bottom,
    );
    expect(gap, 'rendered label background must retain 16 graph pixels from every node').toBeGreaterThanOrEqual(16);
  }
}

it('#2536: the rendered connection label clears a node dragged across its old gutter', () => {
  const nodeBounds = [
    { x: -200, y: -18, width: 200, height: 36 },
    { x: 600, y: 182, width: 200, height: 36 },
    { x: 360, y: 80, width: 80, height: 40 },
  ];
  const { container, rerender } = render(edge({ labelX: 400, nodeBounds }));
  expectClearance(container, nodeBounds);
  const moved = [...nodeBounds.slice(0, 2), { x: 250, y: 80, width: 100, height: 40 }];
  rerender(edge({ labelX: 400, nodeBounds: moved }));
  expectClearance(container, moved);
});

it('#2536: a reversed edge moves its label with the horizontal path segment', () => {
  const nodeBounds = [{ x: 260, y: 80, width: 80, height: 40 }];
  const { container } = render(edge({ labelX: 400, nodeBounds }, true));
  expectClearance(container, nodeBounds);
  expect(labelBounds(container)).toMatchObject({ centerX: 300, centerY: 54 });
  // Real BaseEdge path, rather than a mocked path generator, follows the relocated label.
  expect(container.querySelector('.react-flow__edge-path')?.getAttribute('d')).toContain('615,54L -15,54');
});

it('#2536: existing callers without node bounds retain their preferred coordinates and measured width', () => {
  const onLabelWidth = vi.fn();
  const { container, rerender } = render(edge({ labelX: 400, onLabelWidth }));
  expect(labelBounds(container)).toMatchObject({ centerX: 400, centerY: 100 });
  expect(onLabelWidth).toHaveBeenCalledWith('reference', 84);
  rerender(edge({ labelX: 400, onLabelWidth }, true));
  expect(labelBounds(container)).toMatchObject({ centerX: 400, centerY: 100 });
});

it.each([
  { sourcePosition: Position.Left, targetPosition: Position.Right, sourceX: 600, sourceY: 0, targetX: 0, targetY: 200 },
  { sourcePosition: Position.Bottom, targetPosition: Position.Top, sourceX: 0, sourceY: 0, targetX: 200, targetY: 600 },
  { sourcePosition: Position.Top, targetPosition: Position.Bottom, sourceX: 0, sourceY: 600, targetX: 200, targetY: 0 },
])(
  '#2540: renders the compact native route for the actual facing handles: $sourcePosition → $targetPosition',
  (route) => {
    const connection = (data: LabelledFlowEdge['data']) => (
      <svg>
        <title>Adaptive connection fixture</title>
        <LabelledEdge id="reference" source="source" target="target" label="{{document}}" data={data} {...route} />
      </svg>
    );
    const { container, rerender } = render(connection({ nodeBounds: [] }));
    const [expectedPath] = getSmoothStepPath(route);
    expect(container.querySelector('.react-flow__edge-path')?.getAttribute('d')).toBe(expectedPath);
    expect(labelBounds(container)).toMatchObject({
      centerX: (route.sourceX + route.targetX) / 2,
      centerY: (route.sourceY + route.targetY) / 2,
    });
    const nodeBounds = [
      {
        x: (route.sourceX + route.targetX) / 2 - 40,
        y: (route.sourceY + route.targetY) / 2 - 20,
        width: 80,
        height: 40,
      },
    ];
    rerender(connection({ nodeBounds, compact: true }));
    expect(container.querySelector('.react-flow__edge-path')?.getAttribute('d')).toBe(expectedPath);
    expectClearance(container, nodeBounds);
  },
);

it('#2540: a close manual connection keeps its native path while its caption clears both endpoints', () => {
  const route = {
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    sourceX: 0,
    sourceY: 0,
    targetX: 70,
    targetY: 0,
  };
  const nodeBounds = [
    { x: -200, y: -18, width: 200, height: 36 },
    { x: 70, y: -18, width: 200, height: 36 },
  ];
  const data = { compact: true, labelX: 999, nodeBounds };
  const connection = (targetX: number, bounds: EdgeLabelBounds[]) => (
    <svg>
      <title>Close connection fixture</title>
      <LabelledEdge
        id="reference"
        source="source"
        target="target"
        label="{{document}}"
        data={{ ...data, nodeBounds: bounds }}
        {...route}
        targetX={targetX}
      />
    </svg>
  );
  const { container, rerender } = render(connection(70, nodeBounds));
  expect(container.querySelector('.react-flow__edge-path')?.getAttribute('d')).toBe(getSmoothStepPath(route)[0]);
  expectClearance(container, nodeBounds);
  expect(labelBounds(container)).toMatchObject({ centerX: 35, centerY: -44 });
  const moved = [nodeBounds[0], { ...nodeBounds[1], x: 170 }];
  rerender(connection(170, moved));
  expect(container.querySelector('.react-flow__edge-path')?.getAttribute('d')).toBe(
    getSmoothStepPath({ ...route, targetX: 170 })[0],
  );
  expectClearance(container, moved);
  expect(labelBounds(container)).toMatchObject({ centerX: 85, centerY: 0 });
});
