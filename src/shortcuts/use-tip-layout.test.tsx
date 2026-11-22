// @module-tag dom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTipLayout } from './use-tip-layout';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function fixture(modal: boolean) {
  document.body.innerHTML = `<div data-sonner-toaster><div aria-label="Shortcut tip"></div></div><div data-studio-panels ${modal ? 'role="dialog"' : ''}><aside data-evaluation-dock></aside></div>`;
  const box = (element: Element) =>
    element.hasAttribute('data-sonner-toaster')
      ? new DOMRect(16, 513, 343, 98)
      : element.hasAttribute('data-evaluation-dock')
        ? new DOMRect(0, 0, 375, 667)
        : new DOMRect(0, 667, 375, 0);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return box(this);
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return [box(this)] as unknown as DOMRectList;
  });
  const hide = vi.fn();
  renderHook(() => useTipLayout(hide));
  return hide;
}
it('#2490: keeps the teaching tip out of a mobile panel whose fixed aside extends beyond its empty dialog wrapper', () => {
  expect(fixture(true)).toHaveBeenCalled();
});
it('keeps the normal bottom-right tip for a desktop evaluation dock without a covering dialog', () => {
  expect(fixture(false)).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLElement>('[data-sonner-toaster]')?.style.bottom).toBe('');
});

it('places a tip that Sonner renders after the layout hook has already run', async () => {
  // Given: the hook runs before any tip exists, as it does when Sonner adds the toast on a later task
  document.body.innerHTML = '<div data-studio-panels role="dialog"><aside data-evaluation-dock></aside></div>';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-sonner-toaster')
      ? new DOMRect(16, 513, 343, 98)
      : this.hasAttribute('data-evaluation-dock')
        ? new DOMRect(0, 0, 375, 667)
        : new DOMRect(0, 667, 375, 0);
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
  });
  const hide = vi.fn();
  renderHook(() => useTipLayout(hide));
  expect(hide).not.toHaveBeenCalled();

  // When: the tip appears under the covering panel
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div data-sonner-toaster><div aria-label="Shortcut tip"></div></div>',
  );

  // Then: the hook notices it and keeps it out of the user's way
  await vi.waitFor(() => expect(hide).toHaveBeenCalled());
});
