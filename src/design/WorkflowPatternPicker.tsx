import { MermaidDiagram } from '@prompt-studio/prompt-graph-ui';
import { Button } from '@prompt-studio/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@prompt-studio/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@prompt-studio/ui/tabs';
import { useState } from 'react';
import { ShortcutControl } from '../shortcuts/ShortcutControl';
import { WORKFLOW_PATTERNS } from './workflow-patterns';

export function WorkflowPatternPicker({
  onUse,
  currentWorkflow,
}: {
  onUse: (graph: string) => void;
  currentWorkflow?: string;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string>(WORKFLOW_PATTERNS[0].id);
  const pattern = WORKFLOW_PATTERNS.find((item) => item.id === id) ?? WORKFLOW_PATTERNS[0];
  function applyPattern() {
    onUse(pattern.graph);
    setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" data-workflow-picker>
          Choose pattern
        </Button>
      </DialogTrigger>
      <DialogContent
        className="studio studio-pattern-dialog flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-5xl"
        aria-label="Workflow patterns"
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            !event.altKey &&
            !event.repeat &&
            !event.nativeEvent.isComposing &&
            event.key === 'Enter'
          ) {
            event.preventDefault();
            event.stopPropagation();
            applyPattern();
          }
        }}
      >
        <DialogTitle className="text-2xl tracking-tight">Choose a workflow pattern</DialogTitle>
        <DialogDescription>Preview with a click or arrow keys. Use with Ctrl / ⌘ + Enter.</DialogDescription>
        <Tabs
          value={id}
          onValueChange={setId}
          orientation="vertical"
          className="min-h-0 flex-col overflow-y-auto sm:flex-row"
        >
          <TabsList
            aria-label="Workflow patterns"
            className="max-h-48 w-full shrink-0 overflow-y-auto sm:max-h-[55dvh] sm:w-60"
          >
            {WORKFLOW_PATTERNS.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="min-h-11 justify-start px-3 text-left text-sm data-[state=active]:border-primary data-[state=active]:bg-accent data-[state=active]:font-semibold"
              >
                {item.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {WORKFLOW_PATTERNS.map((item) => (
            <TabsContent key={item.id} value={item.id} className="min-w-0 space-y-3">
              <div className="space-y-2 px-1">
                <h3 className="text-lg font-semibold tracking-tight">{item.name}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
              </div>
              <section
                className="min-w-0 overflow-x-auto rounded-xl border bg-muted/20 p-5"
                aria-label={`${item.name} graph preview`}
              >
                <MermaidDiagram code={item.graph} />
              </section>
              <p className="text-xs text-muted-foreground">
                Inserts an editable design. Agent execution and limits must be implemented by the host.
              </p>
            </TabsContent>
          ))}
        </Tabs>
        {currentWorkflow?.trim() && currentWorkflow.trim() !== pattern.graph.trim() && (
          <p
            role="note"
            className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed"
          >
            Using this pattern replaces your current workflow draft. Cancel to keep your existing diagram.
          </p>
        )}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <a href={pattern.source} target="_blank" rel="noreferrer" className="text-xs underline">
            Pattern reference
          </a>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <ShortcutControl id={'usePattern'}>
              <Button type="button" size="sm" onClick={applyPattern} aria-keyshortcuts="Control+Enter Meta+Enter">
                Use pattern
              </Button>
            </ShortcutControl>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
