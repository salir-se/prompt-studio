import { Button } from '@prompt-studio/ui/button';
import { Textarea } from '@prompt-studio/ui/textarea';
import { useEffect, useRef } from 'react';
import { CloseButton } from '../components/CloseButton';
import { ShortcutControl } from '../shortcuts/ShortcutControl';
import type { ProjectFileEditor } from './use-project-file-editor';

export function ReferencedFileEditor({ editor }: { editor: ProjectFileEditor }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const path = editor.file?.path;
  useEffect(() => {
    if (path) field.current?.focus();
  }, [path]);
  return (
    <section
      aria-label="Referenced file editor"
      className="flex h-full min-h-0 flex-col gap-4 p-5 sm:p-6"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          event.stopPropagation();
          void editor.save();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          editor.close();
        }
      }}
    >
      <header className="min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">Referenced project file</p>
          <CloseButton onClick={editor.close} label="Close file" disabled={editor.saving} />
        </div>
        <h2 className="break-all font-mono text-sm font-semibold">{editor.file?.path ?? 'Open referenced file'}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Edit this file independently. Close to return to the prompt.
        </p>
      </header>
      {editor.loading && (
        <p role="status" className="text-sm">
          Loading project file…
        </p>
      )}
      {editor.error && (
        <p role="alert" className="text-sm text-destructive">
          {editor.error}
        </p>
      )}
      {editor.file && (
        <>
          <Textarea
            ref={field}
            aria-label="Referenced file contents"
            value={editor.draft}
            onChange={(event) => editor.change(event.target.value)}
            readOnly={editor.saving}
            className="min-h-40 flex-1 resize-none rounded-xl bg-muted/10 p-4 font-mono text-sm leading-relaxed [field-sizing:fixed]"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center shrink-0 justify-between gap-3 border-t border-border pt-4">
            <span role="status" className="text-xs text-muted-foreground">
              {editor.saving
                ? 'Saving…'
                : editor.dirty
                  ? 'Unsaved changes'
                  : editor.saved
                    ? 'Saved on this computer'
                    : 'Project file'}{' '}
              · Ctrl / ⌘ + S
            </span>
            <ShortcutControl id={'saveFile'}>
              <Button size="sm" disabled={!editor.dirty || editor.saving} onClick={() => void editor.save()}>
                Save file
              </Button>
            </ShortcutControl>
          </div>
        </>
      )}
    </section>
  );
}
