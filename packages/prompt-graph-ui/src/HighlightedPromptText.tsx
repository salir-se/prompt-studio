/**
 * HighlightedPromptText — backdrop-overlay highlighted textarea, extracted as
 * its own reusable piece for the prompt graph studio (ADR-200/ADR-202).
 *
 * ATTRIBUTION: this mirrors `PromptHighlightedEditor` in
 * `www/app.salir.se/src/components/prompts/PromptHighlightedEditor.tsx`
 * byte-for-byte in technique and token colour vocabulary — composing the
 * universal `MarkdownEditor` (`mode="plain"`, ADR-096) so the underlying
 * textarea stays byte-transparent, while a `pointer-events-none aria-hidden`
 * backdrop layer underneath renders the SAME text with known
 * variables/unknown variables/tools/tags tinted inline. The two components
 * cannot be unified today: the operator app is FORBIDDEN from importing
 * `@prompt-studio/prompt-graph-ui` (see `www/app.salir.se/src/prompt-graph-ui-containment.test.ts`,
 * which structurally guards that boundary so `@xyflow/react` never ships to
 * every operator-app user for a feature that isn't live for them). ADR-202
 * schedules unification for the later, deliberate, flag-gated promotion of
 * this package into the operator SPA behind `prompt-graph-view`. Until then
 * this file is a deliberate, tracked duplicate — keep its technique and
 * `TOKEN_KIND_CLASSES` in lockstep with the app original if either changes.
 *
 * Overlay technique (classic highlighted-textarea trick): the real
 * `<textarea>` sits ON TOP with fully transparent text (`text-transparent`,
 * only the caret + selection highlight are visible) so the colored backdrop
 * shows through everywhere except where the caret/selection paint. This
 * requires the textarea to be a *positioned* element (`relative`) — without
 * it, the absolutely-positioned backdrop would always paint on top per CSS
 * stacking rules regardless of DOM order, hiding the caret and swallowing
 * clicks. The backdrop stays `pointer-events-none` + `aria-hidden` as a
 * decorative-only layer (defense in depth on top of the stacking order).
 *
 * `tokens` is expected to partition `value` completely — concatenating every
 * token's `text` in order reconstructs `value` byte-for-byte, which is what
 * keeps the backdrop's rendered text pixel-aligned with the real textarea.
 */

import { MarkdownEditor } from '@prompt-studio/markdown-editor';
import type { PromptToken, PromptTokenKind } from '@prompt-studio/prompts';
import { cn } from '@prompt-studio/ui/utils';
import { useEffect, useRef } from 'react';

export interface HighlightedPromptTextProps {
  value: string;
  onChange: (value: string) => void;
  tokens: PromptToken[];
  rows?: number;
  lineNumbers?: boolean;
  ariaLabel?: string;
  /** Forwarded to the real `<textarea>` (sizing/overflow for its own box). */
  className?: string;
  /** Forwarded to the outer positioned wrapper — the actual flex item in the
   *  caller's layout (the textarea is a grandchild once nested in the
   *  overlay's `relative` div, so a flex-sizing class like `flex-1 min-h-0`
   *  put on `className` alone never reaches a real flex container and is
   *  inert; this lets the caller size the wrapper directly). Omit for
   *  byte-identical rendering (no flex constraint). */
  containerClassName?: string;
  id?: string;
  dataTestId?: string;
}

// Same colour vocabulary as `PromptHighlightedEditor.tsx` and this package's
// own `FragmentNode`/`LabelChip` chips (variable = violet, tool = sky) plus
// the amber/emerald tones for unknown-variable/tag — keep these four in
// lockstep with the app original.
const TOKEN_KIND_CLASSES: Record<Exclude<PromptTokenKind, 'text'>, string> = {
  variable: 'bg-violet-100/70 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300 rounded-sm',
  'unknown-variable': 'bg-amber-100/80 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200 rounded-sm',
  tool: 'bg-sky-100/70 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300 rounded-sm',
  tag: 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 rounded-sm',
};

/**
 * Renders a `PromptToken` partition as tinted inline spans — the one shared
 * definition of "highlighted prompt text" in this package. Used both by the
 * editor overlay below (as its backdrop content) and by read-only surfaces
 * (`FragmentNode`'s raw card body) so every surface tints
 * variables/tools/tags identically to the app's `PromptHighlightedEditor`.
 * Plain `'text'` tokens render as bare string children (React escapes them,
 * so a literal `"<b>"` in prompt text can never be interpreted as markup).
 */
