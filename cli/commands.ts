/**
 * The CLI's pure argument parsing + result formatting (task #19): no I/O, no fetch — the whole
 * surface is table-testable. The CLI is an RPC formatter over the control API (ADR-236): every
 * subcommand maps to exactly one control command, and `formatResult` turns the JSON result into
 * the human output (`--json` prints the raw result instead).
 */

export type Transport = 'ws' | 'http';

export interface ParsedCommand {
  /** `command` runs a control command in a tab; `targets` and `capabilities` are answered by the Studio. */
  readonly kind: 'command' | 'targets' | 'capabilities';
  readonly command: string;
  readonly args: unknown;
  readonly json: boolean;
  readonly port: number;
  readonly token?: string;
  /** browserId of the tab to drive; omitted = the only ready tab. */
  readonly target?: string;
  readonly timeoutMs?: number;
  readonly transport: Transport;
}

export class CliUsageError extends Error {}

const DEFAULT_PORT = 5273;

interface CliOptions {
  json: boolean;
  port: number;
  token?: string;
  variant?: string;
  file?: string;
  stdin: boolean;
  message?: string;
  from?: string;
  target?: string;
  timeoutMs?: number;
  transport: Transport;
}

function parseFlags(argv: readonly string[]): { flags: CliOptions; positional: string[] } {
  const flags: CliOptions = { json: false, port: DEFAULT_PORT, stdin: false, transport: 'ws' };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new CliUsageError(`${arg} needs a value.`);
      i += 1;
      return value;
    };
    if (arg === '--json') flags.json = true;
    else if (arg === '--port') {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 1 || value > 65_535)
        throw new CliUsageError('--port needs a port number.');
      flags.port = value;
    } else if (arg === '--token') flags.token = next();
    else if (arg === '--variant') flags.variant = next();
    else if (arg === '--file') flags.file = next();
    else if (arg === '--stdin') flags.stdin = true;
    else if (arg === '--message' || arg === '-m') flags.message = next();
    else if (arg === '--from') flags.from = next();
    else if (arg === '--target') flags.target = next();
    else if (arg === '--timeout') {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 1 || value > 300_000) {
        throw new CliUsageError('--timeout needs milliseconds from 1 to 300000.');
      }
      flags.timeoutMs = value;
    } else if (arg === '--transport') {
      const value = next();
      if (value !== 'ws' && value !== 'http') throw new CliUsageError('--transport is ws or http.');
      flags.transport = value;
    } else if (arg.startsWith('--')) throw new CliUsageError(`Unknown flag "${arg}".`);
    else positional.push(arg);
  }
  return { flags, positional };
}

const USAGE = `Usage: ps <command> [args] [flags]

Studio commands (answered by the Studio itself):
  targets                                     list the open editor tabs (browserId, project, document, view)
  capabilities                                list the commands the Studio accepts, with their parameters

Editor commands (each runs in ONE open editor tab):
  docs                                        list every document in the catalog
  open <rootId> [--variant SYMBOL]            open a document in the editor
  read <rootId> [--variant SYMBOL]            print a document's text (working copy if open)
  edit <rootId> --file PATH | --stdin [-m MSG]  replace the OPEN document's text
  configs                                     list configurations (active marked)
  new-config <name> [--from BASELINE_ID]      create a configuration
  use-config <PROJECT_ID>                     switch the active configuration
  reset <rootId> [--variant SYMBOL]           reset the OPEN document to its shipped text
  history <rootId> [--variant SYMBOL]         the document's commits (newest first)

Flags:
  --json                 print the raw JSON result; a failure prints {"ok":false,"error":{...}} to stdout
  --target BROWSER_ID    the tab to drive (see "ps targets"); needed when several tabs are open
  --timeout MS           how long to wait for the tab (default 30000)
  --port N               Studio port (default 5273)
  --token T              control token (default: PROMPT_STUDIO_CONTROL_TOKEN, then the token file)
  --transport ws|http    ws (default) or the deprecated HTTP relay

Exit codes: 0 ok, 1 command failed, 2 usage, 3 cannot connect, 4 no/ambiguous target, 5 timeout or disconnect.
The studio must be running (bun run dev) with a browser tab open — the CLI drives that tab.`;

export function usage(): string {
  return USAGE;
}

