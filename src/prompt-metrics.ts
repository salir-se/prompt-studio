export interface PromptMetrics {
  readonly characters: number;
  readonly bytes: number;
  readonly estimatedTokens: number;
}

/** Exact source-size metrics plus a deliberately model-agnostic token estimate. */
export function promptMetrics(text: string): PromptMetrics {
  const bytes = new TextEncoder().encode(text).length;
  return { characters: [...text].length, bytes, estimatedTokens: Math.ceil(bytes / 4) };
}
