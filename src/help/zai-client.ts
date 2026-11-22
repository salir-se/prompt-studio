/**
 * z.ai (GLM) client for the studio's help assistant (task #16) — PS-SCOPE ONLY by design: no
 * admin-console, no workers, no shared package. The studio is a localhost dev tool that the app
 * SPA already precedes in calling LLM providers directly from the browser, so the user's key
 * lives in this browser's localStorage and goes straight to z.ai's Anthropic-compatible
 * endpoint — the same canonical base URL and model the repo's agent stack uses
 * (`packages/agent`'s effective provider config: `https://api.z.ai/api/anthropic`, `glm-4.6`).
 *
 * Errors are user-readable but never leak the key: a failure surfaces the HTTP status plus the
 * API's own `error.message`, or a generic line when the body is unusable.
 */

const ZAI_BASE_URL = 'https://api.z.ai/api/anthropic';
const ANTHROPIC_VERSION = '2023-06-01';
export const ZAI_DEFAULT_MODEL = 'glm-4.6';

export interface HelpChatMessage {
  readonly role: 'user' | 'assistant';
  readonly model?: string;
  readonly content: string;
}

export interface SendZaiMessageInput {
  readonly apiKey: string;
  readonly model?: string;
  readonly system: string;
  readonly messages: readonly HelpChatMessage[];
}

export interface ZaiResponse {
  readonly text: string;
}

interface AnthropicMessagesBody {
  readonly content?: unknown;
  readonly error?: { message?: unknown; type?: unknown };
}

/** Sends one assistant turn. Throws `Error` with a safe, user-facing message on any failure. */
export async function sendZaiMessage(input: SendZaiMessageInput): Promise<ZaiResponse> {
  const response = await fetch(`${ZAI_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: input.model ?? ZAI_DEFAULT_MODEL,
      max_tokens: 1024,
      system: input.system,
      messages: input.messages.map(({ role, content }) => ({ role, content })),
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as AnthropicMessagesBody;
      if (typeof body.error?.message === 'string') {
        detail = `: ${body.error.message}`;
      }
    } catch {
      // Unreadable body — the status line below is the whole message.
    }
    throw new Error(`z.ai request failed (HTTP ${response.status})${detail}`);
  }

  const body = (await response.json()) as AnthropicMessagesBody;
  if (!Array.isArray(body.content)) {
    throw new Error('z.ai returned an unexpected response shape.');
  }
  const text = body.content
    .filter((block): block is { type: string; text?: unknown } => typeof block === 'object' && block !== null)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();
  if (text.length === 0) {
    throw new Error('z.ai returned no readable text.');
  }
  return { text };
}
