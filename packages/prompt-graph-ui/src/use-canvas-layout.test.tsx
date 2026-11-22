// @module-tag dom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SMALL_MODEL } from './PromptGraphCanvas.test.fixtures';
import { useCanvasLayout } from './use-canvas-layout';

it('#2536: retains moved positions through model refresh and footprint changes, then auto-arranges', () => {
  const defaults = new Map(SMALL_MODEL.nodes.map((node, index) => [node.id, { x: index * 420, y: 0 }]));
  const { result, rerender } = renderHook(({ model, positions }) => useCanvasLayout(model, positions), {
    initialProps: { model: SMALL_MODEL, positions: defaults },
  });
  act(() => result.current.move('section:mission', { x: 500, y: 75 }));
  act(() => result.current.select('section:mission', true));
  const resized = new Map([...defaults].map(([id, point]) => [id, { x: point.x + 30, y: 100 }]));
  rerender({ model: { ...SMALL_MODEL, nodes: [...SMALL_MODEL.nodes] }, positions: resized });
  expect(result.current.positions.get('section:mission')).toEqual({ x: 500, y: 75 });
  expect(result.current.positions.get(SMALL_MODEL.nodes[0].id)).toEqual(resized.get(SMALL_MODEL.nodes[0].id));
  expect(result.current.selected.has('section:mission')).toBe(true);
  act(() => result.current.arrange());
  expect(result.current.positions).toEqual(resized);
  expect(result.current.moved).toBe(false);
  expect(result.current.selected.has('section:mission')).toBe(true);
});

it('#2536: drops removed-node positions so a re-created section starts at its automatic position', () => {
  const defaults = new Map([['section:mission', { x: 420, y: 0 }]]);
  const { result, rerender } = renderHook(({ model }) => useCanvasLayout(model, defaults), {
    initialProps: { model: SMALL_MODEL },
  });
  act(() => result.current.move('section:mission', { x: 700, y: 80 }));
  rerender({ model: { ...SMALL_MODEL, nodes: SMALL_MODEL.nodes.filter((node) => node.id !== 'section:mission') } });
  rerender({ model: SMALL_MODEL });
  expect(result.current.positions.get('section:mission')).toEqual({ x: 420, y: 0 });
  expect(result.current.moved).toBe(false);
});

it('#2536: another prompt resets manual layout and native selection even when section IDs repeat', () => {
  const defaults = new Map([['section:mission', { x: 420, y: 0 }]]);
  const { result, rerender } = renderHook(({ model }) => useCanvasLayout(model, defaults), {
    initialProps: { model: SMALL_MODEL },
  });
  act(() => result.current.move('section:mission', { x: 700, y: 80 }));
  act(() => result.current.select('section:mission', true));
  rerender({
    model: {
      ...SMALL_MODEL,
      nodes: SMALL_MODEL.nodes.map((node) => (node.kind === 'root' ? { ...node, id: 'root:another' } : node)),
    },
  });
  expect(result.current.positions.get('section:mission')).toEqual({ x: 420, y: 0 });
  expect([...result.current.selected]).toEqual([]);
});
