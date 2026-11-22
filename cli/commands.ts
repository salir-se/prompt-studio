/**
 * The CLI's pure argument parsing + result formatting (task #19): no I/O, no fetch — the whole
 * surface is table-testable. The CLI is an RPC formatter over the control API (ADR-236): every
 * subcommand maps to exactly one control command, and `formatResult` turns the JSON result into
 * the human output (`--json` prints the raw result instead).
 */

export interface ParsedCommand {
  readonly command: string;
  readonly args: unknown;
  readonly json: boolean;
  readonly port: number;
  readonly token?: string;
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
}

function parseFlags(argv: readonly string[]): { flags: CliOptions; positional: string[] } {
  const flags: CliOptions = { json: false, port: DEFAULT_PORT, stdin: false };
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
    else if (arg === '--port') flags.port = Number(next());
    else if (arg === '--token') flags.token = next();
    else if (arg === '--variant') flags.variant = next();
    else if (arg === '--file') flags.file = next();
    else if (arg === '--stdin') flags.stdin = true;
    else if (arg === '--message') flags.message = next();
    else if (arg === '--from') flags.from = next();
    else if (arg.startsWith('--')) throw new CliUsageError(`Unknown flag "${arg}".`);
    else positional.push(arg);
  }
  return { flags, positional };
}

const USAGE = `Usage: ps <command> [args] [--json] [--port N] [--token T]

Commands (each is one control-API call against the OPEN editor):
  docs                                        list every document in the catalog
  open <rootId> [--variant SYMBOL]            open a document in the editor
  read <rootId> [--variant SYMBOL]            print a document's text (working copy if open)
  edit <rootId> --file PATH | --stdin [-m MSG]  replace the OPEN document's text
  configs                                     list configurations (active marked)
  new-config <name> [--from BASELINE_ID]      create a configuration
  use-config <PROJECT_ID>                     switch the active configuration
  reset <rootId> [--variant SYMBOL]           reset the OPEN document to its shipped text
  history <rootId> [--variant SYMBOL]         the document's commits (newest first)

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

function flags2Parsed(flags: CliOptions): { json: boolean; port: number; token?: string } {
  return { json: flags.json, port: flags.port, ...(flags.token !== undefined ? { token: flags.token } : {}) };
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
