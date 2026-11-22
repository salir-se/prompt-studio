import type { PromptSectionDesign } from '@prompt-studio/prompts';

const JSON_FIELD = 'w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs min-h-28 font-mono';
export type JsonSchemaValue = Extract<PromptSectionDesign['input'], { kind: 'json' }>['jsonSchema'];

export function parseJsonSchema(value: string): JsonSchemaValue {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('JSON Schema must be an object.');
  }
  return parsed as JsonSchemaValue;
}

export function schemaError(value: string): string | null {
  try {
    parseJsonSchema(value);
    return null;
  } catch {
    return 'Enter a valid JSON object before saving.';
  }
}

export function JsonSchemaEditor({
  axis,
  value,
  onChange,
  onCommit,
}: {
  axis: 'Input' | 'Output';
  value: string;
  onChange: (value: string) => void;
  onCommit: (schema: JsonSchemaValue) => void;
}): React.JSX.Element {
  const error = schemaError(value);
  return (
    <label className="text-xs font-medium">
      {axis} JSON schema
      <textarea
        aria-label={`${axis} JSON schema`}
        aria-invalid={error !== null}
        aria-describedby={error ? `${axis}-schema-error` : undefined}
        className={JSON_FIELD}
        rows={8}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (!error) onCommit(parseJsonSchema(value));
        }}
      />
      {error && (
        <span id={`${axis}-schema-error`} role="alert" className="mt-1 block text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}
