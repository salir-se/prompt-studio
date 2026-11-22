// The public hook for consuming the help system (ADR-089).
//
// Any component inside a `<HelpProvider>` can call `useHelp()` to open the panel,
// send a message, start a tour, or open a tutorial video. Read-only by contract —
// nothing it exposes mutates host application state.

import { useContext } from 'react';
import { HelpContext, type HelpContextValue } from './context';

export function useHelp(): HelpContextValue {
  const ctx = useContext(HelpContext);
  if (!ctx) {
    throw new Error('useHelp must be used within a <HelpProvider>');
  }
  return ctx;
}
