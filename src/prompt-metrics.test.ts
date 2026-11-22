// @module-tag dom
import { describe, expect, it } from 'vitest';
import { promptMetrics } from './prompt-metrics';

describe('promptMetrics', () => {
  it('reports exact Unicode code points and UTF-8 bytes while keeping tokens explicitly estimated', () => {
    expect(promptMetrics('A🙂')).toEqual({ characters: 2, bytes: 5, estimatedTokens: 2 });
  });

  it('reports zeroes for an empty prompt', () => {
    expect(promptMetrics('')).toEqual({ characters: 0, bytes: 0, estimatedTokens: 0 });
  });
});
