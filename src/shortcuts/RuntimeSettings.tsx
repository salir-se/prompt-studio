import { Button } from '@prompt-studio/ui/button';
import { useEffect, useState } from 'react';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { RunSettingsForm } from '../run/RunSettingsForm';
import type { RunSettings } from '../run/contracts';
import { announceRunSettings } from '../run/run-settings-events';

/** Uses the same server settings as Run; credentials never enter device preferences. */
export function RuntimeSettings({
  onDirtyChange,
  onBusyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [settings, setSettings] = useState<RunSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setError('');
    void studioJson<RunSettings>('/__studio/run/settings').then(
      (result) => {
        if (current) setSettings(result);
      },
      (reason) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  async function save(value: Omit<RunSettings, 'skills' | 'connected'> & { apiKey?: string }) {
    if (busy) return false;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const result = await studioJson<RunSettings>('/__studio/run/settings', {
        method: 'POST',
        body: JSON.stringify(value),
      });
      setSettings(result);
      announceRunSettings(result);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section aria-label="Shared execution settings" className="rounded-lg border">
      {error && (
        <div className="space-y-2 p-4">
          <p role="alert" className="break-words text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
          {!settings && (
            <Button size="sm" variant="outline" onClick={() => setAttempt(attempt + 1)}>
              Retry loading settings
            </Button>
          )}
        </div>
      )}
      {settings ? (
        <RunSettingsForm settings={settings} busy={busy} onSave={save} onDirtyChange={onDirtyChange} />
      ) : (
        !error && (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            Loading execution settings…
          </p>
        )
      )}
    </section>
  );
}
