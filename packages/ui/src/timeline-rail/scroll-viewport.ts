export function viewportTop(viewport: HTMLElement): number {
  return viewport === viewport.ownerDocument.scrollingElement ? 0 : viewport.getBoundingClientRect().top;
}

export function scrollEvents(viewport: HTMLElement): HTMLElement | Document {
  return viewport === viewport.ownerDocument.scrollingElement ? viewport.ownerDocument : viewport;
}
