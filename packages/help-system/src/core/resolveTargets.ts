// Resolve `data-help-id` targets to on-screen elements (ADR-089).
//
// The AI highlight overlay and `scroll_to` tool reference elements by their
// stable `data-help-id`. This pure DOM helper turns those ids into live
// elements + viewport rects, dropping anything hidden, disabled, or detached so
// the assistant can never spotlight something the user can't see or act on
// (ADR-089 §G6). No React — usable by the overlay, scroll, and the dev scanner.

export interface ResolvedTarget {
  helpId: string;
  element: Element;
  /** Viewport rect (used to position the spotlight cut-out). */
  rect: DOMRect;
}

/**
 * Resolve `helpIds` to their eligible on-screen elements, in request order and
 * de-duplicated. Missing, detached, hidden, or disabled targets are skipped.
 */
export function resolveTargets(helpIds: string[], root: ParentNode = document): ResolvedTarget[] {
  const seen = new Set<string>();
  const resolved: ResolvedTarget[] = [];
  for (const helpId of helpIds) {
    if (!helpId || seen.has(helpId)) continue;
    seen.add(helpId);
    const element = root.querySelector(`[data-help-id="${escapeAttr(helpId)}"]`);
    if (element && isEligible(element)) {
      resolved.push({ helpId, element, rect: element.getBoundingClientRect() });
    }
  }
  return resolved;
}

/** Requested help ids that did not resolve (for the browser bridge + dev scanner). */
export function missingTargets(helpIds: string[], root: ParentNode = document): string[] {
  const found = new Set(resolveTargets(helpIds, root).map((t) => t.helpId));
  return [...new Set(helpIds.filter(Boolean))].filter((id) => !found.has(id));
}

function isEligible(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el.hasAttribute('hidden')) return false;
  if (el.matches('[disabled], [aria-disabled="true"]')) return false;
  const inline = (el as HTMLElement).style;
  if (inline && (inline.display === 'none' || inline.visibility === 'hidden')) return false;
  const computed = safeComputedStyle(el);
  if (
    computed &&
    (computed.display === 'none' || computed.visibility === 'hidden' || computed.visibility === 'collapse')
  ) {
    return false;
  }
  return true;
}

function safeComputedStyle(el: Element): CSSStyleDeclaration | null {
  try {
    return typeof globalThis.getComputedStyle === 'function' ? globalThis.getComputedStyle(el) : null;
  } catch {
    return null;
  }
}

/** Escape a value for use inside `[data-help-id="…"]`. */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
