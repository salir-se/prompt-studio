import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUTTON_BASE_CLASSES,
  BUTTON_DEFAULT_CLASSES,
  BUTTON_OUTLINE_CLASSES,
  BUTTON_SM_CLASSES,
  cn,
} from '../components/ui-classes';
import { studioJson } from './prompt-repo-client';

type Status = { configured: boolean; connected: boolean; login?: string };
type Device = { userCode: string; verificationUri: string; expiresAt: number; interval: number };
type Reply = { ok: boolean; error?: string };
export interface GithubConnectionProps {
  onConnected?: () => void;
  onConnectionChange?: () => void;
}
const storageKey = 'prompt-studio.github-client-id';
const endpoint = '/__studio/github';

function savedClientId() {
  try {
    return localStorage.getItem(storageKey) ?? '';
  } catch {
    return '';
  }
}

function useGithubConnection({ onConnected, onConnectionChange }: GithubConnectionProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [clientId, setClientId] = useState(savedClientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onConnected, onConnectionChange });
  callbacks.current = { onConnected, onConnectionChange };

  const checkStatus = useCallback(async () => {
    const started = ++generation.current;
    setError(null);
    await studioJson<Reply & Status>(`${endpoint}/status`)
      .then((result) => {
        if (started !== generation.current) return;
        if (!result.ok) throw new Error();
        setStatus(result);
      })
      .catch(() => {
        if (started === generation.current) setError('Could not check GitHub connection. Try again.');
      });
  }, []);
  useEffect(() => {
    void checkStatus();
    // Invalidate any in-flight status check on unmount; the counter is read at call time, not captured.
    const invalidate = () => {
      generation.current++;
    };
    return invalidate;
  }, [checkStatus]);

  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (Date.now() >= device!.expiresAt) {
        setDevice(null);
        setError('The sign-in code expired. Connect again for a new code.');
        return;
      }
      try {
        const result = await studioJson<
          Reply & { status: 'pending' | 'connected' | 'expired' | 'denied'; interval?: number; login?: string }
        >(`${endpoint}/poll`, { method: 'POST' });
        if (cancelled) return;
        if (!result.ok) throw new Error();
        if (result.status === 'pending') timer = setTimeout(poll, (result.interval ?? device!.interval) * 1000);
        else {
          setDevice(null);
          if (result.status === 'connected') {
            setStatus({ configured: true, connected: true, login: result.login });
            callbacks.current.onConnected?.();
            callbacks.current.onConnectionChange?.();
          } else
            setError(
              result.status === 'denied'
                ? 'GitHub sign-in was declined. Connect again when you are ready.'
                : 'The sign-in code expired. Connect again for a new code.',
            );
        }
      } catch {
        if (!cancelled) {
          setDevice(null);
          setError('GitHub connection was interrupted. Connect again to retry.');
        }
      }
    }
    timer = setTimeout(poll, device.interval * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [device]);

  async function connect() {
    const started = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await studioJson<Reply & Device>(`${endpoint}/device`, {
        method: 'POST',
        body: JSON.stringify(!status?.configured ? { clientId: clientId.trim() } : {}),
      });
      if (started !== generation.current) return;
      if (!result.ok) throw new Error();
      try {
        if (clientId.trim()) localStorage.setItem(storageKey, clientId.trim());
      } catch {
        /* Public ID persistence is optional. */
      }
      setStatus({ configured: true, connected: false });
      setDevice(result);
    } catch {
      if (started === generation.current) setError('Could not connect to GitHub. Check the app setup and try again.');
    } finally {
      if (started === generation.current) setBusy(false);
    }
  }

  async function disconnect() {
    const started = ++generation.current;
    setBusy(true);
    setError(null);
    setDevice(null);
    try {
      const result = await studioJson<Reply>(`${endpoint}/disconnect`, { method: 'POST' });
      if (started !== generation.current) return;
      if (!result.ok) throw new Error();
      setStatus((previous) => ({ configured: previous?.configured ?? false, connected: false }));
      callbacks.current.onConnectionChange?.();
    } catch {
      if (started === generation.current) setError('Could not disconnect from GitHub. Try again.');
    } finally {
      if (started === generation.current) setBusy(false);
    }
  }
  return { status, device, clientId, setClientId, busy, error, connect, disconnect, checkStatus };
}

export function GithubConnectionView({
  status,
  device,
  clientId,
  setClientId,
  busy,
  error,
  connect,
  disconnect,
  checkStatus,
}: ReturnType<typeof useGithubConnection>) {
  const primary = cn(BUTTON_BASE_CLASSES, BUTTON_DEFAULT_CLASSES, BUTTON_SM_CLASSES);
  const secondary = cn(BUTTON_BASE_CLASSES, BUTTON_OUTLINE_CLASSES, BUTTON_SM_CLASSES);
  return (
    <section aria-label="GitHub connection" className="min-w-0 space-y-3 rounded-md border border-border p-3 text-sm">
      <h3 className="font-medium">GitHub connection</h3>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!status && !error && <p role="status">Checking GitHub connection…</p>}
      {!status && error && (
        <button type="button" className={primary} onClick={() => void checkStatus()}>
          Retry connection status
        </button>
      )}
      {status?.connected ? (
        <>
          <p role="status">
            Connected as <strong>{status.login}</strong>
          </p>
          <button type="button" className={secondary} disabled={busy} onClick={() => void disconnect()}>
            Disconnect GitHub
          </button>
        </>
      ) : device ? (
        <>
          <p>Enter this code on GitHub to connect:</p>
          <p className="rounded-lg border border-border bg-muted/30 p-4 text-center font-mono text-2xl tracking-widest">
            {device.userCode}
          </p>
          <div className="flex flex-wrap gap-2">
            <a className={primary} href={device.verificationUri} target="_blank" rel="noreferrer">
              Open GitHub sign-in
            </a>
            <button type="button" className={secondary} disabled={busy} onClick={() => void disconnect()}>
              Cancel sign-in
            </button>
          </div>
          <p role="status" className="text-muted-foreground">
            Waiting for you to finish on GitHub… This code expires at{' '}
            {new Date(device.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
          </p>
        </>
      ) : (
        <>
          {status?.configured === false && (
            <label className="block space-y-1">
              <span>GitHub App client ID</span>
              <input
                className="w-full rounded border border-input bg-background px-2 py-2"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="Iv1.…"
                autoComplete="off"
              />
              <span className="block text-xs text-muted-foreground">
                One-time setup: use a GitHub App with device flow enabled. This public ID is not a password.
              </span>
            </label>
          )}
          {status && (
            <button
              type="button"
              className={primary}
              disabled={busy || (!status?.configured && !clientId.trim())}
              onClick={() => void connect()}
            >
              {busy ? 'Connecting…' : 'Connect GitHub'}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            Authorize in your browser to open private repositories and publish pull requests. You can keep editing
            locally without connecting.
          </p>
        </>
      )}
    </section>
  );
}

export function GithubConnection(props: GithubConnectionProps) {
  return <GithubConnectionView {...useGithubConnection(props)} />;
}
