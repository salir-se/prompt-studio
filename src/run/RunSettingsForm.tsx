import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { Label } from '@prompt-studio/ui/label';
import { useEffect, useState } from 'react';
import { ModelFields } from './RunFields';
import type { RunSettings } from './contracts';

export function RunSettingsForm({
  settings,
  busy,
  onSave,
  onDirtyChange,
}: {
  settings: RunSettings;
  busy: boolean;
  onSave: (value: Omit<RunSettings, 'skills' | 'connected'> & { apiKey?: string }) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [value, setValue] = useState(() => ({
    skillsFolder: settings.skillsFolder,
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
  }));
  const [apiKey, setApiKey] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(settings.baseUrl));
  const [message, setMessage] = useState('');
  const saved = {
    skillsFolder: settings.skillsFolder,
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
  };
  const dirty = JSON.stringify(value) !== JSON.stringify(saved) || Boolean(apiKey);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  async function save() {
    setMessage('');
    if (await onSave({ ...value, ...(apiKey ? { apiKey } : {}) })) {
      setApiKey('');
      setMessage('Settings saved. Skills were scanned from this folder.');
    }
  }
  const endpoint = (
    <Label className="grid gap-1.5 text-sm">
      API base URL{' '}
      <span className="text-xs text-muted-foreground">
        {value.provider === 'openai-compat'
          ? 'Enter the URL for your compatible provider.'
          : 'Leave blank to use the provider’s predefined endpoint.'}
      </span>
      <Input
        value={value.baseUrl}
        onChange={(event) => setValue({ ...value, baseUrl: event.target.value })}
        placeholder="https://…"
      />
    </Label>
  );
  return (
    <form
      className="mx-auto grid w-full max-w-2xl gap-6 p-4 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <h3 className="text-lg font-semibold">Execution settings</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Shared by prompt runs, evaluation tests, AI review and Help. Help can use a separate model. Changes apply
          after saving.
        </p>
      </div>
      <fieldset disabled={busy} className="grid min-w-0 gap-4 rounded-lg border p-4">
        <legend className="px-1 font-medium">Model connection</legend>
        <p className="text-xs text-muted-foreground">
          Shared provider and model for prompt runs, test suites and version comparisons.
        </p>
        <ModelFields
          value={value}
          onChange={(model) => {
            if (model.provider !== value.provider && value.baseUrl) setAdvancedOpen(true);
            setValue({ ...value, ...model });
          }}
        />
        {value.provider === 'openai-compat' && endpoint}
        <Label className="grid gap-1.5 text-sm">
          API key <span className="text-xs text-muted-foreground">Leave blank to keep the current connection.</span>
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </Label>
        <p className="text-xs text-muted-foreground">
          Keys stay in the local Studio server’s memory. They are excluded from prompt files and project exports.
          Reconnect after restarting Studio.
        </p>
        <p className="text-sm">
          {settings.connected
            ? 'A credential is available. The next run will verify access.'
            : 'No credential is available for the configured provider.'}
        </p>
        {value.provider !== 'openai-compat' && (
          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            className="rounded-lg border bg-muted/15 p-3"
          >
            <summary className="cursor-pointer text-sm font-medium">
              <span>Advanced connection settings</span>
              {value.baseUrl && <span className="ml-2 text-xs text-muted-foreground">Custom endpoint</span>}
            </summary>
            <div className="mt-3">{endpoint}</div>
          </details>
        )}
      </fieldset>
      <fieldset disabled={busy} className="grid min-w-0 gap-3 rounded-lg border p-4">
        <legend className="px-1 font-medium">Skills folder</legend>
        <Label className="grid gap-1.5 text-sm">
          Local folder path
          <Input
            value={value.skillsFolder}
            onChange={(event) => setValue({ ...value, skillsFolder: event.target.value })}
            placeholder="/home/you/skills"
          />
        </Label>
        <p className="text-xs text-muted-foreground">
          Studio discovers SKILL.md files inside this folder. Attach skills in Single run, Test suites or Compare.
        </p>
        {settings.skillsError && (
          <p role="alert" className="break-words text-sm text-destructive">
            {settings.skillsError} Choose an available folder and save to scan again.
          </p>
        )}
        <p className="text-sm">{settings.skills.length} skills discovered</p>
      </fieldset>
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background px-4 py-3 sm:-mx-6 sm:px-6">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings & scan skills'}
        </Button>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
