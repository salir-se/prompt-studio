import { Button } from '@prompt-studio/ui/button';
import { Label } from '@prompt-studio/ui/label';
import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { ModelFields } from '../run/RunFields';
import { useShortcutEducation } from '../shortcuts/shortcut-context';
import type { useHelpModel } from './use-help-model';
export function HelpModelSettings({ model, disabled }: { model: ReturnType<typeof useHelpModel>; disabled: boolean }) {
  const education = useShortcutEducation();
  return (
    <section
      aria-label="Help model settings"
      className="flex max-h-[52dvh] shrink-0 flex-col border-b border-border bg-muted/20 text-xs"
    >
      <TimelineScrollRegion className="min-h-0" viewportClassName="space-y-3 px-4 py-3">
        {model.loading ? (
          <p role="status">Loading Help model…</p>
        ) : (
          model.settings && (
            <>
              <p className="break-all font-medium">{model.label}</p>
              <Label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!model.draft}
                  disabled={disabled || model.saving}
                  onChange={(event) =>
                    model.change(
                      event.target.checked
                        ? null
                        : { provider: model.settings!.provider, model: model.settings!.model },
                    )
                  }
                />
                Use model from App settings
              </Label>
              {model.draft && (
                <fieldset disabled={disabled || model.saving} className="space-y-3 rounded-lg border p-3">
                  <legend className="px-1 font-medium">Separate Help model</legend>
                  <ModelFields value={model.draft} onChange={model.change} />
                  <p className="text-muted-foreground">
                    Uses this provider’s connection from App settings. Saving here only changes Help.
                  </p>
                </fieldset>
              )}
              {model.dirty ? (
                <p className="text-muted-foreground">Save the Help model before asking a question.</p>
              ) : (
                !model.connected && (
                  <p className="text-muted-foreground">
                    Connect this provider and choose a model in App settings to ask a question.
                  </p>
                )
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || model.saving}
                onClick={() => education.open('settings', 'execution')}
              >
                App settings
              </Button>
            </>
          )
        )}
        {model.error && (
          <div className="space-y-2">
            <p role="alert" className="break-words text-red-700 dark:text-red-300">
              {model.error}
            </p>
            {!model.settings && (
              <Button size="sm" variant="outline" onClick={model.retry}>
                Retry model settings
              </Button>
            )}
          </div>
        )}
        {model.notice && (
          <p role="status" className="text-muted-foreground">
            {model.notice}
          </p>
        )}
      </TimelineScrollRegion>
      {model.dirty && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-2">
          <Button
            size="sm"
            disabled={disabled || model.saving || (!!model.draft && !model.draft.model.trim())}
            onClick={() => void model.save()}
          >
            {model.saving ? 'Saving…' : 'Save Help model'}
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled || model.saving} onClick={model.reset}>
            Discard changes
          </Button>
        </div>
      )}
    </section>
  );
}
