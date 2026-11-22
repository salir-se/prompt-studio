// @module-tag pure
import { expect, it } from 'vitest';
import { tipBottom } from './tip-position';

const tip = { left: 16, right: 359, top: 513, bottom: 611, height: 98 };
it('moves a tip above a bottom sheet rather than covering its inputs and results', () => {
  expect(tipBottom(tip, [{ left: 0, right: 375, top: 403, bottom: 667, height: 264 }], 667)).toBe(272);
});
it('skips a tip when a covering dialog leaves no room', () => {
  expect(tipBottom(tip, [{ left: 0, right: 375, top: 20, bottom: 667, height: 647 }], 667)).toBeNull();
});
it('retains the bottom-right position when dialogs do not overlap it', () => {
  expect(tipBottom(tip, [{ left: 400, right: 900, top: 200, bottom: 600, height: 400 }], 800)).toBeUndefined();
  expect(tipBottom(tip, [], 667)).toBeUndefined();
});
