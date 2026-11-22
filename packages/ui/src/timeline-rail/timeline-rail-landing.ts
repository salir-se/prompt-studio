export const LANDED_ATTRIBUTE = 'data-timeline-landed';
/** Matches the `timeline-navigator-landed` animation: the attribute is removed when it has run. */
export const LANDED_MS = 600;

/**
 * Flashes the destination a jump landed on: the stylesheet draws a fading outline on `[data-timeline-landed]`.
 * The attribute goes when the element's own animation ends, or after `durationMs` if no event arrives (the
 * animation is off, or the element is not rendered). Returns a cleanup that removes the flash at once.
 */
export function flashLanding(element: HTMLElement, durationMs: number = LANDED_MS): () => void {
  if (element.hasAttribute(LANDED_ATTRIBUTE)) {
    // Restart the animation for a destination that is landed on again.
    element.removeAttribute(LANDED_ATTRIBUTE);
    void element.getBoundingClientRect();
  }
  element.setAttribute(LANDED_ATTRIBUTE, '');
  const onEnd = (event: Event) => {
    if (event.target === element) done();
  };
  const done = () => {
    clearTimeout(timer);
    element.removeEventListener('animationend', onEnd);
    element.removeAttribute(LANDED_ATTRIBUTE);
  };
  const timer = setTimeout(done, durationMs);
  element.addEventListener('animationend', onEnd);
  return done;
}
