import { MermaidDiagram } from '@prompt-studio/prompt-graph-ui';
import { PROMPT_WORKFLOW_TEMPLATE, type PromptDesign } from '@prompt-studio/prompts';
import { WorkflowPatternPicker } from '../design/WorkflowPatternPicker';
import { JsonSchemaEditor, type JsonSchemaValue } from './PromptDesignSchemaEditor';

const FIELD = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const JSON_FIELD = `${FIELD} min-h-28 font-mono`;
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function PromptContractDetails({
  scope,
  sectionId,
  schemaDrafts,
  onDescriptionChange,
  onContractChange,
  onSchemaChange,
  onSchemaCommit,
  onRequiredToolChange,
  onWorkflowChange,
}: {
  scope: Pick<PromptDesign, 'input' | 'output' | 'workflow'>;
  sectionId?: string;
  schemaDrafts: Partial<Record<'input' | 'output', string>>;
  onContractChange: (axis: 'input' | 'output', value: string) => void;
  onDescriptionChange: (axis: 'input' | 'output', value: string) => void;
  onSchemaChange: (axis: 'input' | 'output', value: string) => void;
  onSchemaCommit: (axis: 'input' | 'output', value: JsonSchemaValue) => void;
  onRequiredToolChange: (name: string) => void;
  onWorkflowChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <section className="space-y-5" aria-label="Contract details">
      <section aria-label="Expected input" className="space-y-3 rounded-xl border border-border bg-muted/15 p-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
            01
          </span>
          <h3 className="text-sm font-semibold">Expected input</h3>
        </div>
        <label className="grid gap-1.5 text-xs font-medium">
          Input format
          <select
            aria-label="Input"
            className={FIELD}
            value={scope.input.kind}
            onChange={(event) => onContractChange('input', event.target.value)}
          >
            <option value="free-text">Free text</option>
            <option value="json">Structured JSON</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          Input description
          <textarea
            aria-label="Input description"
            className={FIELD}
            rows={3}
            value={scope.input.description}
            onChange={(event) => onDescriptionChange('input', event.target.value)}
          />
        </label>
        {scope.input.kind === 'json' && (
          <JsonSchemaEditor
            axis="Input"
            value={schemaDrafts.input ?? pretty(scope.input.jsonSchema)}
            onChange={(value) => onSchemaChange('input', value)}
            onCommit={(schema) => onSchemaCommit('input', schema)}
          />
        )}
      </section>
      <section aria-label="Workflow" className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
              02
            </span>
            <h3 className="text-sm font-semibold">{sectionId ? 'Sub-prompt workflow' : 'Major workflow'}</h3>
          </div>
          <WorkflowPatternPicker onUse={onWorkflowChange} currentWorkflow={scope.workflow} />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Describe how {sectionId ? 'this sub-prompt' : 'the whole prompt'} works. This diagram documents the design; it
          does not execute it.
        </p>
        {scope.workflow.trim() !== '' && (
          <section
            className="min-w-0 overflow-x-auto rounded-lg border border-border bg-muted/20 p-4"
            aria-label="Workflow preview"
          >
            <MermaidDiagram code={scope.workflow} />
          </section>
        )}
        <label className="grid gap-1.5 text-xs font-medium">
          Mermaid source
          <textarea
            aria-label={sectionId ? 'Sub-prompt workflow Mermaid' : 'Major workflow Mermaid'}
            className={JSON_FIELD}
            rows={6}
            value={scope.workflow}
            placeholder={PROMPT_WORKFLOW_TEMPLATE}
            onChange={(event) => onWorkflowChange(event.target.value)}
          />
        </label>
      </section>
      <section aria-label="Expected output" className="space-y-3 rounded-xl border border-border bg-muted/15 p-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
            03
          </span>
          <h3 className="text-sm font-semibold">Expected output</h3>
        </div>
        <label className="grid gap-1.5 text-xs font-medium">
          Output format
          <select
            aria-label="Output"
            className={FIELD}
            value={scope.output.kind}
            onChange={(event) => onContractChange('output', event.target.value)}
          >
            <option value="freeform">Free text</option>
            <option value="json">Structured JSON</option>
            <option value="tool-call">Tool call</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          Output description
          <textarea
            aria-label="Output description"
            className={FIELD}
            rows={3}
            value={scope.output.description}
            onChange={(event) => onDescriptionChange('output', event.target.value)}
          />
        </label>
        {scope.output.kind === 'json' && scope.output.jsonSchema && (
          <JsonSchemaEditor
            axis="Output"
            value={schemaDrafts.output ?? pretty(scope.output.jsonSchema)}
            onChange={(value) => onSchemaChange('output', value)}
            onCommit={(schema) => onSchemaCommit('output', schema)}
          />
        )}
        {scope.output.kind === 'tool-call' && (
          <label className="grid gap-1.5 text-xs font-medium">
            Required tool name
            <input
              aria-label="Required tool name"
              className={FIELD}
              value={scope.output.requiredToolName ?? ''}
              onChange={(event) => onRequiredToolChange(event.target.value)}
            />
          </label>
        )}
      </section>
    </section>
  );
}
