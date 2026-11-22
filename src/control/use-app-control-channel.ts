/**
 * Control channel wiring (ADR-236; tasks #18–#20): exposes the editor to CLI/MCP clients through
 * the app's REAL handlers — one source of truth. The command map is rebuilt every render into a
 * ref (fresh closures over live state); the CHANNEL connects once and resolves through the ref,
 * so no reconnect churn. Silent without a server token (vitest) — see control-channel.ts.
 */

import { useEffect, useRef } from 'react';
import { type AppCommandSurface, buildAppCommands } from './app-commands';
import { connectControlChannel } from './control-channel';

/**
 * Registers the App's live command surface on the control channel for the component's lifetime.
 * Pass a freshly built surface every render (it closes over live state) — the command map is
 * rebuilt into a ref here, and the once-connected channel resolves each incoming command through
 * that ref, so it always answers with current state and never reconnects.
 */
export function useAppControlChannel(surface: AppCommandSurface): void {
  const commandsRef = useRef<ReturnType<typeof buildAppCommands>>({} as ReturnType<typeof buildAppCommands>);
  commandsRef.current = buildAppCommands(surface);
  useEffect(() => connectControlChannel((command) => commandsRef.current[command]), []);
}