/** Parses `argv` (without the node/bun binary + script path) into one control call. */
export function parseArgs(argv: readonly string[]): ParsedCommand {
  const { flags, positional } = parseFlags(argv);
  const [name, rootId] = positional;
  const documentArgs = (): { rootId: string; variantSymbol?: string } => {
    if (rootId === undefined) throw new CliUsageError(`${name} needs a document id — run "ps docs".`);
    return flags.variant === undefined ? { rootId } : { rootId, variantSymbol: flags.variant };
  };

  switch (name) {
    case 'targets':
      return { ...flags2Parsed(flags), kind: 'targets', command: 'targets', args: {} };
    case 'capabilities':
      return { ...flags2Parsed(flags), kind: 'capabilities', command: 'capabilities', args: {} };
    case 'docs':
      return { command: 'listDocuments', args: {}, ...flags2Parsed(flags) };
    case 'open':
      return { command: 'openDocument', args: documentArgs(), ...flags2Parsed(flags) };
    case 'read':
      return { command: 'readDocument', args: documentArgs(), ...flags2Parsed(flags) };
    case 'edit': {
      const args = documentArgs();
      if (flags.file === undefined && !flags.stdin) {
        throw new CliUsageError('edit needs --file PATH or --stdin.');
      }
      return {
        command: 'editDocument',
        args: { ...args, source: flags.file ?? 'stdin', message: flags.message },
        ...flags2Parsed(flags),
      };
    }
    case 'configs':
      return { command: 'listConfigurations', args: {}, ...flags2Parsed(flags) };
    case 'new-config': {
      if (rootId === undefined) throw new CliUsageError('new-config needs a name.');
      return {
        command: 'createConfiguration',
        args: { name: rootId, fromBaseline: flags.from ?? 'default' },
        ...flags2Parsed(flags),
      };
    }
    case 'use-config': {
      if (rootId === undefined) throw new CliUsageError('use-config needs a project id — run "ps configs".');
      return { command: 'switchConfiguration', args: { projectId: rootId }, ...flags2Parsed(flags) };
    }
    case 'reset':
      return { command: 'resetDocument', args: documentArgs(), ...flags2Parsed(flags) };
    case 'history':
      return { command: 'history', args: documentArgs(), ...flags2Parsed(flags) };
    case 'help':
    case undefined:
      throw new CliUsageError(USAGE);
    default:
      throw new CliUsageError(`Unknown command "${name}".\n\n${USAGE}`);
  }
}

function flags2Parsed(flags: CliOptions): Omit<ParsedCommand, 'command' | 'args'> {
  return {
    kind: 'command',
    json: flags.json,
    port: flags.port,
    transport: flags.transport,
    ...(flags.token !== undefined ? { token: flags.token } : {}),
    ...(flags.target !== undefined ? { target: flags.target } : {}),
    ...(flags.timeoutMs !== undefined ? { timeoutMs: flags.timeoutMs } : {}),
  };
}

/** Human-readable list of open editor tabs (`ps targets`). */
export function formatTargets(
  targets: readonly {
    browserId: string;
    ready: boolean;
    projectName: string | null;
    documentId: string | null;
    view: string | null;
  }[],
): string {
  if (targets.length === 0) return '(no editor tab is connected)';
  return targets
    .map(
      (target) =>
        `${target.browserId}  ${target.ready ? 'ready' : 'loading'}  ${target.projectName ?? '-'}  ${target.documentId ?? '-'}${target.view === null ? '' : ` (${target.view})`}`,
    )
    .join('\n');
}

/** Human-readable command list (`ps capabilities`). */
export function formatCapabilities(
  commands: readonly { name: string; description: string; completionLevels: readonly string[] }[],
): string {
  const width = Math.max(...commands.map((command) => command.name.length), 4);
  return commands
    .map((command) => `${command.name.padEnd(width)}  ${command.description}  [${command.completionLevels.join(', ')}]`)
    .join('\n');
}

/** Human-readable rendering of one command's result (`--json` callers never get here). */
export function formatResult(command: string, result: unknown): string {
  switch (command) {
    case 'listDocuments': {
      const rows = result as Array<{ id: string; title: string; loadability: string }>;
      const width = Math.max(...rows.map((row) => row.id.length), 3);
      return rows.map((row) => `${row.id.padEnd(width)}  ${row.title}  (${row.loadability})`).join('\n');
    }
    case 'readDocument': {
      const body = result as { rootId: string; text: string; source: string };
      return `${body.text}\n\n— ${body.rootId} (${body.source})`;
    }
    case 'listConfigurations': {
      const body = result as { activeProjectId: string; projects: Array<{ id: string; name: string }> };
      return body.projects
        .map((project) => `${project.id === body.activeProjectId ? '*' : ' '} ${project.id.padEnd(24)} ${project.name}`)
        .join('\n');
    }
    case 'history': {
      const commits = result as Array<{ id: string; message: string; timestampMs: number }>;
      if (commits.length === 0) return '(no commits)';
      return commits
        .map(
          (commit) =>
            `${commit.id.slice(0, 7)}  ${new Date(commit.timestampMs).toISOString().slice(0, 16).replace('T', ' ')}  ${commit.message}`,
        )
        .join('\n');
    }
    default:
      return JSON.stringify(result, null, 2);
  }
}
