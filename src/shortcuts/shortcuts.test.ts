// @module-tag pure
import { expect, it } from 'vitest';
import { matchesShortcut, shortcutKeys } from './shortcuts';

it('shows the actual platform binding and preserves Ctrl+Space on Mac', () => {
  expect(shortcutKeys('apply', true)).toEqual([['⌘', 'S']]);
  expect(shortcutKeys('apply', false)).toEqual([['Ctrl', 'S']]);
  expect(shortcutKeys('complete', true)).toEqual([['Ctrl', 'Space']]);
  expect(shortcutKeys('jump', true)).toEqual([['⌥', 'J']]);
});

it('matches physical Alt keys and declines extra modifiers', () => {
  const event = { key: '∆', code: 'KeyJ', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };
  expect(matchesShortcut(event, 'jump')).toBe(true);
  expect(matchesShortcut({ ...event, shiftKey: true }, 'jump')).toBe(false);
  expect(matchesShortcut({ ...event, altKey: false }, 'jump')).toBe(false);
});
