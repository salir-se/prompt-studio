import { validateMermaidDiagram } from '@prompt-studio/prompt-graph-ui';
import { PROMPT_WORKFLOW_TEMPLATE } from '@prompt-studio/prompts';
import { Button } from '@prompt-studio/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@prompt-studio/ui/dialog';
import { Input } from '@prompt-studio/ui/input';
import { Textarea } from '@prompt-studio/ui/textarea';
import { useEffect, useRef, useState } from 'react';
import { WorkflowPatternPicker } from '../design/WorkflowPatternPicker';
import type { ProjectDefinitions } from '../prompt-repo/project-definitions';
import { resolveProjectReference } from '../references-resolver';
import { ShortcutControl } from '../shortcuts/ShortcutControl';
import { AdoptionDependencies } from './AdoptionDependencies';
import {
  type AdoptionAttachment,
  type AdoptionExisting,
  type AdoptionResult,
  type AdoptionTool,
  buildAdoption,
  inspectAdoption,
} from './adopt-prompt';
import { readAdoptionFiles } from './read-adoption-files';

export interface AdoptionInitial {
  text: string;
  filename: string;
  existing?: AdoptionExisting;
}
export interface AdoptPromptDialogProps {
  initial?: AdoptionInitial;
  definitions: ProjectDefinitions;
  existingIds: readonly string[];
  projectFiles?: readonly string[];
  onAdopt: (result: AdoptionResult) => Promise<void>;
  onClose: () => void;
}

