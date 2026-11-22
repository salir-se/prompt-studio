import { Button } from '@prompt-studio/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@prompt-studio/ui/dialog';
import { Input } from '@prompt-studio/ui/input';
import { Textarea } from '@prompt-studio/ui/textarea';
import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { useEffect, useRef, useState } from 'react';
import {
  type ProjectDefinitions,
  type ProjectTool,
  type ProjectVariable,
  validateProjectDefinitions,
} from '../prompt-repo/project-definitions';

export interface NewPromptInput {
  readonly id: string;
  readonly title: string;
  readonly requestField: 'systemPrompt' | 'userMessage';
  readonly tool: string;
  readonly variable: string;
  readonly variableDefinition?: ProjectVariable;
  readonly toolDefinition?: ProjectTool;
}

export interface NewPromptDialogProps {
  readonly open: boolean;
  readonly existingIds: readonly string[];
  readonly definitions?: Pick<ProjectDefinitions, 'variables' | 'tools'>;
  readonly onCreate: (input: NewPromptInput) => void | Promise<void>;
  readonly onCancel: () => void;
}

const SAFE_PROMPT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function promptDependencies(
  {
    variable,
    purpose,
    sample,
    tool,
    description,
    schema,
  }: { variable: string; purpose: string; sample: string; tool: string; description: string; schema: string },
  definitions: NewPromptDialogProps['definitions'],
): Pick<NewPromptInput, 'variableDefinition' | 'toolDefinition'> {
  const existingTool = definitions?.tools.find((entry) => entry.name === tool.trim());
  const variableDefinition: ProjectVariable | undefined = variable.trim()
    ? (definitions?.variables.find((entry) => entry.name === variable.trim()) ?? {
        name: variable.trim(),
        purpose: purpose.trim() || `Value supplied for ${variable.trim()}.`,
        sample,
        required: true,
        lifecycle: 'runtime',
        encoding: 'xml-text',
        presentation: 'placeholder',
      })
    : undefined;
  let inputSchema: unknown;
  if (tool.trim() && !existingTool) {
    try {
      inputSchema = JSON.parse(schema);
    } catch {
      throw new Error('Input JSON Schema must be valid JSON. Your input is preserved.');
    }
  }
  const checked = validateProjectDefinitions({
    format: 'prompt-studio-project@1',
    name: 'New prompt',
    variables: variableDefinition ? [variableDefinition] : [],
    tools: tool.trim()
      ? [
          existingTool ?? {
            name: tool.trim(),
            description: description.trim() || `Tool ${tool.trim()} available to this project.`,
            inputSchema,
          },
        ]
      : [],
  });
  return {
    ...(variableDefinition ? { variableDefinition: checked.variables[0] } : {}),
    ...(tool.trim() ? { toolDefinition: checked.tools[0] } : {}),
  };
}

