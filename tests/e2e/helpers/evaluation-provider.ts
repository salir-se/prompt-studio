import { createServer } from 'node:http';

/** Loopback-only deterministic model fixture; the demo still traverses the real provider adapter. */
export async function startEvaluationProvider() {
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const system = body.messages.find((message: { role: string }) => message.role === 'system')?.content ?? '';
    const user = body.messages.find((message: { role: string }) => message.role === 'user')?.content ?? '';
    const label = user.includes('Refund requested') ? 'negative' : 'positive';
    const output = system.includes('Review the selected prompt scope')
      ? '[]'
      : system.includes('verdict') && system.includes('rubric')
        ? JSON.stringify({ verdict: 'B', reason: 'Candidate B returns the requested JSON label and cites the policy.' })
        : system.includes('Return JSON')
          ? JSON.stringify({ label, evidence: 'Policy: sentiment reflects satisfaction or dissatisfaction.' })
          : label;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: crypto.randomUUID(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The local evaluation fixture could not start.');
  return { url: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}
