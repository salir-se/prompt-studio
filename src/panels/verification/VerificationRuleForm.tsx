import { type PromptVerificationRule, PromptVerificationRuleSchema } from '@prompt-studio/prompts';
import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { useEffect, useId, useRef, useState } from 'react';
import { RULE_NAMES } from './verification-editing';

export function VerificationRuleForm({
  rule,
  initialKind,
  onSave,
  onCancel,
}: {
  rule?: PromptVerificationRule;
  initialKind?: PromptVerificationRule['kind'];
  onSave: (rule: PromptVerificationRule) => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const [kind, setKind] = useState<PromptVerificationRule['kind']>(
    rule?.kind ?? initialKind ?? 'required-output-literal',
  );
  const [severity, setSeverity] = useState(rule?.severity ?? 'error');
  const [enforcement, setEnforcement] = useState(rule?.enforcement ?? 'edit');
  const [values, setValues] = useState<Record<string, string>>(() =>
    rule
      ? Object.fromEntries(
          Object.entries(rule).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]),
        )
      : {},
  );
  const form = useRef<HTMLElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);
  const [error, setError] = useState<string | null>(null);
  const fields: readonly [string, string][] =
    kind === 'required-placeholder'
      ? [['name', 'Variable name']]
      : kind === 'required-tool'
        ? [['name', 'Tool name']]
        : kind === 'required-output-literal'
          ? [['literal', 'Required text']]
          : kind === 'known-placeholder'
            ? [['allowedNames', 'Allowed variable names, separated by commas']]
            : kind === 'minimum-length'
              ? [['minChars', 'Minimum characters']]
              : kind === 'forbidden-combination'
                ? [
                    ['first', 'First instruction'],
                    ['second', 'Conflicting instruction'],
                  ]
                : [];
  function submit() {
    const payload = Object.fromEntries(
      fields.map(([key]) => [
        key,
        key === 'allowedNames'
          ? (values[key] ?? '')
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : key === 'minChars'
            ? values[key]?.trim()
              ? Number(values[key])
              : Number.NaN
            : (values[key]?.trim() ?? ''),
      ]),
    );
    // ArkType exposes errors through the schema's assertion, keeping incomplete field values editable.
    try {
      onSave(
        PromptVerificationRuleSchema.assert({
          id: rule?.id ?? `rule-${crypto.randomUUID()}`,
          kind,
          severity,
          enforcement,
          ...payload,
        }),
      );
    } catch {
      setError(
        kind === 'minimum-length'
          ? 'Enter a non-negative whole number for minimum length.'
          : 'Complete all required fields before adding this check.',
      );
    }
  }
  return (
    <section
      ref={form}
      aria-label="Check editor"
      className="space-y-3 rounded-md border border-border bg-muted/20 p-3"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.nativeEvent.isComposing &&
          event.key === 'Enter'
        ) {
          event.preventDefault();
          event.stopPropagation();
          submit();
        }
      }}
    >
      <label className="block text-sm">
        Check type
        <select
          aria-label="Check type"
          value={kind}
          onChange={(event) => setKind(event.target.value as PromptVerificationRule['kind'])}
          className="mt-1 w-full rounded-md border border-input bg-background p-2"
        >
          {Object.entries(RULE_NAMES).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {fields.map(([key, label]) => (
        <label key={key} htmlFor={`${formId}-${key}`} className="block text-sm">
          {label}
          <Input
            className="mt-1"
            id={`${formId}-${key}`}
            aria-label={label}
            type={key === 'minChars' ? 'number' : 'text'}
            min={key === 'minChars' ? 0 : undefined}
            step={key === 'minChars' ? 1 : undefined}
            value={values[key] ?? ''}
            onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
          />
        </label>
      ))}
      <details>
        <summary className="cursor-pointer text-xs">Severity and enforcement stage</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Severity
            <select
              aria-label="Check severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as typeof severity)}
              className="mt-1 w-full rounded-md border border-input bg-background p-2"
            >
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Information</option>
            </select>
          </label>
          <label className="text-sm">
            Check stage
            <select
              aria-label="Check stage"
              value={enforcement}
              onChange={(event) => setEnforcement(event.target.value as typeof enforcement)}
              className="mt-1 w-full rounded-md border border-input bg-background p-2"
            >
              <option value="edit">Editing</option>
              <option value="activation">Activation</option>
              <option value="runtime">Runtime</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Studio evaluates all registered rules when you recheck. Stages describe where a host enforces the rule.
        </p>
      </details>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel check
        </Button>
        <Button type="button" size="sm" onClick={submit}>
          {rule ? 'Update check' : 'Add check'}
        </Button>
      </div>
    </section>
  );
}