export function AdoptPromptDialog({
  initial,
  definitions,
  existingIds,
  projectFiles = [],
  onAdopt,
  onClose,
}: AdoptPromptDialogProps) {
  const [intake, setIntake] = useState({
    text: initial?.text ?? '',
    filename: initial?.filename ?? 'imported-prompt.md',
  });
  const [attachments, setAttachments] = useState<AdoptionAttachment[]>([]);
  const [variables, setVariables] = useState<Record<string, { purpose: string; sample: string }>>({});
  const [tools, setTools] = useState<AdoptionTool[]>(() => {
    const known = initial?.existing?.design?.tools.map((name) => ({ name, description: '', schema: '{}' })) ?? [];
    return known.length ? known : [{ name: '', description: '', schema: '{"type":"object","properties":{}}' }];
  });
  const [input, setInput] = useState(initial?.existing?.design?.input.description ?? '');
  const [output, setOutput] = useState(initial?.existing?.design?.output.description ?? '');
  const [workflow, setWorkflow] = useState(initial?.existing?.design?.workflow ?? PROMPT_WORKFLOW_TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const inputField = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const source = inspectAdoption(intake.text, intake.filename, existingIds, initial?.existing);
  const folder = source.path.slice(0, source.path.lastIndexOf('/'));
  const files = [...projectFiles, ...attachments.map((file) => `${folder}/${file.path}`)];
  const dirty = changed || attachments.length > 0;
  useEffect(() => {
    if (!dirty) return;
    function guard(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function close() {
    if (!busy && (!dirty || window.confirm('Discard this adoption draft? Your saved prompt will stay as it is.')))
      onClose();
  }
  async function choose(files: readonly File[]) {
    if (dirty && !window.confirm('Replace this adoption draft with the selected files?')) return;
    setBusy(true);
    try {
      const next = await readAdoptionFiles(files);
      setIntake(next);
      setAttachments(next.attachments);
      setChanged(true);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = buildAdoption({ source, definitions, variables, tools, input, output, workflow, attachments });
      const valid = await validateMermaidDiagram(workflow);
      if (!valid.valid) throw new Error('Check the workflow Mermaid diagram before saving.');
      await onAdopt(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      requestAnimationFrame(() => alert.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="studio studio-adoption-dialog flex max-h-[92dvh] flex-col overflow-hidden bg-card sm:max-w-6xl"
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          opener.current = document.activeElement as HTMLElement;
          const reviewTarget = window.matchMedia('(min-width: 768px)').matches
            ? inputField.current
            : reviewHeading.current;
          (initial?.text ? reviewTarget : sourceInput.current)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-tight">
            {initial?.existing ? 'Adapt this document' : 'Add an existing prompt'}
          </DialogTitle>
          <DialogDescription>
            Keep your source. Review sections, dependencies and contracts together, then save and verify.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onChange={() => setChanged(true)}
          onKeyDown={(event) => {
            // Portaled picker dialogs own their shortcuts.
            if ((event.target as Element).closest('[role="dialog"]') !== event.currentTarget.closest('[role="dialog"]'))
              return;
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        >
          <div className="min-h-0 overflow-y-auto px-1 pb-1 md:overflow-hidden">
            <fieldset
              disabled={busy}
              className="grid min-h-0 min-w-0 gap-4 md:h-[min(65dvh,680px)] md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
            >
              <section
                aria-label="Source"
                className="flex min-h-0 min-w-0 flex-col gap-3 rounded-xl border border-border bg-muted/15 p-4 md:overflow-y-auto"
              >
                <h3 className="text-sm font-semibold">Source</h3>
                <p className="break-all text-xs text-muted-foreground">
                  {source.title} · {source.path}
                </p>
                {!initial?.existing && (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                      Choose prompt file
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => folderInput.current?.click()}>
                      Choose skill folder
                    </Button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".md,.txt"
                      hidden
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        event.target.value = '';
                        if (files.length) void choose(files);
                      }}
                    />
                    <input
                      ref={folderInput}
                      type="file"
                      {...{ webkitdirectory: '' }}
                      multiple
                      hidden
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        event.target.value = '';
                        if (files.length) void choose(files);
                      }}
                    />
                  </div>
                )}
                <label htmlFor="adoption-source" className="flex min-h-0 flex-1 flex-col gap-1 text-xs font-medium">
                  Existing prompt
                  <Textarea
                    ref={sourceInput}
                    id="adoption-source"
                    aria-label="Existing prompt"
                    spellCheck={false}
                    rows={6}
                    className="min-h-64 flex-1 resize-none font-mono text-xs [field-sizing:fixed]"
                    value={intake.text}
                    onChange={(event) => setIntake({ ...intake, text: event.target.value })}
                    placeholder="Paste a prompt or SKILL.md…"
                  />
                </label>
              </section>
              <section aria-label="Review" className="min-h-0 min-w-0 space-y-5 md:overflow-y-auto md:px-2">
                <h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-offset-2">
                  Review
                </h3>
                {!intake.text.trim() && (
                  <p className="text-sm text-muted-foreground">
                    Paste a prompt or choose a file to review its structure and dependencies.
                  </p>
                )}
                {intake.text.trim() && (
                  <>
                    <div className="space-y-2 rounded-xl border border-border bg-muted/25 p-4 text-xs">
                      <p className="text-xs font-medium text-muted-foreground">
                        {initial?.existing ? 'Updating this document' : 'What will be added'}
                      </p>
                      <h4 className="text-base font-semibold tracking-tight">{source.title}</h4>
                      <p className="break-all font-mono text-muted-foreground">{source.path}</p>
                      <p className="font-medium">
                        {source.sections.length} native sections · {source.variables.length}{' '}
                        {source.variables.length === 1 ? 'variable' : 'variables'} · {source.references.length} file{' '}
                        {source.references.length === 1 ? 'reference' : 'references'}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {source.sections.map((section) => section.title).join(' · ') ||
                          'This document will use the whole-prompt contract.'}{' '}
                        Section contracts and checks are initialized automatically.
                      </p>
                      <p className="text-muted-foreground">
                        {
                          source.variables.filter((name) => definitions.variables.some((entry) => entry.name === name))
                            .length
                        }{' '}
                        variables reused ·{' '}
                        {
                          source.variables.filter((name) => !definitions.variables.some((entry) => entry.name === name))
                            .length
                        }{' '}
                        variables to define
                      </p>
                      {source.references.some(
                        (reference) => resolveProjectReference(reference.path, source.path, files).state !== 'Found',
                      ) && (
                        <p className="font-medium text-amber-700 dark:text-amber-300">
                          Some file references need attention. Review their status below before saving.
                        </p>
                      )}
                      {source.diagnostics.map((finding) => (
                        <p key={`${finding.code}:${finding.range?.start ?? finding.message}`} className="mt-1">
                          {finding.message}
                        </p>
                      ))}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label htmlFor="adoption-input" className="grid gap-1 text-xs font-medium">
                        What goes in?
                        <Input
                          ref={inputField}
                          id="adoption-input"
                          aria-label="Adoption input"
                          value={input}
                          onChange={(event) => setInput(event.target.value)}
                          placeholder="A document and the user's question"
                        />
                      </label>
                      <label htmlFor="adoption-output" className="grid gap-1 text-xs font-medium">
                        What comes out?
                        <Input
                          id="adoption-output"
                          aria-label="Adoption output"
                          value={output}
                          onChange={(event) => setOutput(event.target.value)}
                          placeholder="A concise, sourced summary"
                        />
                      </label>
                    </div>
                    <AdoptionDependencies
                      names={source.variables}
                      variables={variables}
                      tools={tools}
                      definitions={definitions}
                      onVariable={(name, value) => setVariables({ ...variables, [name]: value })}
                      onTools={setTools}
                    />
                    {(source.references.length > 0 || attachments.length > 0) && (
                      <fieldset className="min-w-0 rounded-lg border p-3 text-xs">
                        <legend className="px-1 font-medium">File references</legend>
                        <ul className="space-y-1">
                          {source.references.map((reference) => (
                            <li className="break-all" key={reference.path}>
                              <code>{reference.path}</code> ·{' '}
                              <span className="font-medium">
                                {resolveProjectReference(reference.path, source.path, files).state}
                              </span>{' '}
                              · {reference.loadBeforeBody ? 'Load before prompt (@)' : 'Reference'}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-muted-foreground">
                          {attachments.length} supplied files will be preserved. Status uses the open project and
                          supplied files. Loading remains the host’s responsibility.
                        </p>
                        {attachments.length > 0 && (
                          <ul className="mt-1 space-y-1">
                            {attachments.map((file) => (
                              <li className="break-all" key={file.path}>
                                {file.path}
                              </li>
                            ))}
                          </ul>
                        )}
                      </fieldset>
                    )}
                    <details className="rounded-xl border border-border p-4">
                      <summary className="cursor-pointer text-sm font-semibold">Workflow design</summary>
                      <div className="mt-4 space-y-3">
                        <label htmlFor="adoption-workflow" className="grid gap-1 text-xs font-medium">
                          Workflow (Mermaid)
                          <Textarea
                            id="adoption-workflow"
                            aria-label="Adoption workflow"
                            className="font-mono text-xs"
                            rows={4}
                            value={workflow}
                            onChange={(event) => setWorkflow(event.target.value)}
                          />
                          <span className="font-normal text-muted-foreground">
                            Review this starter workflow to match the source. Automatic checks do not evaluate model
                            quality.
                          </span>
                        </label>
                        <WorkflowPatternPicker
                          currentWorkflow={workflow}
                          onUse={(value) => {
                            setWorkflow(value);
                            setChanged(true);
                          }}
                        />
                      </div>
                    </details>
                  </>
                )}
              </section>
            </fieldset>
          </div>
          {error && (
            <p ref={alert} tabIndex={-1} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t pt-3">
            <span className="mr-auto text-xs text-muted-foreground">
              {initial?.existing
                ? 'Updates this document. Source is preserved.'
                : 'Adds a prompt to this project. Source is preserved.'}{' '}
              · Ctrl / ⌘ + Enter
            </span>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <ShortcutControl id={'saveAdoption'}>
              <Button type="submit" disabled={busy || !intake.text.trim()}>
                {busy ? 'Saving…' : 'Save and verify'}
              </Button>
            </ShortcutControl>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
