import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { Textarea } from '@prompt-studio/ui/textarea';
import type { ProjectDefinitions } from '../prompt-repo/project-definitions';
import type { AdoptionTool } from './adopt-prompt';

export function AdoptionDependencies({
  names,
  variables,
  tools,
  definitions,
  onVariable,
  onTools,
}: {
  names: readonly string[];
  variables: Record<string, { purpose: string; sample: string }>;
  tools: readonly AdoptionTool[];
  definitions: ProjectDefinitions;
  onVariable: (name: string, value: { purpose: string; sample: string }) => void;
  onTools: (tools: AdoptionTool[]) => void;
}) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <fieldset className="min-w-0 space-y-4 rounded-xl border border-border p-4">
        <legend className="px-1 text-sm font-medium">Variables · {names.length}</legend>
        {!names.length && (
          <p className="text-xs text-muted-foreground">Use {'{{name}}'} in the source to add a variable here.</p>
        )}
        {names.map((name) => {
          const known = definitions.variables.find((entry) => entry.name === name);
          const value = variables[name] ?? { purpose: '', sample: '' };
          return (
            <div key={name} className="space-y-3 border-t border-border pt-3">
              <p className="break-all font-mono text-xs">{`{{${name}}}`}</p>
              {known ? (
                <p className="text-xs text-muted-foreground">Using project definition: {known.purpose}</p>
              ) : (
                <>
                  <label htmlFor={`adoption-purpose-${name}`} className="grid gap-1 text-xs">
                    Purpose
                    <Input
                      id={`adoption-purpose-${name}`}
                      aria-label={`Purpose of ${name}`}
                      value={value.purpose}
                      onChange={(event) => onVariable(name, { ...value, purpose: event.target.value })}
                    />
                  </label>
                  <label htmlFor={`adoption-example-${name}`} className="grid gap-1 text-xs">
                    Example value
                    <Input
                      id={`adoption-example-${name}`}
                      aria-label={`Example for ${name}`}
                      value={value.sample}
                      onChange={(event) => onVariable(name, { ...value, sample: event.target.value })}
                    />
                  </label>
                </>
              )}
            </div>
          );
        })}
      </fieldset>
      <fieldset className="min-w-0 space-y-4 rounded-xl border border-border p-4">
        <legend className="px-1 text-sm font-medium">Tools</legend>
        <p className="text-xs text-muted-foreground">
          Add tools this prompt needs. Existing project definitions are reused. Tools are not executed here.
        </p>
        {tools.map((tool, index) => {
          const known = definitions.tools.find((entry) => entry.name === tool.name.trim());
          function change(patch: Partial<AdoptionTool>) {
            onTools(tools.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));
          }
          return (
            <fieldset key={index} className="min-w-0 space-y-2 border-t pt-2">
              <legend className="sr-only">Tool {index + 1}</legend>
              <label htmlFor={`adoption-tool-${index}`} className="grid gap-1 text-xs">
                Tool name (optional)
                <Input
                  list="adoption-project-tools"
                  id={`adoption-tool-${index}`}
                  aria-label={`Tool name ${index + 1}`}
                  value={tool.name}
                  onChange={(event) => change({ name: event.target.value })}
                />
              </label>
              {known ? (
                <p className="text-xs text-muted-foreground">Using project definition: {known.description}</p>
              ) : (
                tool.name.trim() && (
                  <>
                    <label htmlFor={`adoption-tool-description-${index}`} className="grid gap-1 text-xs">
                      Description
                      <Input
                        id={`adoption-tool-description-${index}`}
                        aria-label={`Tool description ${index + 1}`}
                        value={tool.description}
                        onChange={(event) => change({ description: event.target.value })}
                      />
                    </label>
                    <label htmlFor={`adoption-tool-schema-${index}`} className="grid gap-1 text-xs">
                      Input JSON Schema
                      <Textarea
                        id={`adoption-tool-schema-${index}`}
                        aria-label={`Tool schema ${index + 1}`}
                        className="font-mono text-xs"
                        rows={3}
                        value={tool.schema}
                        onChange={(event) => change({ schema: event.target.value })}
                      />
                    </label>
                  </>
                )
              )}
            </fieldset>
          );
        })}
        <datalist id="adoption-project-tools">
          {definitions.tools.map((tool) => (
            <option key={tool.name} value={tool.name} />
          ))}
        </datalist>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onTools([...tools, { name: '', description: '', schema: '{"type":"object","properties":{}}' }])
          }
        >
          Add another tool
        </Button>
      </fieldset>
    </div>
  );
}
