import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { callCommand, discoverToken } from './client';
import { CliUsageError, formatResult, parseArgs } from './commands';

/**
 * The CLI entry (task #19): parse → one control-API RPC → print. Errors print their message
 * only (never a stack — the messages are written to be the diagnostic), exit 1. Usage errors
 * print the help and exit 2.
 *
 * Run from the repo: `bun run ps -- <command>` (package.json script), or directly:
 * `bun apps/prompt-studio/cli/main.ts <command>`. The npm package bundles this module and
 * drives `runCli` from its own `bin/prompt-studio-cli.js` launcher (ADR-204 amendment
 * 2026-09-15) — same export, different shell.
 */

export async function runCli(argv: readonly string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  const token = await discoverToken(parsed.port, parsed.token);

  // `edit` carries its text out-of-band (file or stdin) — lift it into the args before the RPC.
  let args = parsed.args as Record<string, unknown>;
  if (parsed.command === 'editDocument') {
    if (args.source === 'stdin') {
      args = { ...args, text: await readStdin() };
    } else if (typeof args.source === 'string') {
      args = { ...args, text: await readFile(args.source, 'utf8') };
    }
    const { source: _source, ...rest } = args;
    args = rest;
  }

  const result = await callCommand({ port: parsed.port, token }, parsed.command, args);
  console.log(parsed.json ? JSON.stringify(result, null, 2) : formatResult(parsed.command, result));
  return 0;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  });
}

// Only run when this file is executed directly (`bun cli/main.ts`, or the npm package's bundled
// `cli/main.js`) — not when the npm package's launcher imports `runCli`, which invokes it
// explicitly with its own argv. The comparison is portable (no Bun-only `import.meta.path`):
// under Bun and Node alike, `import.meta.url` is this module's file URL, and the `endsWith`
// fallbacks keep both the source (.ts) and bundled (.js) direct invocations working.
const selfPath = fileURLToPath(import.meta.url);
const isEntryPoint =
  process.argv[1] === selfPath || process.argv[1]?.endsWith('cli/main.ts') || process.argv[1]?.endsWith('cli/main.js');
if (isEntryPoint) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