export function NewPromptDialog({
  open,
  existingIds,
  definitions,
  onCreate,
  onCancel,
}: NewPromptDialogProps): React.JSX.Element | null {
  const firstInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [id, setId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [title, setTitle] = useState('');
  const [requestField, setRequestField] = useState<'systemPrompt' | 'userMessage'>('systemPrompt');
  const [tool, setTool] = useState('');
  const [variable, setVariable] = useState('');
  const [purpose, setPurpose] = useState('');
  const [sample, setSample] = useState('');
  const [description, setDescription] = useState('');
  const [schema, setSchema] = useState('{\n  "type": "object",\n  "properties": {}\n}');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const knownVariable = definitions?.variables.find((entry) => entry.name === variable.trim());
  const knownTool = definitions?.tools.find((entry) => entry.name === tool.trim());
  if (!open) return null;

  const trimmedId = id.trim();
  const trimmedTitle = title.trim();
  const idError =
    trimmedId === ''
      ? 'Prompt ID is required.'
      : !SAFE_PROMPT_ID.test(trimmedId)
        ? 'Use letters, numbers, hyphens, or underscores; start with a letter or number.'
        : existingIds.includes(trimmedId)
          ? 'That prompt ID already exists.'
          : null;
  const canCreate = idError === null && trimmedTitle !== '';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !creating) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="studio flex max-h-[90dvh] flex-col overflow-hidden bg-card sm:max-h-[90dvh] sm:max-w-3xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          opener.current = document.activeElement as HTMLElement | null;
          firstInput.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-tight">Create a prompt</DialogTitle>
          <DialogDescription className="text-foreground/80">
            Start with a name. Add inputs and tools now, or configure them as you write.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col gap-4"
          aria-busy={creating}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canCreate || creating) return;
            try {
              const dependencies = promptDependencies(
                { variable, purpose, sample, tool, description, schema },
                definitions,
              );
              setError(null);
              setCreating(true);
              await onCreate({
                id: trimmedId,
                title: trimmedTitle,
                requestField,
                tool: tool.trim(),
                variable: variable.trim(),
                ...dependencies,
              });
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : 'Check your variable and tool details.');
            } finally {
              setCreating(false);
            }
          }}
        >
          <TimelineScrollRegion className="min-h-0" viewportClassName="px-1 pb-1">
            <fieldset disabled={creating} className="min-w-0 space-y-6">
              <div className="grid gap-5 rounded-xl border border-border bg-muted/20 p-5 sm:grid-cols-[1.15fr_1fr]">
                <label htmlFor="new-prompt-title-input" className="flex flex-col gap-1 text-xs font-medium">
                  Title
                  <Input
                    id="new-prompt-title-input"
                    ref={firstInput}
                    aria-label="Prompt title"
                    value={title}
                    onChange={(event) => {
                      const next = event.target.value;
                      setTitle(next);
                      if (!idEdited)
                        setId(
                          next
                            .toLowerCase()
                            .replace(/[^a-z0-9_-]+/g, '-')
                            .replace(/^-+|-+$/g, ''),
                        );
                    }}
                    placeholder="Document summary"
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label htmlFor="new-prompt-id" className="flex flex-col gap-1 text-xs font-medium">
                  Prompt ID
                  <Input
                    id="new-prompt-id"
                    aria-label="Prompt ID"
                    aria-invalid={id !== '' && idError !== null}
                    aria-describedby="new-prompt-id-help"
                    value={id}
                    onChange={(event) => {
                      setIdEdited(true);
                      setId(event.target.value);
                    }}
                    placeholder="document-summary"
                    className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                  />
                  <span
                    id="new-prompt-id-help"
                    className={id !== '' && idError ? 'text-destructive' : 'text-foreground/80'}
                  >
                    {id !== '' && idError
                      ? idError
                      : 'Used in project files. Use letters, numbers, hyphens, or underscores.'}
                  </span>
                </label>
              </div>
              <details className="rounded-xl border border-border p-4">
                <summary className="cursor-pointer text-sm font-semibold">Inputs and tools</summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  Optional. Reuse a project definition or describe a new one.
                </p>
                <div className="mt-4 grid items-start gap-4 sm:grid-cols-2">
                  <fieldset className="min-w-0 space-y-3 rounded-lg border border-border p-3">
                    <legend className="px-1 text-sm font-medium">Tool</legend>
                    <label htmlFor="new-prompt-tool" className="flex flex-col gap-1 text-xs font-medium">
                      Tool (optional)
                      <Input
                        id="new-prompt-tool"
                        aria-label="Tool"
                        value={tool}
                        onChange={(event) => setTool(event.target.value)}
                        placeholder="web_search"
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    {knownTool ? (
                      <p className="text-xs text-muted-foreground">
                        Using the existing project tool: {knownTool.description}
                      </p>
                    ) : (
                      tool.trim() && (
                        <>
                          <label htmlFor="new-tool-description" className="flex flex-col gap-1 text-xs font-medium">
                            Description
                            <Textarea
                              id="new-tool-description"
                              aria-label="Tool description"
                              value={description}
                              onChange={(event) => setDescription(event.target.value)}
                              placeholder="What does this tool do?"
                              rows={2}
                            />
                          </label>
                          <label htmlFor="new-tool-schema" className="flex flex-col gap-1 text-xs font-medium">
                            Input JSON Schema
                            <Textarea
                              id="new-tool-schema"
                              aria-label="Input JSON Schema"
                              value={schema}
                              onChange={(event) => setSchema(event.target.value)}
                              spellCheck={false}
                              rows={5}
                              className="font-mono text-xs"
                            />
                          </label>
                          <p className="text-xs text-muted-foreground">
                            Defines accepted inputs. Tools are not executed here.
                          </p>
                        </>
                      )
                    )}
                  </fieldset>
                  <fieldset className="min-w-0 space-y-3 rounded-lg border border-border p-3">
                    <legend className="px-1 text-sm font-medium">Variable</legend>
                    <label htmlFor="new-prompt-variable" className="flex flex-col gap-1 text-xs font-medium">
                      Variable (optional)
                      <Input
                        id="new-prompt-variable"
                        aria-label="Variable"
                        value={variable}
                        onChange={(event) => setVariable(event.target.value)}
                        placeholder="document"
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    {knownVariable ? (
                      <p className="text-xs text-muted-foreground">
                        Using the existing project variable: {knownVariable.purpose}
                      </p>
                    ) : (
                      variable.trim() && (
                        <>
                          <label htmlFor="new-variable-purpose" className="flex flex-col gap-1 text-xs font-medium">
                            Purpose
                            <Textarea
                              id="new-variable-purpose"
                              aria-label="Variable purpose"
                              value={purpose}
                              onChange={(event) => setPurpose(event.target.value)}
                              placeholder="What value does the prompt need?"
                              rows={2}
                            />
                          </label>
                          <label htmlFor="new-variable-example" className="flex flex-col gap-1 text-xs font-medium">
                            Example value
                            <Textarea
                              id="new-variable-example"
                              aria-label="Example value"
                              value={sample}
                              onChange={(event) => setSample(event.target.value)}
                              rows={3}
                            />
                          </label>
                          <p className="text-xs text-muted-foreground">
                            Provided when the prompt runs. Use an example, never a password or access token.
                          </p>
                        </>
                      )
                    )}
                  </fieldset>
                </div>
              </details>
              <details className="rounded-xl border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">Advanced request settings</summary>
                <p className="my-3 text-xs text-muted-foreground">
                  Choose where this prompt is placed in the model request. System prompt is the default.
                </p>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  Runtime request field
                  <select
                    aria-label="Runtime request field"
                    value={requestField}
                    onChange={(event) => setRequestField(event.target.value as 'systemPrompt' | 'userMessage')}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="systemPrompt">System prompt</option>
                    <option value="userMessage">User message</option>
                  </select>
                </label>
              </details>
            </fieldset>
          </TimelineScrollRegion>
          {error && (
            <p role="alert" ref={errorRef} tabIndex={-1} className="shrink-0 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-card pt-4">
            <Button type="button" onClick={onCancel} variant="outline" disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canCreate || creating}>
              {creating ? 'Creating…' : 'Create prompt'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
