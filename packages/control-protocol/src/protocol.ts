/**
 * Prompt Studio remote-control protocol over WebSocket (docs/remote-control.md).
 *
 * Browser-safe and dependency-free: the gateway (server), the editor tab (browser), the CLI and the MCP
 * server all import these shapes, so a message can only mean one thing on every side.
 */

export const PROTOCOL_VERSION = '1.0';
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PROTOCOL_VERSION];

/** WebSocket path on the Studio server. */
export const CONTROL_WS_PATH = '/__control/ws';

/** Largest accepted frame: 2 MiB of command payload plus 4 KiB of envelope. */
export const MAX_FRAME_BYTES = 2 * 1024 * 1024 + 4 * 1024;
/** Commands one controller may have in flight at once. */
export const MAX_PENDING_PER_CONTROLLER = 32;
/** A connection that has not completed `hello` within this time is closed. */
export const HELLO_TIMEOUT_MS = 5_000;
/** Default and maximum time a controller waits for one command. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const MAX_COMMAND_TIMEOUT_MS = 300_000;

export type Role = 'browser' | 'controller';

/**
 * Stable, machine-readable error codes (spec RC-33). Never renamed; new codes may be added.
 */
export const ERROR_CODES = [
  'invalid_input',
  'unsupported_version',
  'unsupported_command',
  'unsupported_completion',
  'unauthorized',
  'forbidden',
  'ambiguous_target',
  'missing_target',
  'not_ready',
  'duplicate_command',
  'too_many_pending',
  'payload_too_large',
  'timeout',
  'disconnected',
  'command_failed',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** `none`: the command had no effect. `unknown`: it may have taken effect; query before retrying a write. */
export type Outcome = 'none' | 'unknown';

export interface ControlError {
  readonly code: ErrorCode;
  readonly message: string;
  /** For `timeout` and `disconnected`: whether the command may have taken effect. */
  readonly outcome?: Outcome;
  /** For `ambiguous_target`: the eligible targets, so a caller can choose one. */
  readonly candidates?: readonly TargetSummary[];
}

/** CLI exit codes (spec RC-34). 0 is success. */
export const EXIT_CODES = {
  ok: 0,
  commandFailed: 1,
  usage: 2,
  connection: 3,
  target: 4,
  timeout: 5,
} as const;

export function exitCodeFor(code: ErrorCode): number {
  switch (code) {
    case 'invalid_input':
    case 'unsupported_command':
    case 'unsupported_completion':
      return EXIT_CODES.usage;
    case 'unsupported_version':
    case 'unauthorized':
    case 'forbidden':
    case 'payload_too_large':
    case 'too_many_pending':
      return EXIT_CODES.connection;
    case 'ambiguous_target':
    case 'missing_target':
    case 'not_ready':
      return EXIT_CODES.target;
    case 'timeout':
    case 'disconnected':
      return EXIT_CODES.timeout;
    default:
      return EXIT_CODES.commandFailed;
  }
}

/** What a browser tab reports about itself; shown by `targets list`. */
export interface BrowserState {
  /** True once the editor has loaded a project and can run commands. */
  readonly ready: boolean;
  readonly projectId: string | null;
  readonly projectName: string | null;
  /** The open document id, if any. */
  readonly documentId: string | null;
  /** The active view, e.g. `write`, `graph`, `design`; null when no document is open. */
  readonly view: string | null;
}

export interface TargetSummary extends BrowserState {
  readonly browserId: string;
  readonly connectedAt: string;
}

export type CompletionLevel = 'committed' | 'applied' | 'rendered';

export interface CommandTarget {
  readonly browserId?: string;
}

// ── Messages ────────────────────────────────────────────────────────────────────────────────────

export interface HelloMessage {
  readonly type: 'hello';
  readonly protocolVersions: readonly string[];
  readonly role: Role;
  readonly token: string;
  /** Browser only: a previous browserId to keep across a reload of the same tab. */
  readonly resumeBrowserId?: string;
  /** Browser only: the tab's initial state. */
  readonly state?: BrowserState;
}

export interface WelcomeMessage {
  readonly type: 'welcome';
  readonly protocolVersion: string;
  readonly role: Role;
  readonly browserId?: string;
  readonly commands: readonly CommandDescriptor[];
  readonly limits: { readonly maxFrameBytes: number; readonly maxPending: number; readonly maxTimeoutMs: number };
}

export interface CommandMessage {
  readonly type: 'command';
  /** One transport attempt. */
  readonly requestId: string;
  /** The logical operation; stable across retries of the same intent. */
  readonly commandId: string;
  readonly target?: CommandTarget;
  readonly action: string;
  readonly params?: unknown;
  readonly waitFor?: CompletionLevel;
  readonly timeoutMs?: number;
}

export interface CommandAcceptedMessage {
  readonly type: 'command.accepted';
  readonly requestId: string;
  readonly commandId: string;
  readonly target: { readonly browserId: string };
}

export interface CommandResultMessage {
  readonly type: 'command.result';
  readonly requestId: string;
  readonly commandId: string;
  readonly state: 'completed' | 'failed';
  readonly completionLevel?: CompletionLevel;
  readonly target?: { readonly browserId: string };
  readonly data?: unknown;
  readonly error?: ControlError;
}

/** Controller requests that the gateway answers itself (no browser involved). */
export interface TargetsListMessage {
  readonly type: 'targets.list';
  readonly requestId: string;
}

export interface TargetsMessage {
  readonly type: 'targets';
  readonly requestId: string;
  readonly targets: readonly TargetSummary[];
}

/** Browser → gateway: the tab's state changed. */
export interface StateUpdateMessage {
  readonly type: 'state.update';
  readonly state: BrowserState;
}

/** Gateway → browser: run one command. */
export interface BrowserCommandMessage {
  readonly type: 'command';
  readonly commandId: string;
  readonly action: string;
  readonly params?: unknown;
}

/** Browser → gateway: one command's outcome. */
export interface BrowserResultMessage {
  readonly type: 'command.result';
  readonly commandId: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
  /** Optional stable code for a failure, one of `BROWSER_ERROR_CODES`; anything else reads as `command_failed`. */
  readonly code?: string;
}

/**
 * The error codes a tab may report for a failed command. The gateway maps any other (or a missing) code to
 * `command_failed`, so a tab can never claim a transport-level failure such as `timeout`.
 */
export const BROWSER_ERROR_CODES = ['invalid_input', 'missing_target', 'not_ready', 'command_failed'] as const;
export type BrowserErrorCode = (typeof BROWSER_ERROR_CODES)[number];

export function readBrowserErrorCode(value: unknown): BrowserErrorCode {
  return (BROWSER_ERROR_CODES as readonly unknown[]).includes(value) ? (value as BrowserErrorCode) : 'command_failed';
}

/**
 * A command handler in the tab throws this to report a stable error code with its readable message
 * (for example `missing_target` for an unknown section id, `invalid_input` for a design the validator rejects).
 */
export class ControlCommandError extends Error {
  readonly code: BrowserErrorCode;

  constructor(code: BrowserErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ControlCommandError';
  }
}

/** Any side → peer: a protocol-level failure not tied to a command (bad hello, bad frame). */
export interface ErrorMessage {
  readonly type: 'error';
  readonly requestId?: string;
  readonly error: ControlError;
}

export interface CommandDescriptor {
  readonly name: string;
  readonly description: string;
  /** Who executes it. Phase 1: every command runs in the browser tab. */
  readonly executor: 'browser';
  readonly requiresBrowser: true;
  readonly sideEffects: 'none' | 'view' | 'document' | 'project';
  readonly completionLevels: readonly CompletionLevel[];
  readonly defaultCompletion: CompletionLevel;
  /** JSON Schema of `params`. */
  readonly params: Readonly<Record<string, unknown>>;
}

/** Close codes used by the gateway (4000–4999 are application-defined in RFC 6455). */
export const CLOSE_CODES = {
  /** The first frame was not a valid `hello`. */
  invalidHello: 4400,
  unauthorized: 4401,
  forbidden: 4403,
  helloTimeout: 4408,
  unsupportedVersion: 4426,
} as const;

/**
 * Picks the first version in our preference order (`supported`, newest first) that the peer also offers,
 * or null when there is none. Non-string entries in `offered` are ignored: it arrives from the network.
 */
export function negotiateVersion(
  offered: unknown,
  supported: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS,
): string | null {
  if (!Array.isArray(offered)) return null;
  for (const version of supported) if (offered.includes(version)) return version;
  return null;
}

/** Ids a controller or browser may choose (`commandId`, `resumeBrowserId`): short, printable, no spaces. */
export function isValidClientId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

/** Reads an untrusted `BrowserState`; returns null when the shape is wrong. */
export function readBrowserState(value: unknown): BrowserState | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const text = (key: string): string | null | undefined => {
    const entry = record[key];
    if (entry === null || entry === undefined) return null;
    return typeof entry === 'string' ? entry.slice(0, 256) : undefined;
  };
  const projectId = text('projectId');
  const projectName = text('projectName');
  const documentId = text('documentId');
  const view = text('view');
  if (typeof record.ready !== 'boolean') return null;
  if (projectId === undefined || projectName === undefined || documentId === undefined || view === undefined) {
    return null;
  }
  return { ready: record.ready, projectId, projectName, documentId, view };
}

export function controlError(code: ErrorCode, message: string, extra: Partial<ControlError> = {}): ControlError {
  return { code, message, ...extra };
}
