import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { useEffect, useRef, useState } from 'react';
import { CloseButton } from '../components/CloseButton';
import { PROVIDER_LABELS } from '../run/RunFields';
import type { RunProvider } from '../run/contracts';
import { HelpModelSettings } from './HelpModelSettings';
import { buildHelpSystemPrompt, type StudioHelpContext } from './studio-knowledge';
import { useHelpModel } from './use-help-model';
import { type HelpChatMessage, sendZaiMessage } from './zai-client';

/** Standalone Help uses App settings or its own model override. Developer mode retains the direct z.ai client. */

const KEY_STORAGE = 'prompt-studio:help:zai-key:v1';

export function loadHelpApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveHelpApiKey(key: string): void {
  try {
    if (key.length === 0) {
      localStorage.removeItem(KEY_STORAGE);
    } else {
      localStorage.setItem(KEY_STORAGE, key);
    }
  } catch {
    // Quota/disabled storage — the key just won't persist across reloads.
  }
}

export type SendFn = typeof sendZaiMessage;

export interface HelpPanelProps {
  readonly context: StudioHelpContext;
  readonly onClose: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Legacy developer-mode client injection; standalone requests use the Studio server. */
  readonly send?: SendFn;
}

export function HelpPanel({
  context,
  onClose,
  onDirtyChange,
  send = sendZaiMessage,
}: HelpPanelProps): React.JSX.Element {
  const model = useHelpModel();
  useEffect(() => {
    onDirtyChange?.(model.dirty);
  }, [model.dirty, onDirtyChange]);
  const [apiKey, setApiKey] = useState(loadHelpApiKey);
  const [keyDraft, setKeyDraft] = useState('');
  const [messages, setMessages] = useState<readonly HelpChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest exchange in view as the conversation grows. `messages`/`busy` are pure
  // re-run triggers (the body reads only the ref), which is exactly what biome objects to.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const loggedIn = model.workspace
    ? model.connected && !model.dirty && !model.loading && !model.saving
    : apiKey.length > 0;

  async function handleSend(): Promise<void> {
    const question = draft.trim();
    if (question.length === 0 || busy || !loggedIn) return;
    const nextMessages: readonly HelpChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setDraft('');
    setError(null);
    setBusy(true);
    try {
      const reply: { text: string; provider?: RunProvider; model?: string } = model.workspace
        ? await model.send(context, nextMessages)
        : await send({
            apiKey,
            system: buildHelpSystemPrompt(context),
            messages: nextMessages,
          });
      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: reply.text,
          ...(reply.provider && reply.model ? { model: `${PROVIDER_LABELS[reply.provider]} · ${reply.model}` } : {}),
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      // The question stays in the transcript; the user can retry with a new send.
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      aria-label="Help assistant"
      data-testid="help-drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[520px] max-w-full flex-col border-l border-border bg-card shadow-xl"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold">Help assistant</h2>
          <p className="text-[11px] text-muted-foreground">
            {model.workspace
              ? 'Uses your model settings · optional separate Help model'
              : loggedIn
                ? 'z.ai (GLM) — key kept in this browser only'
                : 'Prompt authoring guidance · optional AI assistant'}
          </p>
        </div>
        <CloseButton onClick={onClose} label="Close help" />
      </header>

      <details
        className="shrink-0 border-b border-border bg-muted/20 px-4 py-3"
        open={model.workspace ? !model.connected && !model.draft && !model.loading : !loggedIn}
      >
        <summary className="cursor-pointer text-xs font-medium">Quick guide · no connection needed</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs leading-5 text-muted-foreground">
          <li>Create or open a project, then choose a prompt in Explorer.</li>
          <li>Edit in Write. Apply updates the working prompt; Versions creates a named project checkpoint.</li>
          <li>Use Verify for checks and criteria. Run a prompt only when you choose to send a request to a model.</li>
          <li>Use Final prompt to inspect source Markdown or a sample preview.</li>
        </ol>
      </details>
      {model.workspace ? (
        <HelpModelSettings model={model} disabled={busy} />
      ) : !loggedIn ? (
        <form
          className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            const key = keyDraft.trim();
            if (key.length === 0) return;
            saveHelpApiKey(key);
            setApiKey(key);
            setKeyDraft('');
          }}
        >
          <h3 className="text-sm font-semibold">Connect z.ai</h3>
          <p id="help-key-storage" className="text-xs leading-5 text-muted-foreground">
            This key is saved in this browser across sessions and sent directly to z.ai with your questions and studio
            context. Disconnect to remove it. This connection is separate from Run model settings.
          </p>
          <label htmlFor="help-api-key" className="text-xs text-muted-foreground">
            z.ai API key
          </label>
          <input
            id="help-api-key"
            aria-describedby="help-key-storage"
            type="password"
            autoComplete="off"
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            placeholder="sk-…"
            className="rounded border border-border bg-background px-2 py-1 font-mono text-xs"
          />
          <button
            type="submit"
            className="w-fit rounded border border-border bg-primary px-3 py-1 text-xs text-primary-foreground"
          >
            Connect z.ai
          </button>
        </form>
      ) : (
        <button
          type="button"
          aria-label="Disconnect the help assistant"
          onClick={() => {
            saveHelpApiKey('');
            setApiKey('');
            setMessages([]);
            setError(null);
          }}
          className="shrink-0 border-b border-border px-4 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
        >
          Disconnect z.ai (removes the key from this browser)
        </button>
      )}

      <TimelineScrollRegion
        viewportRef={listRef}
        className="min-h-0 flex-1"
        viewportClassName="flex flex-col gap-2 px-4 py-3"
        data-testid="help-messages"
      >
        {!!messages.length && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            className="self-start text-xs underline"
          >
            New conversation
          </button>
        )}
        {messages.length === 0 && !busy && (
          <p className="text-xs text-muted-foreground">
            Ask about authoring prompts — e.g. “how do I add an input variable?” or “how do I compare two versions?”
          </p>
        )}
        {messages.map((message, index) => (
          // The transcript is strictly append-only within a session — never reordered or
          // spliced — so the index is a stable identity here.
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'self-end rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground'
                : 'self-start max-w-full break-words rounded-lg border border-border px-3 py-1.5 text-xs whitespace-pre-wrap'
            }
          >
            {message.model && <p className="mb-1 break-all text-[10px] text-muted-foreground">{message.model}</p>}
            {message.content}
          </div>
        ))}
        {busy && <div className="self-start text-xs text-muted-foreground">thinking…</div>}
        {error !== null && (
          <p
            role="alert"
            className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-red-700 dark:text-red-300"
          >
            {error}
          </p>
        )}
      </TimelineScrollRegion>

      <form
        className="flex shrink-0 gap-2 border-t border-border px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
      >
        <input
          aria-label="Ask the help assistant"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!loggedIn || busy}
          placeholder={
            loggedIn ? 'How do I…' : model.workspace ? 'Choose a connected model above' : 'Connect above to ask'
          }
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={!loggedIn || busy || draft.trim().length === 0}
          className="rounded border border-border bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </aside>
  );
}
