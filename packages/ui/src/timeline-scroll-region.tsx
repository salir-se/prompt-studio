import { type ComponentProps, type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import { m } from './text';
import { TimelineNavigator } from './timeline-rail/TimelineNavigator';
import { TIMELINE_RAIL_COPY as C } from './timeline-rail/copy';
import { cn } from './utils';

const DESKTOP = '(min-width: 1100px) and (forced-colors: none)';
const EDIT_CONTROL = 'textarea,input,select,[contenteditable],[role="textbox"],[data-native-editor]';
const MARK = 'h1,h2,h3,[data-rail-mark],[data-slot="card-title"]';
const LABELS = { timeline: m(C.region), jump: m(C.jumpRegion) };

export function TimelineScrollControls({
  viewportRef: providedRef,
  label = LABELS.timeline,
  documentViewport = false,
  inline = false,
  viewportElement,
}: {
  viewportRef?: RefObject<HTMLElement | null>;
  label?: string;
  documentViewport?: boolean;
  inline?: boolean;
  viewportElement?: HTMLElement | null;
}) {
  const id = useId();
  const documentRef = useRef<HTMLElement>(null);
  const viewportRef = providedRef ?? documentRef;
  const [items, setItems] = useState<Parameters<typeof TimelineNavigator>[0]['items']>([]);
  const [active, setActive] = useState(false);
  const labels = useMemo(() => ({ timeline: label, jump: LABELS.jump }), [label]);
  useEffect(() => {
    if (documentViewport && document.scrollingElement instanceof HTMLElement)
      documentRef.current = document.scrollingElement;
    if (viewportElement !== undefined) documentRef.current = viewportElement;
    const viewport = viewportRef.current;
    const desktop = window.matchMedia?.(DESKTOP);
    if (!viewport || !desktop) return;

    let frame = 0;
    const viewportScope = viewport.closest('[data-timeline-scroll-viewport]');
    const editorScope = viewport.closest(EDIT_CONTROL);
    let nextId = 0;
    const update = () => {
      frame = 0;
      const scrolling =
        desktop.matches &&
        (documentViewport || ['auto', 'scroll'].includes(getComputedStyle(viewport).overflowY)) &&
        viewport.scrollHeight > viewport.clientHeight + 1;
      viewport.toggleAttribute('data-timeline-scroll-active', scrolling);
      if (inline && scrolling) {
        viewport.style.setProperty(
          '--timeline-inline-gap',
          getComputedStyle(viewport).rowGap === 'normal' ? '0px' : getComputedStyle(viewport).rowGap,
        );
      }
      setActive(scrolling);
      if (!scrolling) return;
      const next = Array.from(viewport.querySelectorAll<HTMLElement>(MARK)).flatMap((element) => {
        if (
          element.closest(EDIT_CONTROL) !== editorScope ||
          element.closest('[data-rail-outline="off"]') ||
          (!documentViewport && element.closest('[data-timeline-scroll-viewport]') !== viewportScope) ||
          (documentViewport &&
            element.closest('[data-timeline-scroll-viewport],[role="dialog"],[role="alertdialog"]')) ||
          element.closest('[data-timeline-navigator]') ||
          element.closest('[hidden]') ||
          element.checkVisibility?.() === false
        )
          return [];
        const label = (element.dataset.railMark || element.innerText || element.textContent)?.trim().slice(0, 80);
        if (!label) return [];
        if (!element.id) element.id = `${id}-section-${nextId++}`;
        if (!element.hasAttribute('tabindex')) element.tabIndex = -1;
        return [{ key: element.id, targetId: element.id, label, kind: 'section' as const }];
      });
      setItems((previous) =>
        previous.length === next.length &&
        previous.every((item, index) => item.key === next[index].key && item.label === next[index].label)
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    const observeChildren = () => {
      for (const child of viewport.children) resize?.observe(child);
    };
    const mutations =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver((records) => {
            if (
              records.every(
                ({ target }) =>
                  (target instanceof Element ? target : target.parentElement)?.closest(EDIT_CONTROL) !== editorScope,
              )
            )
              return;
            observeChildren();
            schedule();
          });
    resize?.observe(viewport);
    observeChildren();
    mutations?.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-rail-mark'],
    });
    desktop.addEventListener('change', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      desktop.removeEventListener('change', schedule);
      resize?.disconnect();
      mutations?.disconnect();
      viewport.removeAttribute('data-timeline-scroll-active');
      if (inline) viewport.style.removeProperty('--timeline-inline-gap');
    };
  }, [documentViewport, id, inline, viewportElement, viewportRef]);

  if (!active) return null;
  const rail = (
    <TimelineNavigator
      items={items}
      viewportRef={viewportRef}
      labels={labels}
      boundaries={{ top: m(C.top), bottom: m(C.bottom) }}
    />
  );
  return inline ? <div className="timeline-inline-controls">{rail}</div> : rail;
}

export function DocumentTimelineScroll() {
  return (
    <div className="timeline-document-controls">
      <TimelineScrollControls documentViewport />
    </div>
  );
}

export function TimelineScrollRegion({
  children,
  className,
  viewportClassName,
  viewportProps,
  label,
  viewportRef: externalRef,
  ...props
}: ComponentProps<'div'> & {
  viewportClassName?: string;
  viewportProps?: Omit<ComponentProps<'div'>, 'ref' | 'className'>;
  label?: string;
  viewportRef?: RefObject<HTMLDivElement | null>;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const viewportRef = externalRef ?? localRef;
  return (
    <div {...props} className={cn('timeline-scroll-region', className)}>
      <div
        {...viewportProps}
        ref={viewportRef}
        data-timeline-scroll-viewport=""
        className={cn('timeline-scroll-viewport', viewportClassName)}
      >
        {children}
      </div>
      <TimelineScrollControls viewportRef={viewportRef} label={label} />
    </div>
  );
}
