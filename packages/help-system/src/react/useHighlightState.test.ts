// @module-tag dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHighlightState } from './useHighlightState';

describe('useHighlightState', () => {
  it('starts with no highlight, sets and clears it', () => {
    const { result } = renderHook(() => useHighlightState());
    expect(result.current.highlight).toBeNull();

    act(() => result.current.setHighlight({ helpIds: ['scout.run-button'], label: 'Run Scout' }));
    expect(result.current.highlight?.helpIds).toEqual(['scout.run-button']);

    act(() => result.current.clearHighlight());
    expect(result.current.highlight).toBeNull();
  });
});
