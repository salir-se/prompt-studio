import { MarkdownWithMermaid } from '@prompt-studio/prompt-graph-ui';
import { Button } from '@prompt-studio/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@prompt-studio/ui/tabs';
import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { type Ref, useImperativeHandle, useRef, useState } from 'react';
import { PromptComposer, type PromptComposerHandle } from '../composing/PromptComposer';
import { ShortcutControl } from '../shortcuts/ShortcutControl';

export interface PromptWriterProps {
  ref?: Ref<PromptComposerHandle>;
  text: string;
  dirty: boolean;
  stale?: boolean;
  variables: readonly string[];
  tools: readonly string[];
  workflow?: string;
  onChange: (text: string) => void;
  onApply: () => void;
  onDiscard: () => void;
}

export function PromptWriter({
  text,
  dirty,
  stale,
  variables,
  tools,
  workflow,
  onChange,
  onApply,
  onDiscard,
  ref,
}: PromptWriterProps) {
  const [preview, setPreview] = useState(false);
  const composer = useRef<PromptComposerHandle>(null);
  useImperativeHandle(ref, () => ({
    revealSection(id, focus) {
      setPreview(false);
      requestAnimationFrame(() => composer.current?.revealSection(id, focus));
    },
  }));
  return (
    <section
      aria-label="Write prompt"
      className="studio-writer flex min-h-0 flex-1 flex-col bg-background"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.repeat) return;
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        if ((event.metaKey || event.ctrlKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) {
          event.preventDefault();
          if (!stale) onApply();
        }
      }}
    >
      <Tabs
        value={preview ? 'preview' : 'markdown'}
        onValueChange={(value) => setPreview(value === 'preview')}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
          <div className="hidden sm:block">
            <h2 className="text-base font-semibold tracking-tight">Prompt instructions</h2>
            <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
              Write what the model should do. Use {'{{variables}}'} for reusable inputs.
            </p>
          </div>
          <TabsList aria-label="Writing mode" variant="pill">
            <TabsTrigger value="markdown" data-prompt-markdown-tab>
              Markdown
            </TabsTrigger>
            <TabsTrigger value="preview">Preview draft</TabsTrigger>
          </TabsList>
        </div>
        {stale && (
          <p
            role="alert"
            className="border-b border-border bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            The saved prompt changed. Copy your draft before discarding it to load the latest text.
          </p>
        )}
        {preview && (
          <TabsContent value="preview" className="studio-writing-preview flex min-h-0 flex-1 flex-col">
            <TimelineScrollRegion className="min-h-0 flex-1" viewportClassName="p-4 sm:p-6">
              <div className="studio-document-preview">
                <MarkdownWithMermaid text={text} />
              </div>
            </TimelineScrollRegion>
          </TabsContent>
        )}
        <TabsContent
          forceMount
          hidden={preview}
          value="markdown"
          className={preview ? 'hidden' : 'flex min-h-0 flex-1 flex-col overflow-hidden'}
        >
          <PromptComposer
            ref={composer}
            text={text}
            onChange={onChange}
            variables={variables}
            tools={tools}
            workflow={workflow}
          />
        </TabsContent>
      </Tabs>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 sm:px-6">
        <p role="status" className="text-xs text-muted-foreground">
          {dirty ? 'Draft changes · apply to save and review' : 'All writing changes applied'}
          <span className="ml-2 hidden sm:inline">Ctrl / ⌘ + S to apply</span>
        </p>
        <div className="flex gap-2">
          <Button type="button" disabled={!dirty} onClick={onDiscard} variant="outline">
            Discard draft
          </Button>
          <ShortcutControl id="apply">
            <Button type="button" disabled={!dirty || stale} onClick={onApply}>
              Apply changes
            </Button>
          </ShortcutControl>
        </div>
      </footer>
    </section>
  );
}
