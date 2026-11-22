import { useLayoutEffect } from 'react';
import { tipBottom } from './tip-position';

function findTipList() {
  return document
    .querySelector<HTMLElement>('[aria-label="Shortcut tip"]')
    ?.closest<HTMLElement>('[data-sonner-toaster]');
}

/**
 * Sonner's toast list sits outside dialogs; keep the teaching tip clear of the user's active task.
 * Sonner adds the tip on a later task without re-rendering its caller, so the tip is looked up on
 * every DOM change rather than once when the hook runs.
 */
export function useTipLayout(hide: () => void) {
  useLayoutEffect(() => {
    const resize = new ResizeObserver(() => place());
    let observed: HTMLElement | undefined;
    function place() {
      const list = findTipList();
      if (!list) return;
      if (list !== observed) {
        observed = list;
        resize.observe(list);
        for (const dialog of document.querySelectorAll('[role="dialog"], [role="dialog"][data-studio-panels] > *'))
          resize.observe(dialog);
      }
      list.style.removeProperty('bottom');
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
        .filter((dialog) => dialog.dataset.state !== 'closed')
        .flatMap((dialog) =>
          dialog.hasAttribute('data-studio-panels')
            ? [...dialog.children].filter((child): child is HTMLElement => child instanceof HTMLElement)
            : [dialog],
        )
        .filter((surface) => surface.getClientRects().length);
      const bottom = tipBottom(
        list.getBoundingClientRect(),
        dialogs.map((dialog) => dialog.getBoundingClientRect()),
        window.innerHeight,
      );
      if (bottom === null) hide();
      else if (bottom !== undefined) list.style.bottom = `${bottom}px`;
    }
    place();
    const mutation = new MutationObserver(place);
    mutation.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', place);
    document.addEventListener('animationend', place, true);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('animationend', place, true);
    };
  }, [hide]);
}