export function HighlightedTokenSpans({ tokens }: { tokens: readonly PromptToken[] }): React.JSX.Element {
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === 'text') {
          return token.text;
        }
        return (
          <span key={index} data-token-kind={token.kind} className={TOKEN_KIND_CLASSES[token.kind]}>
            {token.text}
          </span>
        );
      })}
    </>
  );
}

// Shared box/typography so the backdrop's text lines up pixel-for-pixel with
// the real textarea underneath. Only the border color differs (transparent
// here vs. the real `border-input`). `scrollbar-gutter: stable` makes both
// layers reserve the same scrollbar space, so a scrolling textarea's classic
// scrollbar cannot make the backdrop wrap lines later (2026-11-11 drift bug,
// same fix as the Sales app's PromptHighlightedEditor).
const SHARED_METRICS_CLASSES =
  'font-mono whitespace-pre-wrap break-words px-2.5 py-2 text-base md:text-sm border border-transparent rounded-lg [scrollbar-gutter:stable]';

// Zero-width space: a trailing '\n' in `value` leaves a final, otherwise-empty
// line which `white-space: pre-wrap` collapses to zero height. One invisible
// character keeps that last line's height so the backdrop's total height
// still matches the (equally-empty-last-line) textarea beneath it.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

export function HighlightedPromptText({
  value,
  onChange,
  tokens,
  rows = 8,
  lineNumbers = false,
  ariaLabel,
  className,
  containerClassName,
  id,
  dataTestId,
}: HighlightedPromptTextProps): React.JSX.Element {
  const lines: PromptToken[][] = [[]];
  if (lineNumbers) {
    for (const token of tokens) {
      const parts = token.text.split('\n');
      parts.forEach((text, index) => {
        if (index) lines.push([]);
        lines[lines.length - 1].push({ ...token, text });
      });
    }
  }
  const numberedPadding = lineNumbers
    ? '[padding-left:calc(var(--prompt-editor-padding-inline,0.625rem)+var(--prompt-editor-gutter))]!'
    : undefined;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const syncScrollFrom = (source: { scrollTop: number; scrollLeft: number }) => {
    if (!backdropRef.current) return;
    backdropRef.current.scrollTop = source.scrollTop;
    backdropRef.current.scrollLeft = source.scrollLeft;
  };

  // Content changes (typing, or the parent swapping in a new draft) can shift
  // which part of the text is in view — re-sync in addition to the live
  // onScroll handler below, which only fires on an actual scroll gesture.
  useEffect(() => {
    if (textareaRef.current) syncScrollFrom(textareaRef.current);
  }, [value, tokens, lineNumbers]);

  const handleScroll: React.UIEventHandler<HTMLTextAreaElement> = (event) => {
    syncScrollFrom(event.currentTarget);
  };

  return (
    <div
      className={cn('relative', containerClassName)}
      data-testid="highlighted-prompt-text-container"
      style={
        lineNumbers
          ? { ['--prompt-editor-gutter' as string]: `${Math.max(3, String(lines.length).length + 1)}ch` }
          : undefined
      }
    >
      <div
        ref={backdropRef}
        aria-hidden="true"
        data-testid="highlighted-prompt-text-backdrop"
        className={cn(
          SHARED_METRICS_CLASSES,
          numberedPadding,
          'pointer-events-none absolute inset-0 overflow-hidden text-foreground',
        )}
      >
        {lineNumbers ? (
          lines.map((line, index) => (
            <div key={index} className="relative">
              <span
                data-testid="prompt-line-number"
                className="absolute select-none text-right text-muted-foreground"
                style={{
                  left: 'calc(-1 * var(--prompt-editor-gutter))',
                  width: 'calc(var(--prompt-editor-gutter) - 1ch)',
                }}
              >
                {index + 1}
              </span>
              <HighlightedTokenSpans tokens={line} />
              {!line.some((part) => part.text.length) ? ZERO_WIDTH_SPACE : null}
            </div>
          ))
        ) : (
          <>
            <HighlightedTokenSpans tokens={tokens} />
            {value.endsWith('\n') ? ZERO_WIDTH_SPACE : null}
          </>
        )}
      </div>
      <MarkdownEditor
        mode="plain"
        value={value}
        onChange={onChange}
        rows={rows}
        ariaLabel={ariaLabel}
        id={id}
        dataTestId={dataTestId}
        textareaRef={textareaRef}
        onScroll={handleScroll}
        className={cn(
          SHARED_METRICS_CLASSES,
          numberedPadding,
          // `relative` makes the real textarea a positioned element so it
          // paints above the absolutely-positioned backdrop (see file header).
          'relative text-transparent caret-foreground selection:bg-primary/20',
          className,
        )}
      />
    </div>
  );
}
