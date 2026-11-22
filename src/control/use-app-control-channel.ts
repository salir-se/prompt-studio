/**
 * Control channel wiring (ADR-236; docs/remote-control.md): exposes the editor to CLI/MCP clients through
 * the app's REAL handlers — one source of truth. The command map is rebuilt every render into a ref (fresh
 * closures over live state); the CHANNEL connects once and resolves through the ref, so no reconnect churn.
 * The tab's state (ready, project, open document, view) is published to the gateway whenever it changes.
 * Silent without a server token (vitest) — see ws-control-channel.ts.
 */

import { useEffect, useRef } from 'react';
import { type AppCommandSurface, browserStateOf, buildAppCommands } from './app-commands';
import { type ControlChannelHandle, connectWsControlChannel } from './ws-control-channel';

/**
 * Registers the App's live command surface on the control channel for the component's lifetime.
 * Pass a freshly built surface every render (it closes over live state) — the command map is
 * rebuilt into a ref here, and the once-connected channel resolves each incoming command through
 * that ref, so it always answers with current state and never reconnects.
 */
export function useAppControlChannel(surface: AppCommandSurface): void {
  const commandsRef = useRef<ReturnType<typeof buildAppCommands>>({} as ReturnType<typeof buildAppCommands>);
  commandsRef.current = buildAppCommands(surface);
  const state = browserStateOf(surface);
  const stateRef = useRef(state);
  stateRef.current = state;
  const channelRef = useRef<ControlChannelHandle | null>(null);

  useEffect(() => {
    const channel = connectWsControlChannel(
      (command) => commandsRef.current[command],
      () => stateRef.current,
    );
    channelRef.current = channel;
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const { ready, projectId, projectName, documentId, view } = state;
  useEffect(() => {
    channelRef.current?.publishState({ ready, projectId, projectName, documentId, view });
  }, [ready, projectId, projectName, documentId, view]);
}
