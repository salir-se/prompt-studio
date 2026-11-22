/**
 * The universal content editor (ADR-096) — ONE component for every multi-line
 * content-editing surface in the monorepo, behind one API:
 *
 *   - `mode="markdown"` (default): Milkdown Crepe WYSIWYG, lazy-loaded so
 *     prosemirror stays out of initial bundles, with a Visual ⇄ Raw toggle —
 *     Raw is the same verbatim textarea, for hand-editing markdown source or
 *     pasting big documents (and the friendlier surface on small phones).
 *     While the chunk loads — or if it ever fails to load — the textarea
 *     stands in, so authoring never hard-blocks on a network hiccup.
 *   - `mode="plain"`: a verbatim-safe textarea in the same shell. BYTE
 *     TRANSPARENT — no markdown normalization, no escaping. This is the
 *     required mode for content where exact text matters: Liquid email
 *     templates (`{{ var }}`, `{% if %}`), LLM system prompts, raw HTML.
 *     Running those through a markdown round-trip would corrupt them.
 *
 * Value contract: `plain` is fully controlled. `markdown` treats `value` as
 * the initial document (Crepe owns the state and streams edits back via
 * `onChange`); to REPLACE the document from outside (switching items, file
 * upload), bump `contentKey` to remount the editor. The Raw view is always
 * controlled, so switching Raw → Visual reloads Crepe with the latest value.
 */

import { Button } from '@prompt-studio/ui/button';
import { Textarea } from '@prompt-studio/ui/textarea';
import { Component, lazy, type ReactNode, Suspense, useState } from 'react';
import { useMarkdownEditorPolicy } from './markdown-editor-policy';
import type { Fidelity, RequiredFidelity } from './markdown-fidelity';

/** A Visual round trip that falls short of a field's requirement (never `exact`). */
type FallbackReason = Exclude<Fidelity, 'exact'>;

const LazyCrepe = lazy(() => import('./MilkdownCrepeEditor'));

/** `prose` = Markdown prose written by a person (notes, summaries, replies): the Visual editor while the
 *  Visual prose policy is on, else the plain text box. */
export type MarkdownEditorMode = 'markdown' | 'plain' | 'prose';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** `markdown` = WYSIWYG (default); `plain` = verbatim-safe textarea. */
  mode?: MarkdownEditorMode;
  /** Remount discriminator for `markdown` mode — change it to load a new
   *  document (e.g. the selected item's id, or a counter bumped on upload). */
  contentKey?: string | number;
  /** What the Visual view must keep of this field's text while the keep-author-text policy is on: `equivalent`
   *  (default) = the same Markdown meaning; `exact` = the same bytes (prompts, templates). A text the Visual view
   *  would not keep opens in Raw with a message. Ignored in `plain` mode and while the policy is off. */
  requiredFidelity?: RequiredFidelity;
  placeholder?: string;
  /** Textarea rows (plain mode + raw view + markdown fallback). Also sets the
   *  WYSIWYG's minimum height so both views occupy similar space. */
  rows?: number;
  /** Enforced natively in plain mode only; markdown consumers enforce on save. */
  maxLength?: number;
  readOnly?: boolean;
  ariaLabel?: string;
  /** Forwarded to the plain-mode textarea so `<Label htmlFor>` keeps working;
   *  in markdown mode it lands on the wrapper element. */
  id?: string;
  /** Forwarded as `data-testid` (same placement rule as `id`). */
  dataTestId?: string;
  className?: string;
  /** Ref to the underlying `<textarea>` DOM node — plain-mode overlay support
   *  (highlight backdrops need the real textarea node + scroll mirroring).
   *  Forwarded in both places the textarea renders (plain mode and the
   *  markdown-mode Raw view). */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  /** Scroll handler forwarded to the underlying `<textarea>` — plain-mode
   *  overlay support (highlight backdrops need the real textarea node +
   *  scroll mirroring). */
  onScroll?: React.UIEventHandler<HTMLTextAreaElement>;
}

interface EditorChunkBoundaryState {
  failed: boolean;
}

/** Degrades to the plain textarea when the lazy milkdown chunk fails to load
 *  or throws at render — the safe-fallback rule applied to authoring. Small
 *  internal boundary instead of a react-error-boundary dependency. */
class EditorChunkBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, EditorChunkBoundaryState> {
  state: EditorChunkBoundaryState = { failed: false };

