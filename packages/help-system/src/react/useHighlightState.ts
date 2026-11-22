import { useCallback, useState } from 'react';

/** A request to spotlight one or more help targets. `intent` tweaks the ring color. */
export interface HighlightRequest {
  helpIds: string[];
  label?: string;
  intent?: 'focus' | 'warn';
}

export interface HighlightController {
  highlight: HighlightRequest | null;
  setHighlight: (request: HighlightRequest | null) => void;
  clearHighlight: () => void;
}

/**
 * Owns the active highlight. The browser-dispatch bridge calls `setHighlight`
 * (from the LLM's `highlight_region` tool) and `clearHighlight` (`clear_highlight`,
 * ESC, or the next user action).
 */
export function useHighlightState(): HighlightController {
  const [highlight, setHighlight] = useState<HighlightRequest | null>(null);
  const clearHighlight = useCallback(() => setHighlight(null), []);
  return { highlight, setHighlight, clearHighlight };
}
