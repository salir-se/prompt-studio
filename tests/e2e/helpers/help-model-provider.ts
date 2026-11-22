import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
/** Real provider-adapter fixture used by the Help browser test and its demo, with no paid calls. */
export async function startHelpModelProvider() {
  const models: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    models.push(body.model);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: crypto.randomUUID(),
        object: 'chat.completion',
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: `${body.model}: Open Your prompts → Versions, enter a version message and choose Save version.`,
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 60, completion_tokens: 20, total_tokens: 80 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    models,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
