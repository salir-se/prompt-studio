import { createContext, useContext } from 'react';
import type { ShortcutId } from './shortcuts';

export const ShortcutContext = createContext({
  compactToolbars: false,
  lineNumbers: false,
  setLineNumbers: (_enabled: boolean) => {},
  teach: (_id: ShortcutId) => {},
  open: (_view: 'guide' | 'settings', _target?: 'appearance' | 'execution' | 'mcp') => {},
});

export const useShortcutEducation = () => useContext(ShortcutContext);