  static getDerivedStateFromError(): EditorChunkBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn('[markdown-editor] WYSIWYG editor failed to load; using the plain editor', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Why a field opened in Raw: the Visual view would change its meaning, or only reformat it. */
const FALLBACK_MESSAGES: Record<FallbackReason, string> = {
  changed:
    'The Visual view would change what this text says, so it opened in Raw. Choose Visual to edit it there anyway.',
  equivalent:
    'The Visual view would reformat this text (spacing or list markers), so it opened in Raw. Choose Visual to edit it there anyway.',
};

export function MarkdownEditor({
  value,
  onChange,
  mode: requestedMode = 'markdown',
  contentKey,
  requiredFidelity = 'equivalent',
  placeholder,
  rows = 8,
  maxLength,
  readOnly,
  ariaLabel,
  id,
  dataTestId,
  className,
  textareaRef,
  onScroll,
}: MarkdownEditorProps) {
  // Visual ⇄ Raw toggle (markdown mode only). `visualEpoch` bumps every time
  // the author returns to Visual so Crepe remounts seeded with the edits made
  // in Raw — the parent's `value` is the single source of truth across views.
  const [view, setView] = useState<'visual' | 'raw'>('visual');
  const [visualEpoch, setVisualEpoch] = useState(0);
  // Keep the author's text: a document the Visual view would change falls back to Raw (per document, so a new
  // `contentKey` is measured again); choosing Visual after that opens it on purpose, without measuring again.
  const { keepAuthorText, visualProse } = useMarkdownEditorPolicy();
  const mode = requestedMode === 'prose' ? (visualProse ? 'markdown' : 'plain') : requestedMode;
  const documentKey = String(contentKey ?? 'doc');
  const [fallback, setFallback] = useState<{ documentKey: string; measured: FallbackReason } | null>(null);
  const [visualOnPurpose, setVisualOnPurpose] = useState<string | null>(null);
  const activeFallback = fallback?.documentKey === documentKey ? fallback : null;
  const keepText =
    keepAuthorText && visualOnPurpose !== documentKey
      ? {
          required: requiredFidelity,
          onWouldChange: (measured: FallbackReason) => {
            setFallback({ documentKey, measured });
            setView('raw');
          },
        }
      : undefined;

  const textarea = (
    <Textarea
      ref={textareaRef}
      id={mode === 'plain' ? id : undefined}
      data-testid={mode === 'plain' ? dataTestId : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onScroll={onScroll}
      placeholder={placeholder}
      rows={rows}
      maxLength={maxLength}
      readOnly={readOnly}
      aria-label={ariaLabel}
      className={mode === 'plain' ? className : 'rounded-none border-0 focus-visible:ring-0'}
    />
  );

  if (mode === 'plain') return textarea;

  const showRaw = (which: 'visual' | 'raw') => {
    if (which === view) return;
    if (which === 'visual') {
      setVisualEpoch((n) => n + 1);
      if (activeFallback) {
        setVisualOnPurpose(documentKey);
        setFallback(null);
      }
    }
    setView(which);
  };

  return (
    <div id={id} data-testid={dataTestId} className={className} data-mode="markdown">
      <div className="mb-1 flex justify-end">
        <div className="inline-flex rounded-md border p-0.5">
          <Button
            type="button"
            size="sm"
            variant={view === 'visual' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'visual'}
            className="h-6 px-2 text-xs"
            onClick={() => showRaw('visual')}
          >
            Visual
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'raw' ? 'secondary' : 'ghost'}
            aria-pressed={view === 'raw'}
            className="h-6 px-2 text-xs"
            onClick={() => showRaw('raw')}
          >
            Raw
          </Button>
        </div>
      </div>
      {view === 'raw' && activeFallback ? (
        <p role="status" className="mb-1 text-xs text-muted-foreground">
          {FALLBACK_MESSAGES[activeFallback.measured]}
        </p>
      ) : null}
      <div
        className="salir-markdown-editor"
        style={{ '--salir-editor-min-height': `${Math.max(rows, 3) * 1.5}rem` } as React.CSSProperties}
      >
        {view === 'raw' ? (
          textarea
        ) : (
          <EditorChunkBoundary fallback={textarea}>
            <Suspense fallback={textarea}>
              <LazyCrepe
                key={`${contentKey ?? 'doc'}:${visualEpoch}`}
                defaultValue={value}
                onChange={onChange}
                placeholder={placeholder}
                readOnly={readOnly}
                keepText={keepText}
              />
            </Suspense>
          </EditorChunkBoundary>
        )}
      </div>
    </div>
  );
}
