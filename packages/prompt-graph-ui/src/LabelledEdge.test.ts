// @module-tag dom
import { expect, it } from 'vitest';
import { visibleEdgeLabel } from './LabelledEdge';

it('#2498: preserves short connection labels without truncation', () => {
  expect(visibleEdgeLabel('{{document}}')).toBe('{{document}}');
  expect(visibleEdgeLabel('Load before prompt')).toBe('Load before prompt');
});
it('#2498: bounds long visible labels without splitting Unicode code points or modifying the full value', () => {
  const full = `{{${'🧭данные'.repeat(20)}}}`;
  const visible = visibleEdgeLabel(full);
  expect(Array.from(visible)).toHaveLength(28);
  expect(visible).toBe(`${Array.from(full).slice(0, 27).join('')}…`);
  expect(full).toBe(`{{${'🧭данные'.repeat(20)}}}`);
});
