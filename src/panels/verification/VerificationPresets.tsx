import type { PromptVerificationRule } from '@prompt-studio/prompts';
import { Button } from '@prompt-studio/ui/button';
import { type VerificationPresetContext, verificationPresets } from './verification-presets';

export function VerificationPresets({
  context,
  rules,
  disabled,
  onAdd,
  onCustom,
}: {
  context: VerificationPresetContext;
  rules: readonly PromptVerificationRule[];
  disabled: boolean;
  onAdd: (rules: readonly PromptVerificationRule[]) => void;
  onCustom: (kind: PromptVerificationRule['kind']) => void;
}) {
  const presets = verificationPresets(context, rules);
  return (
    <section aria-label="Build a verification harness" className="rounded-lg border bg-muted/20 p-3">
      <h5 className="text-sm font-semibold">Add checks around these instructions</h5>
      <p className="mt-1 text-xs text-muted-foreground">
        Preserve the prompt. Choose a requirement; Studio saves the check and rechecks without a model call.
      </p>
      <details
        className="mt-3"
        open={rules.every((rule) => rule.kind === 'non-empty' || rule.kind === 'cache-sensitive-dynamic')}
      >
        <summary className="cursor-pointer text-sm">Suggested checks · {presets.length}</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {presets.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-left"
              title={preset.description}
              onClick={() => ('rules' in preset ? onAdd(preset.rules) : onCustom(preset.kind))}
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="block text-xs font-medium">{preset.label}</span>
                <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{preset.description}</span>
              </span>
            </Button>
          ))}
        </div>
      </details>
    </section>
  );
}
