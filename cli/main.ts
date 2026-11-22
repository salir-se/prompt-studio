import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  COMMAND_CATALOG,
  ControlClient,
  ControlConnectionError,
  type ControlError,
  controlError,
  EXIT_CODES,
  exitCodeFor,
  localControlUrl,
} from '@prompt-studio/control-protocol';
import { ControlCallError, callCommand, discoverToken } from './client';
import {
  CliUsageError,
  formatCapabilities,
  formatResult,
  formatTargets,
  type ParsedCommand,
  parseArgs,
} from './commands';

/**
 * The CLI entry (task #19; docs/remote-control.md): parse → connect to the Studio's WebSocket gateway → one
 * request → print. stdout carries the result only (`--json`: raw JSON; a failure with `--json` prints
 * `{"ok":false,"error":{...}}`); diagnostics go to stderr. Exit codes come from the protocol's `exitCodeFor`
 * (0 ok, 1 command failed, 2 usage, 3 cannot connect, 4 target, 5 timeout/disconnect).
 *
 * Run from the repo: `bun run ps -- <command>` (package.json script), or directly:
 * `bun cli/main.ts <command>`. The npm package bundles this module and drives `runCli` from its own
 * `bin/prompt-studio-cli.js` launcher (ADR-204 amendment 2026-09-15) — same export, different shell.
 */

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

const consoleIo: CliIo = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

/**
 * Exit code for a failure. A transport error with `outcome: 'none'` happened before anything was sent
 * (no Studio, refused connection), so it is a connection failure (3), not a lost command (5).
 */
export function cliExitCode(error: ControlError): number {
  if ((error.code === 'disconnected' || error.code === 'timeout') && error.outcome === 'none') {
    return EXIT_CODES.connection;
  }
  return exitCodeFor(error.code);
}

function report(io: CliIo, json: boolean, error: ControlError): number {
  if (json) {
    io.out(JSON.stringify({ ok: false, error }));
  } else {
    io.err(`Error (${error.code}): ${error.message}`);
    if (error.outcome === 'unknown') io.err('The command may have run. Check the editor before you retry a change.');
    for (const candidate of error.candidates ?? []) {
      io.err(`  --target ${candidate.browserId}  ${candidate.projectName ?? '-'}  ${candidate.documentId ?? '-'}`);
    }
  }
  return cliExitCode(error);
}

async function commandArgs(parsed: ParsedCommand): Promise<unknown> {
  // `edit` carries its text out-of-band (file or stdin) — lift it into the args before the RPC.
  let args = parsed.args as Record<string, unknown>;
  if (parsed.command === 'editDocument' || (parsed.command === 'editSection' && 'source' in args)) {
    const field = parsed.command === 'editDocument' ? 'text' : 'body';
    if (args.source === 'stdin') {
      args = { ...args, [field]: await readStdin() };
    } else if (typeof args.source === 'string') {
      args = { ...args, [field]: await readFile(args.source, 'utf8') };
    }
    const { source: _source, ...rest } = args;
    args = rest;
  }
  return args;
}

export async function runCli(argv: readonly string[], io: CliIo = consoleIo): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.err(error.message);
      return EXIT_CODES.usage;
    }
    throw error;
  }

  let token: string;
  try {
    token = await discoverToken(parsed.port, parsed.token);
  } catch (error) {
    if (error instanceof ControlCallError) return report(io, parsed.json, error.error);
    throw error;
  }

  let args: unknown;
  try {
    args = await commandArgs(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return report(io, parsed.json, controlError('invalid_input', `Cannot read the new text: ${message}`));
  }

  if (parsed.transport === 'http') return runHttp(parsed, token, args, io);

  let client: ControlClient;
  try {
    client = await ControlClient.connect({ url: localControlUrl(parsed.port), token });
  } catch (error) {
    if (error instanceof ControlConnectionError) return report(io, parsed.json, error.error);
    throw error;
  }
  try {
    if (parsed.kind === 'targets') {
      const targets = await client.listTargets();
      io.out(parsed.json ? JSON.stringify(targets, null, 2) : formatTargets(targets));
      return EXIT_CODES.ok;
    }
    if (parsed.kind === 'capabilities') {
      io.out(parsed.json ? JSON.stringify(client.commands, null, 2) : formatCapabilities(client.commands));
      return EXIT_CODES.ok;
    }
    const result = await client.command({
      action: parsed.command,
      params: args,
      ...(parsed.target === undefined ? {} : { target: { browserId: parsed.target } }),
      ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
    });
    if (result.state === 'completed') {
      io.out(parsed.json ? JSON.stringify(result.data ?? null, null, 2) : formatResult(parsed.command, result.data));
      return EXIT_CODES.ok;
    }
    return report(io, parsed.json, result.error ?? controlError('internal', 'The Studio sent no error.'));
  } catch (error) {
    if (error instanceof ControlConnectionError) return report(io, parsed.json, error.error);
    throw error;
  } finally {
    client.close();
  }
}

/** The deprecated HTTP relay (`--transport http`), kept for one release. */
async function runHttp(parsed: ParsedCommand, token: string, args: unknown, io: CliIo): Promise<number> {
  io.err('Note: --transport http is deprecated; the WebSocket transport is the default.');
  if (parsed.kind === 'targets') {
    return report(io, parsed.json, controlError('invalid_input', 'targets needs the WebSocket transport.'));
  }
  if (parsed.kind === 'capabilities') {
    io.out(parsed.json ? JSON.stringify(COMMAND_CATALOG, null, 2) : formatCapabilities(COMMAND_CATALOG));
    return EXIT_CODES.ok;
  }
  try {
    const result = await callCommand(
      { port: parsed.port, token, ...(parsed.target === undefined ? {} : { browserId: parsed.target }) },
      parsed.command,
      args,
    );
    io.out(parsed.json ? JSON.stringify(result, null, 2) : formatResult(parsed.command, result));
    return EXIT_CODES.ok;
  } catch (error) {
    if (error instanceof ControlCallError) return report(io, parsed.json, error.error);
    throw error;
  }
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
