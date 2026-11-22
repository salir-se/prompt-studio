import { createProvider, type LlmChatResponse, type LlmProvider } from '@prompt-studio/agent';
import type { RunProvider } from '../../src/run/contracts';

/** Only constructs the provider; runOneShot owns its execution. */
export function createStudioModelProvider(
  id: RunProvider,
  credential: { apiKey: string; baseUrl?: string },
  factory?: (id: RunProvider, credential: { apiKey: string; baseUrl?: string }) => LlmProvider,
): LlmProvider {
  return factory
    ? factory(id, credential)
    : createProvider(id, {
        ...credential,
        baseUrl: credential.baseUrl || undefined,
        timeoutMs: 300_000,
        retry: { maxAttempts: 1 },
      });
}

/** Preserve the exact response metadata while the shared runner owns the call. */
export function observeModelReply(provider: LlmProvider) {
  let reply: LlmChatResponse | undefined;
  return {
    reply: () => reply,
    provider: {
      id: provider.id,
      name: provider.name,
      async chat(request) {
        reply = await provider.chat(request);
        return reply;
      },
      chatStream: (request, callbacks) => provider.chatStream(request, callbacks),
      testConnection: (model) => provider.testConnection(model),
    } satisfies LlmProvider,
  };
}
