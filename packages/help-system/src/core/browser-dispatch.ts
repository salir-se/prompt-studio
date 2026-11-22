import type { AssistantPromptContext, DispatchTool } from './adapters';
import { missingTargets } from './resolveTargets';

/**
 * Host-side handlers for the assistant's read-only UI tools. The provider wires
 * these to React state setters / controllers (highlight overlay, tour, PiP,
 * scroll, navigate) and a read-only `verifyCheck`. All are optional so a host can
 * support a subset.
 */
export interface BrowserToolHandlers {
  highlight_region?: (input: { helpIds: string[]; label?: string; intent?: 'focus' | 'warn' }) => void;
  clear_highlight?: () => void;
  scroll_to?: (input: { helpId: string }) => void;
  start_tour?: (input: { tourId: string }) => void | boolean | Promise<void | boolean>;
  open_help_video?: (input: { videoId?: string; src?: string; startSeconds?: number }) => void;
  navigate?: (input: {
    pageKey: string;
  }) => void | boolean | AssistantPromptContext | Promise<void | boolean | AssistantPromptContext>;
  verify_step?: (input: { checkId: string }) => boolean | Promise<boolean>;
}

/**
 * Build a {@link DispatchTool} that routes the assistant's read-only UI tools
 * into `handlers`, translating the model's snake_case tool input into the
 * handler shape and acking with a small JSON result the model reads back. Unknown
 * tools fall through to `fallback` (e.g. the host runner's data-tool dispatch) or
 * return an error. This is the bridge `runAgent()` calls — no agent change, and
 * **no write tools exist** (ADR-089, read-only invariant).
 */
export function createBrowserDispatch(handlers: BrowserToolHandlers, fallback?: DispatchTool): DispatchTool {
  return async (name, input, signal) => {
    const arg = (input ?? {}) as Record<string, unknown>;
    switch (name) {
      case 'highlight_region': {
        const helpIds = Array.isArray(arg.help_ids) ? (arg.help_ids as string[]) : [];
        // Tell the model which ids do not resolve on the CURRENT page so it can
        // correct course (navigate first, or pick a listed id). When nothing
        // resolves, do NOT dim the screen: a spotlight with no hole plus a
        // corner caption reads as a glitch — refuse instead.
        const missing = typeof document === 'undefined' ? [] : missingTargets(helpIds);
        const resolved = helpIds.filter((id) => !missing.includes(id));
        if (helpIds.length > 0 && resolved.length === 0) {
          return {
            ok: false,
            missing,
            hint: 'None of these help ids exist on the current page. Use an id listed for this page, or navigate to the right page first.',
          };
        }
        handlers.highlight_region?.({ helpIds, label: arg.label as string, intent: arg.intent as 'focus' | 'warn' });
        return { ok: true, highlighted: resolved, ...(missing.length > 0 ? { missing } : {}) };
      }
      case 'clear_highlight':
        handlers.clear_highlight?.();
        return { ok: true };
      case 'scroll_to': {
        const helpId = (arg.help_id as string) ?? '';
        if (helpId && typeof document !== 'undefined' && missingTargets([helpId]).length > 0) {
          return { ok: false, missing: [helpId], hint: 'This help id does not exist on the current page.' };
        }
        handlers.scroll_to?.({ helpId });
        return { ok: true, help_id: helpId };
      }
      case 'start_tour': {
        const tourId = (arg.tour_id as string) ?? '';
        const accepted = handlers.start_tour ? (await handlers.start_tour({ tourId })) !== false : false;
        return { ok: accepted, tour_id: tourId };
      }
      case 'open_help_video': {
        handlers.open_help_video?.({
          videoId: arg.video_id as string,
          src: arg.src as string,
          startSeconds: arg.start_seconds as number,
        });
        return { ok: true, video_id: arg.video_id, src: arg.src };
      }
      case 'navigate': {
        const pageKey = (arg.page_key as string) ?? '';
        const result = await handlers.navigate?.({ pageKey });
        return {
          ok: !!handlers.navigate && result !== false,
          page_key: pageKey,
          ...(typeof result === 'object' && result !== null ? { context: result } : {}),
        };
      }
      case 'verify_step': {
        const checkId = (arg.check_id as string) ?? '';
        const passed = (await handlers.verify_step?.({ checkId })) ?? false;
        return { ok: true, check_id: checkId, passed };
      }
      default:
        if (fallback) return fallback(name, input, signal);
        return { ok: false, error: `unknown UI tool: ${name}` };
    }
  };
}
