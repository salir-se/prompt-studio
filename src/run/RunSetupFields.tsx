import { Button } from '@prompt-studio/ui/button';
import { useId, useState } from 'react';
import { ToolBindingsEditor } from '../mcp/ToolBindingsEditor';
import { PROVIDER_LABELS, SkillAttachments } from './RunFields';
import type { RunSettings, RunSetup } from './contracts';

/** Runs share application model defaults; skill choices stay local to this prompt. */
export function RunSetupFields({
  setup,
  settings,
  connected,
  onChange,
  onSettings,
}: {
  setup: RunSetup;
  settings: RunSettings | null;
  connected: boolean;
  onChange: (setup: RunSetup) => void;
  onSettings: () => void;
}) {
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const attachmentsId = useId();
  const attachedNames = setup.skills.map(
    (id) => settings?.skills.find((skill) => skill.id === id)?.name ?? `${id} (unavailable)`,
  );
  return (
    <section aria-label="Model and skills" className="grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
        <div className="min-w-0">
          <p className="break-words font-medium">
            {PROVIDER_LABELS[setup.provider]} · <span>{setup.model || 'Choose a model'}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {connected ? 'From app settings' : 'Connect this provider in app settings'}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onSettings}>
          {connected ? 'App settings' : 'Connection settings'}
        </Button>
      </div>
      {settings?.skillsError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          Skills folder unavailable. Open skills folder settings to repair it.
        </p>
      )}
      <div className="min-w-0 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">Skills · {setup.skills.length} attached</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={attachmentsOpen}
            aria-controls={attachmentsId}
            onClick={() => setAttachmentsOpen(!attachmentsOpen)}
          >
            Edit skill attachments
          </Button>
        </div>
        <p className="mt-1 break-words text-xs text-muted-foreground">
          {attachedNames.join(', ') || 'Optional · no skills attached'}
        </p>
        <div id={attachmentsId} hidden={!attachmentsOpen} className="mt-3">
          <SkillAttachments
            skills={settings?.skills ?? []}
            selected={setup.skills}
            onChange={(skills) => onChange({ ...setup, skills })}
            onSettings={onSettings}
          />
        </div>
      </div>
      <details className="min-w-0 rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Tool responses · {setup.tools?.length ?? 0} selected
        </summary>
        <div className="mt-3">
          <ToolBindingsEditor
            value={setup.tools ?? []}
            servers={settings?.mcpServers}
            onChange={(tools) => onChange({ ...setup, tools })}
          />
        </div>
      </details>
    </section>
  );
}
