/**
 * FragmentEditDialog — a transactional markdown-edit dialog for a
 * `FragmentNode` card's section text (ADR-200/ADR-202 prompt graph studio).
 *
 * Transactional by design: the dialog owns its own `draft` state, seeded from
 * `initialText` only at the moment it OPENS (re-seeded on every re-open, so
 * edits from a previous session never leak into the next one — see the
 * `open` transition effect below). Cancel, Escape, and backdrop-click all
 * route through the Dialog's `onOpenChange` to `onCancel`, which discards the
 * draft; only pressing Apply calls `onApply(draft)` and hands the edited text
 * back to the caller. The card that opens this dialog (`FragmentNode`'s
 * future edit button) is another task's scope — this component only knows
 * `open`/`initialText`/`onApply`/`onCancel`.
 *
 * Two read/edit modes, mirroring the app's own Raw/Visual split
 * (`PromptEditor.tsx`'s `EditorSurface`): `raw` (default) is the highlighted
 * overlay editor (`HighlightedPromptText`), tokenized fresh on every keystroke
 * via `tokenizePromptText`; `rendered` is a read-only Markdown preview of the
 * CURRENT DRAFT (not `initialText`) via `@prompt-studio/help-system`'s `Markdown`, so
 * switching modes never silently reverts unsaved edits.
 */

import { Markdown } from '@prompt-studio/help-system';
import { type PromptToken, tokenizePromptText } from '@prompt-studio/prompts';
import { Button } from '@prompt-studio/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@prompt-studio/ui/dialog';
import { cn } from '@prompt-studio/ui/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HighlightedPromptText } from './HighlightedPromptText';

export interface FragmentEditDialogProps {
  open: boolean;
  title: string;
  initialText: string;
  /** Failed Apply guidance; the caller keeps the dialog open so the draft can be recovered. */
  error?: string;
  /** `{{variable}}` names known to the enclosing prompt — feeds the Raw highlighter's violet/amber split. */
  knownVariables?: readonly string[];
  /** Known tool names — feeds the Raw highlighter's sky tinting. */
  toolNames?: readonly string[];
  onApply: (text: string) => void;
  onCancel: () => void;
}

type EditMode = 'raw' | 'rendered';

const DEFAULT_MODE: EditMode = 'raw';
const EDITOR_ROWS = 20;

export function FragmentEditDialog({
  open,
  title,
  initialText,
  error,
  knownVariables,
  toolNames,
  onApply,
  onCancel,
}: FragmentEditDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState(initialText);
  const [mode, setMode] = useState<EditMode>(DEFAULT_MODE);

  // Re-seed the draft (and reset back to Raw) on every OPEN transition — never
  // on an `initialText` change while closed, and never on a re-render while
  // already open (which would clobber in-progress edits). `wasOpenRef` tracks
  // the previous `open` value across renders so only the false→true edge
  // fires the reseed; it's a ref rather than derived state because this must
  // observe the transition itself, not just the current value.
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setDraft(initialText);
      setMode(DEFAULT_MODE);
    }
    wasOpenRef.current = open;
  }, [open, initialText]);

  const tokens = useMemo<PromptToken[]>(
    () => tokenizePromptText(draft, { variables: knownVariables ?? [], tools: toolNames ?? [] }),
    [draft, knownVariables, toolNames],
  );

  const isUnchanged = draft === initialText;

  // Escape / backdrop click / the Dialog's own close button all surface here
  // as `onOpenChange(false)` — every one of those exits is a cancel (discard
  // the draft), never an implicit apply. `open` itself stays fully controlled
  // by the caller; this component never sets it, only reports the intent.
  const handleOpenChange = (next: boolean): void => {
    if (!next) onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[85vh] w-[95vw] max-w-3xl flex-col gap-3" data-testid="fragment-edit-dialog">
        <DialogHeader className="shrink-0 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Edit this section's markdown in Raw mode, or switch to Rendered to preview it, then Apply to save or Cancel
            to discard.
          </DialogDescription>
        </DialogHeader>

        {/* Raw / Rendered segmented toggle — same visual vocabulary as the app's
            Raw/Visual toggle (PromptEditor.tsx, MarkdownEditor's Visual/Raw buttons). */}
        <div className="flex shrink-0 justify-end">
          <div className="inline-flex rounded-md border p-0.5">
            {(['raw', 'rendered'] as const).map((candidate) => (
              <Button
                key={candidate}
                type="button"
                size="sm"
                variant={mode === candidate ? 'secondary' : 'ghost'}
                aria-pressed={mode === candidate}
                className="h-7 px-3 text-xs"
                onClick={() => setMode(candidate)}
              >
                {candidate === 'raw' ? 'Raw' : 'Rendered'}
              </Button>
            ))}
          </div>
        </div>

        {/* Editor body — the wrapper HighlightedPromptText renders via
            `containerClassName` becomes the actual flex-1 item here (it nests
            the real textarea one level deeper), matching the pattern the app's
            own full-screen prompt dialog uses so the editor scrolls internally
            instead of growing the whole dialog past its fixed height. */}
        {mode === 'raw' ? (
          <HighlightedPromptText
            value={draft}
            onChange={setDraft}
            tokens={tokens}
            rows={EDITOR_ROWS}
            ariaLabel={`${title} markdown`}
            className="h-full overflow-y-auto focus-visible:ring-inset"
            containerClassName="min-h-0 flex-1 overflow-hidden"
          />
        ) : (
          <div
            data-testid="fragment-edit-dialog-rendered"
            className={cn('min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-3 text-sm')}
          >
            <Markdown text={draft} />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onApply(draft)} disabled={isUnchanged}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
