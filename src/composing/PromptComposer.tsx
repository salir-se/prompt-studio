import { HighlightedPromptText } from '@prompt-studio/prompt-graph-ui';
import { type PromptTreeNode, tokenizePromptText } from '@prompt-studio/prompts';
import { Button } from '@prompt-studio/ui/button';
import { Combobox, ComboboxInput, ComboboxItem, ComboboxList } from '@prompt-studio/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@prompt-studio/ui/dialog';
import { ListOrdered, ListTree, Plus, Workflow } from '@prompt-studio/ui/icons';
import { Input } from '@prompt-studio/ui/input';
import { Label } from '@prompt-studio/ui/label';
import { Popover } from '@prompt-studio/ui/popover';
import { type Ref, useImperativeHandle, useMemo, useState } from 'react';
import { ShortcutControl } from '../shortcuts/ShortcutControl';
import { ToolbarButton } from '../shortcuts/ToolbarButton';
import { useShortcutEducation } from '../shortcuts/shortcut-context';
import { CompletionMenu } from './CompletionMenu';
import { useComposing } from './use-composing';

export interface PromptComposerHandle {
  revealSection: (id: string, focus?: boolean) => void;
}

export function PromptComposer({
  text,
  variables,
  tools,
  workflow,
  onChange,
  ref,
}: {
  text: string;
  variables: readonly string[];
  tools: readonly string[];
  workflow?: string;
  onChange: (text: string) => void;
  ref?: Ref<PromptComposerHandle>;
}) {
  const { lineNumbers, setLineNumbers } = useShortcutEducation();
  const composer = useComposing(text, variables, workflow, onChange);
  useImperativeHandle(ref, () => ({
    revealSection(id, focus = true) {
      const previousFocus = document.activeElement;
      const section = composer.sections.find((item) => item.id === id);
      if (section) composer.jump(section);
      if (!focus && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    },
  }));
  const matches = composer.sections.filter((section) =>
    section.title.toLowerCase().includes(composer.query.toLowerCase()),
  );
  const [name, setName] = useState('');
  const tokens = useMemo(() => tokenizePromptText(text, { variables, tools }), [text, variables, tools]);
  const validName = /^[A-Za-z][A-Za-z0-9_]*$/.test(name);
  const step = composer.guide?.steps.find((item) => item.tag === composer.active?.tag);
  function insert(child: boolean) {
    composer.insert(name, child);
    composer.setInsertOpen(false);
    setName('');
  }
  return (
    <fieldset
      ref={composer.container}
      aria-label="Prompt composing"
      onBlur={(event) => {
        if (event.target instanceof HTMLTextAreaElement) composer.blur();
      }}
      onFocus={(event) => {
        if (event.target instanceof HTMLTextAreaElement) composer.track();
      }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={composer.keyDown}
      onSelect={(event) => {
        if (event.target instanceof HTMLTextAreaElement) composer.track();
      }}
      onCompositionStart={composer.startComposition}
      onCompositionEnd={composer.endComposition}
    >
      <fieldset
        className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1.5 sm:px-5"
        aria-label="Composing tools"
      >
        <ToolbarButton
          type="button"
          variant="ghost"
          label="Sections"
          count={composer.sections.length}
          icon={<ListTree className="size-4" />}
          shortcut="jump"
          onClick={composer.openJump}
        />
        <Popover.Root open={composer.insertOpen} onOpenChange={composer.setInsertOpen}>
          <Popover.Trigger
            render={
              <ToolbarButton
                type="button"
                variant="ghost"
                label="+ Section"
                icon={<Plus className="size-4" />}
                shortcut="addSection"
              />
            }
          />
          <Popover.Portal>
            <Popover.Positioner align="start" sideOffset={6} className="z-52">
              <Popover.Popup
                className="studio rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg w-[min(22rem,calc(100vw-2rem))] space-y-3"
                finalFocus={() => composer.container.current?.querySelector('textarea') ?? false}
              >
                <form
                  onKeyDown={(event) => {
                    if (
                      !event.nativeEvent.isComposing &&
                      !event.repeat &&
                      (event.ctrlKey || event.metaKey) &&
                      event.key === 'Enter'
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      if (validName && composer.active) insert(true);
                    }
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (validName) insert(false);
                  }}
                >
                  <Label htmlFor={`${composer.listId}-name`}>Section name</Label>
                  <Input
                    id={`${composer.listId}-name`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. constraints"
                    autoComplete="off"
                    className="mt-2"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Letters, numbers and underscores. Enter adds a section; Ctrl / ⌘ + Enter adds a subsection.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={!validName}>
                      Add section
                    </Button>
                    <ShortcutControl id="addSubsection">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!validName || !composer.active}
                        aria-keyshortcuts="Control+Enter Meta+Enter"
                        onClick={() => insert(true)}
                      >
                        Add subsection
                      </Button>
                    </ShortcutControl>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {composer.active ? `Beside or inside ${composer.active.title}` : 'At the end of this prompt'}
                  </p>
                </form>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <Popover.Root open={composer.stepsOpen} onOpenChange={composer.setStepsOpen}>
          <Popover.Trigger
            render={
              <ToolbarButton
                type="button"
                variant="ghost"
                label="Workflow steps"
                icon={<Workflow className="size-4" />}
                shortcut="workflow"
              />
            }
          />
          <Popover.Portal>
            <Popover.Positioner align="start" sideOffset={6} className="z-52">
              <Popover.Popup
                className="studio rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg max-h-[65dvh] w-[min(25rem,calc(100vw-2rem))] overflow-y-auto"
                finalFocus={() => composer.container.current?.querySelector('textarea') ?? false}
              >
                <h3 className="text-sm font-semibold">{composer.guide?.pattern.name ?? 'Workflow instructions'}</h3>
                <p className="my-2 text-xs text-muted-foreground">
                  {composer.guide
                    ? 'Add or open each step in your prompt. Your instructions are saved with the source; this does not run agents.'
                    : 'Choose a built-in pattern in Design to get step guidance. For a custom workflow, add sections with your own step instructions.'}
                </p>
                <div className="space-y-1">
                  {composer.guide?.steps.map((item) => {
                    const exists = composer.sections.some((section) => section.tag === item.tag);
                    return (
                      <Button
                        key={item.id}
                        type="button"
                        variant="ghost"
                        className="h-auto w-full items-start justify-start whitespace-normal px-2 py-3 text-left"
                        onClick={() => {
                          composer.fillStep(item.id);
                          composer.setStepsOpen(false);
                        }}
                      >
                        <span>
                          <span className="block font-medium">
                            {item.title}{' '}
                            <span className="font-normal text-muted-foreground">
                              · {exists ? 'Open instructions' : 'Add instructions'}
                            </span>
                          </span>
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">{item.hint}</span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        <ToolbarButton
          type="button"
          variant={lineNumbers ? 'secondary' : 'ghost'}
          label="Line numbers"
          icon={<ListOrdered className="size-4" />}
          aria-pressed={lineNumbers}
          onClick={() => setLineNumbers(!lineNumbers)}
        />
        <span className="ml-auto hidden truncate text-xs text-muted-foreground lg:block" title={composer.active?.title}>
          {step ? `${step.title}: ${step.hint}` : 'Ctrl + Space · suggestions'}
        </span>
      </fieldset>
      {step && (
        <p className="studio-composing-hint shrink-0 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{step.title}: </span>
          {step.hint}
        </p>
      )}
      {composer.error && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {composer.error}
        </p>
      )}
      <HighlightedPromptText
        value={text}
        onChange={(value) => {
          onChange(value);
          composer.track();
        }}
        tokens={tokens}
        lineNumbers={lineNumbers}
        rows={20}
        ariaLabel="Prompt markdown"
        containerClassName="studio-writing-sheet m-4 min-h-0 flex-1 sm:m-6"
        className="h-full min-h-0 resize-none overflow-auto"
      />
      <p className="studio-editor-key-hint shrink-0 px-4 pb-2 text-xs text-muted-foreground sm:px-6">
        Tab indents · Shift+Tab outdents · Esc then Tab leaves the editor
      </p>
      {composer.suggestions.length > 0 && (
        <CompletionMenu
          getEditor={composer.editor}
          text={text}
          caret={composer.caret}
          id={composer.listId}
          suggestions={composer.suggestions}
          selected={composer.selected}
          accept={composer.accept}
          dismiss={composer.blur}
        />
      )}
      <Dialog open={composer.jumpOpen} onOpenChange={composer.setJumpOpen}>
        <DialogContent
          className="studio overflow-hidden p-0 sm:max-w-lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            composer.container.current?.querySelector('textarea')?.focus();
          }}
        >
          <DialogTitle className="px-4 pt-4">Jump to section</DialogTitle>
          <DialogDescription className="px-4 text-xs">
            Search the current draft. Alt + ↑ / ↓ moves between sections in the editor.
          </DialogDescription>
          <Combobox<PromptTreeNode>
            inline
            open
            items={matches}
            filter={null}
            autoHighlight
            itemToStringLabel={(section) => section.title}
            onInputValueChange={composer.setQuery}
            onValueChange={(section) => {
              if (section) composer.jump(section);
            }}
          >
            <ComboboxInput placeholder="Find section…" aria-label="Find section" showTrigger={false} className="mx-4" />
            <ComboboxList className="max-h-[50dvh]">
              {(section) => (
                <ComboboxItem key={section.id} value={section}>
                  <span style={{ paddingLeft: Math.min(section.depth - 1, 5) * 12 }} className="truncate">
                    {section.title}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Line {text.slice(0, section.range.start).split('\n').length}
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
            {matches.length === 0 && (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                No sections match. Add a section to organize this prompt.
              </p>
            )}
          </Combobox>
        </DialogContent>
      </Dialog>
    </fieldset>
  );
}
