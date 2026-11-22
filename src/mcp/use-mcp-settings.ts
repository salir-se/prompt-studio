import { useEffect, useRef, useState } from 'react';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import type { RunSettings } from '../run/contracts';
import { announceRunSettings } from '../run/run-settings-events';
import type { StudioMcpServer } from './contracts';

const empty = { id: '', name: '', url: '', apiKey: '' };
export function useMcpSettings({
  onDirtyChange,
  onBusyChange,
}: {
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const pending = useRef(false);
  const [servers, setServers] = useState<StudioMcpServer[]>([]);
  const [draft, setDraft] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const previous = servers.find((server) => server.id === draft.id);
  const dirty = draft.name !== (previous?.name ?? '') || draft.url !== (previous?.url ?? '') || !!draft.apiKey;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void studioJson<{ servers: StudioMcpServer[] }>('/__studio/run/mcp-servers')
      .then(
        (result) => {
          if (current) setServers(result.servers);
        },
        () => {
          if (current) setError('MCP server settings could not be loaded. Retry to keep editing.');
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [attempt]);
  async function action(body: unknown, message: string, reset = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await studioJson<{ servers: StudioMcpServer[] }>('/__studio/run/mcp-servers', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setServers(result.servers);
      if (reset) setDraft(empty);
      setNotice(message);
      try {
        announceRunSettings(await studioJson<RunSettings>('/__studio/run/settings'));
      } catch {
        setNotice(`${message} Reopen Run to refresh its tool catalog.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'MCP settings could not be saved. Your draft is preserved.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function edit(server: StudioMcpServer) {
    if (dirty && !window.confirm('Discard unsaved MCP server changes?')) return;
    setDraft({ id: server.id, name: server.name, url: server.url, apiKey: '' });
    setError('');
    setNotice('');
  }
  function save() {
    const { apiKey, ...server } = draft;
    return action(
      { action: 'save', server: { ...server, id: draft.id || crypto.randomUUID(), ...(apiKey ? { apiKey } : {}) } },
      'Server saved. Discover its tools when ready.',
      true,
    );
  }
  return {
    servers,
    draft,
    loading,
    busy,
    error,
    notice,
    save,
    edit,
    changeDraft: (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch })),
    retry: () => setAttempt((current) => current + 1),
    discover: (server: StudioMcpServer) =>
      action({ action: 'discover', id: server.id }, `Tool catalog refreshed for ${server.name}.`),
    remove: (server: StudioMcpServer) => {
      if (window.confirm('Remove this MCP server? Saved tool bindings will become unavailable.'))
        return action({ action: 'remove', id: server.id }, 'MCP server removed.', draft.id === server.id);
    },
    cancel: () => {
      if (!dirty || window.confirm('Discard unsaved MCP server changes?')) setDraft(empty);
    },
  };
}
