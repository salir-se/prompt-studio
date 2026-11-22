import { useEffect, useRef, useState } from 'react';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { PROVIDER_LABELS } from '../run/RunFields';
import type { HelpModel, RunSettings } from '../run/contracts';
import { providerConnected } from '../run/run-client';
import { announceRunSettings, RUN_SETTINGS_CHANGED } from '../run/run-settings-events';
import type { StudioHelpContext } from './studio-knowledge';
import type { HelpChatMessage } from './zai-client';

const same = (a: HelpModel | null | undefined, b: HelpModel | null | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Owns the machine-local Help override; prompt execution settings remain owned by App settings. */
export function useHelpModel() {
  const workspace = !!document.querySelector('meta[name="studio-workspace"]');
  const [settings, setSettings] = useState<RunSettings | null>(null);
  const [draft, setDraft] = useState<HelpModel | null>(null);
  const [loading, setLoading] = useState(workspace);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const current = useRef({ settings, draft });
  current.current = { settings, draft };
  const pending = useRef(false);
  useEffect(() => {
    if (!workspace) return;
    let mounted = true;
    let changed = false;
    const accept = (next: RunSettings) => {
      if (!mounted) return;
      if (!current.current.settings || same(current.current.draft, current.current.settings.helpModel))
        setDraft(next.helpModel ?? null);
      setSettings(next);
      setError('');
      setLoading(false);
    };
    setLoading(true);
    setError('');
    const update = (event: Event) => {
      changed = true;
      accept((event as CustomEvent<RunSettings>).detail);
    };
    window.addEventListener(RUN_SETTINGS_CHANGED, update);
    void studioJson<RunSettings>('/__studio/run/settings')
      .then(
        (result) => {
          if (!changed) accept(result);
        },
        (reason) => {
          if (mounted && !changed)
            setError(reason instanceof Error ? reason.message : 'Help model settings could not be loaded.');
        },
      )
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      window.removeEventListener(RUN_SETTINGS_CHANGED, update);
    };
  }, [workspace, attempt]);
  const selected = settings?.helpModel ?? settings;
  const dirty = !same(draft, settings?.helpModel);
  const connected = !!selected?.model.trim() && providerConnected(settings, selected.provider);
  const label = selected?.model
    ? `${PROVIDER_LABELS[selected.provider]} · ${selected.model}`
    : 'Choose a model in App settings';
  async function save() {
    if (pending.current || !settings) return;
    pending.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await studioJson<RunSettings>('/__studio/run/settings', {
        method: 'POST',
        body: JSON.stringify({ helpModel: draft }),
      });
      setSettings(result);
      setDraft(result.helpModel ?? null);
      announceRunSettings(result);
      setNotice('Help model saved. Prompt settings are unchanged.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Help model could not be saved. Your changes are preserved.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return {
    workspace,
    settings,
    draft,
    loading,
    saving,
    error,
    notice,
    dirty,
    connected,
    label,
    save,
    change: (value: HelpModel | null) => {
      setDraft(value);
      setNotice('');
    },
    reset: () => {
      setDraft(settings?.helpModel ?? null);
      setError('');
      setNotice('');
    },
    retry: () => setAttempt((value) => value + 1),
    send: (context: StudioHelpContext, messages: readonly HelpChatMessage[]) =>
      studioJson<{ text: string; model: string; provider: HelpModel['provider'] }>('/__studio/run/help', {
        method: 'POST',
        body: JSON.stringify({ context, messages: messages.map(({ role, content }) => ({ role, content })) }),
      }),
  };
}
