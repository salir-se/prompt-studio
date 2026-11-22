import { runOneShot } from '@prompt-studio/agent';
import { type } from 'arktype';
import { buildHelpSystemPrompt } from '../../src/help/studio-knowledge';
import { createStudioModelProvider, observeModelReply } from './model-provider';
import type { RunSettingsStore } from './run-settings';

const requestSchema = type({
  '+': 'reject',
  context: {
    '+': 'reject',
    manifestName: 'string <= 256',
    rootCount: 'number.integer >= 0',
    selectedRootTitle: 'string <= 256 | null',
  },
  messages: type({ '+': 'reject', role: "'user' | 'assistant'", content: 'string > 0 & string <= 16000' })
    .array()
    .atLeastLength(1)
    .atMostLength(32),
});
export function createHelpResponder(
  settings: RunSettingsStore,
  factory?: Parameters<typeof createStudioModelProvider>[2],
) {
  let active = false;
  return async (raw: unknown, signal: AbortSignal) => {
    const input = requestSchema(raw);
    if (
      input instanceof type.errors ||
      input.messages.at(-1)?.role !== 'user' ||
      Buffer.byteLength(JSON.stringify(input)) > 128_000
    )
      throw new Error(
        'Send a question with at most 32 conversation messages and 128 KiB of context. Start a new conversation for a longer session.',
      );
    const config = await settings.value();
    const selected = config.helpModel ?? config;
    const credential = settings.credential(selected.provider);
    if (!selected.model.trim() || !credential)
      throw new Error('Choose a model and connect its provider in App settings before asking Help.');
    if (active) throw new Error('Help is answering another question. Wait for it to finish and retry.');
    active = true;
    try {
      const observed = observeModelReply(createStudioModelProvider(selected.provider, credential, factory));
      const reply = await runOneShot({
        agentName: 'prompt-studio-help',
        runId: crypto.randomUUID(),
        provider: observed.provider,
        systemPrompt: buildHelpSystemPrompt(input.context),
        userMessage: input.messages.at(-1)!.content,
        initialMessages: input.messages,
        request: { model: selected.model, maxTokens: 1024 },
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      });
      if (!reply.text.trim() || Buffer.byteLength(reply.text) > 64_000) throw new Error('Invalid Help reply');
      return { text: reply.text, provider: selected.provider, model: observed.reply()?.model ?? selected.model };
    } catch {
      throw new Error('Help could not get a reply. Check the model connection in App settings and retry.');
    } finally {
      active = false;
    }
  };
}
