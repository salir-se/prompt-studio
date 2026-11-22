import { Button } from '@prompt-studio/ui/button';
import { Textarea } from '@prompt-studio/ui/textarea';
import { useEffect, useRef, useState } from 'react';

export function VerificationSourceEditor({
  text,
  target,
  onSave,
  onRecheck,
  onDirtyChange,
}: {
  text: string;
  target?: { start: number; end: number; version: number; heading: string };
  onSave?: (text: string) => Promise<void>;
  onRecheck?: (text: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const value = draft?.text ?? text;
  const dirty = !!draft && draft.text !== draft.base;
  const stale = !!draft && text !== draft.base && text !== draft.text;
  useEffect(() => onDirtyChange(dirty || saving), [dirty, saving, onDirtyChange]);
  useEffect(() => {
    if (!target || !field.current) return;
    field.current.focus();
    field.current.setSelectionRange(target.start, target.end);
  }, [target]);

  async function save() {
    if (!onSave || saving || stale || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      setDraft(null);
      setSaved(true);
      onRecheck?.(value);
      field.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      aria-label="Verification source"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div>
        <h3 className="text-sm font-semibold">Source context</h3>
        <p className="mt-1 break-words text-xs text-muted-foreground">
          {target?.heading ?? 'Whole prompt'} · edits apply to the prompt source.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} Your draft is retained.
        </p>
      )}
      {stale && (
        <p role="alert" className="text-sm text-destructive">
          The prompt changed elsewhere. Copy your draft before discarding it to load the latest source.
        </p>
      )}
      <Textarea
        ref={field}
        aria-label="Verification prompt source"
        value={value}
        readOnly={!onSave || saving}
        spellCheck={false}
        onChange={(event) => {
          setDraft({ base: draft?.base ?? text, text: event.target.value });
          setSaved(false);
        }}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            !event.altKey &&
            !event.nativeEvent.isComposing &&
            event.key.toLowerCase() === 's'
          ) {
            event.preventDefault();
            event.stopPropagation();
            void save();
          }
        }}
        className="min-h-64 flex-1 resize-y font-mono text-xs [field-sizing:fixed] lg:resize-none"
      />
      <p role="status" className="text-xs text-muted-foreground">
        {saving
          ? 'Saving source…'
          : dirty
            ? 'Unsaved source · results describe the last checked source'
            : saved
              ? 'Saved and rechecked'
              : 'Current prompt source'}
      </p>
      {onSave && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
          >
            Discard source edit
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!dirty || saving || stale}
            aria-keyshortcuts="Control+S Meta+S"
            onClick={() => void save()}
          >
            Save and recheck
          </Button>
        </div>
      )}
    </section>
  );
}
