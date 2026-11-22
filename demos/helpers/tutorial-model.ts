import { createServer } from 'node:http';

/**
 * Loopback-only, deterministic OpenAI-compatible model for the tutorial recording. The video says it is a
 * local test model; the request still travels through Prompt Studio's real provider adapter.
 */
export function triageReply(message: string, prompt = ''): string {
  const text = message.toLowerCase();
  const securityLevel = /^- urgent:/m.test(prompt) && /someone else|hacked|exposed|changed my email/.test(text);
  const category = /invoice|charge|refund|billing|plan/.test(text)
    ? 'billing'
    : /sign in|password|locked|two-factor|log in/.test(text)
      ? 'access'
      : /error|crash|broken|bug|does not work/.test(text)
        ? 'bug'
        : 'question';
  const urgency = securityLevel
    ? 'urgent'
    : /twice|cannot|can't|locked out|charged|someone else/.test(text)
      ? 'high'
      : category === 'question'
        ? 'low'
        : 'normal';
  const nextStep =
    category === 'billing'
      ? 'Ask the billing team to compare the two charges and reply with the invoice numbers.'
      : category === 'access'
        ? 'Send the account-recovery steps and confirm the sign-in email address.'
        : category === 'bug'
          ? 'Ask for the steps to reproduce and create a bug ticket.'
          : 'Reply with the matching help article.';
  return JSON.stringify({ category, urgency, next_step: nextStep });
}

/**
 * AI review: one finding linked to the authored criterion about `next_step` (or else the output contract), quoting the
 * prompt's own `next_step` instruction. Returns `[]` when the scope has no such criterion or quote, so the
 * server's checks (known criterion ID, exact quote) always hold.
 */
export function reviewReply(system: string, user: string): string {
  const parsed = parseReview(system, user);
  if (!parsed) return '[]';
  const { criteria, fragment } = parsed;
  const criterion =
    criteria.find((item) => item.owner !== 'platform' && /^next_step\b/.test(item.statement)) ??
    criteria.find((item) => /output contract/i.test(item.statement));
  const quote = /"next_step": "[^"\n]*"/.exec(fragment)?.[0];
  if (!criterion || !quote) return '[]';
  return JSON.stringify([
    {
      principleId: criterion.id,
      evidenceQuote: quote,
      message:
        'next_step only asks for "one sentence", so the model can restate the problem instead of naming an action for the support team.',
      proposedCorrection:
        'Describe next_step as one action the support team can take today, for example "Ask the billing team to compare the two charges."',
    },
  ]);
}

type Criterion = { id: string; statement: string; owner?: string };

function parseReview(system: string, user: string): { criteria: Criterion[]; fragment: string } | null {
  try {
    const criteria: Criterion[] = JSON.parse(/^Criteria: (.*)$/m.exec(system)?.[1] ?? '[]');
    const fragment: string = JSON.parse(user).fragment?.text ?? '';
    return { criteria, fragment };
  } catch {
    return null;
  }
}

/** The customer message inside the rendered prompt, or the whole text when the tag is absent. */
function customerMessage(text: string): string {
  return /<customer_message>([\s\S]*?)<\/customer_message>/.exec(text)?.[1] ?? text;
}

export async function startTutorialModel() {
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const messages: { role: string; content: unknown }[] = body.messages ?? [];
    const system = String(messages.find((m) => m.role === 'system')?.content ?? '');
    const user = messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
    const output =
      /verdict/.test(system) && /rubric/i.test(system)
        ? JSON.stringify({
            verdict: 'B',
            reason: 'B marks the account takeover as urgent, names a concrete next step and keeps the JSON contract.',
          })
        : /Review the selected prompt scope/.test(system)
          ? reviewReply(system, user)
          : triageReply(customerMessage(`${system}\n${user}`), `${system}\n${user}`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: crypto.randomUUID(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 180, completion_tokens: 40, total_tokens: 220 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The tutorial model could not start.');
  return { url: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}
