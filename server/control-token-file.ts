import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

/**
 * Production adapters for the control channel's per-boot token file (ADR-236): the server
 * publishes its token to `<tmpdir>/prompt-studio-control-<port>.token` (mode 0600 — this
 * browser-session's user only) so local CLI/MCP clients can authenticate against the relay.
 * The DevToolsActivePort pattern: the server is loopback-bound, so the file's location is the
 * discovery mechanism, and the per-boot token inside it is the credential. Removed on dispose.
 */

export function defaultControlTokenDir(): string {
  return tmpdir();
}

export async function writeControlTokenFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: 0o600 });
}

export async function removeControlTokenFile(path: string): Promise<void> {
  await rm(path, { force: true });
}
