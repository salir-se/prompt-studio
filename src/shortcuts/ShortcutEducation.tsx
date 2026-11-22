import { Button } from '@prompt-studio/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@prompt-studio/ui/dialog';
import { CircleHelp } from '@prompt-studio/ui/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@prompt-studio/ui/tabs';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast, Toaster } from 'sonner';
import { StudioCommandMenu } from '../components/StudioCommandMenu';
import { McpSettings } from '../mcp/McpSettings';
import { RuntimeSettings } from './RuntimeSettings';
import { ShortcutGuide } from './ShortcutGuide';
import { ShortcutKeys } from './ShortcutKeys';
import { ShortcutContext, useShortcutEducation } from './shortcut-context';
import { type ShortcutId, SHORTCUTS } from './shortcuts';
import { useTipLayout } from './use-tip-layout';

const STORAGE_KEY = 'prompt-studio:shortcut-tips:v1';
const LINE_NUMBERS_KEY = 'prompt-studio:line-numbers:v1';
const TOOLBAR_KEY = 'prompt-studio:compact-toolbars:v1';

function readPreference(key: string, defaultValue = true) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? defaultValue : stored !== 'false';
  } catch {
    return defaultValue;
  }
}

export function ShortcutEducation({ children }: { children: ReactNode }) {
  return (
    <div className="studio-shortcut-education contents">
      <Education>{children}</Education>
      {/* D-070: Sonner is the one toast system; scoped here so the tip CSS and dialog avoidance stay local. */}
      <Toaster position="bottom-right" closeButton toastOptions={{ closeButtonAriaLabel: 'Dismiss notification' }} />
    </div>
  );
}

function Education({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => readPreference(STORAGE_KEY));
  const [compactToolbars, setCompactToolbars] = useState(() => readPreference(TOOLBAR_KEY));
  const [lineNumbers, updateLineNumbers] = useState(() => readPreference(LINE_NUMBERS_KEY, false));
  const [runtimeDirty, setRuntimeDirty] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [mcpDirty, setMcpDirty] = useState(false);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpVisited, setMcpVisited] = useState(false);
  const anyDirty = runtimeDirty || mcpDirty;
  const anyBusy = runtimeBusy || mcpBusy;
  const [storageError, setStorageError] = useState(false);
  const [settingsTab, setSettingsTab] = useState('appearance');
  const [view, setView] = useState<'guide' | 'settings' | null>(null);
  const active = useRef<string | number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seen = useRef(new Set<ShortcutId>());
  const lastTip = useRef<number | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Sonner keeps undismissed toasts in a global store and replays them to the next Toaster:
  // close the tip with the app.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (active.current !== null) toast.dismiss(active.current);
    },
    [],
  );

  function dismiss() {
    if (active.current !== null) toast.dismiss(active.current);
    active.current = null;
    clearTimeout(timer.current);
  }
  useTipLayout(dismiss);
  function savePreferences(tips: boolean, compact: boolean) {
    setEnabled(tips);
    setCompactToolbars(compact);
    if (!tips) dismiss();
    try {
      localStorage.setItem(STORAGE_KEY, String(tips));
      localStorage.setItem(TOOLBAR_KEY, String(compact));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  function setLineNumbers(next: boolean) {
    updateLineNumbers(next);
    try {
      localStorage.setItem(LINE_NUMBERS_KEY, String(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  useEffect(() => {
    if (!anyDirty && !anyBusy) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [anyDirty, anyBusy]);
  const changeEnabled = (next: boolean) => savePreferences(next, compactToolbars);
  function open(next: 'guide' | 'settings', target: 'appearance' | 'execution' | 'mcp' = 'appearance') {
    if (view === next) {
      if (next === 'settings') {
        setSettingsTab(target);
        if (target === 'mcp') setMcpVisited(true);
      }
      return;
    }
    if (anyBusy || (anyDirty && !window.confirm('Discard unsaved connection settings?'))) return;
    setMcpDirty(false);
    setRuntimeDirty(false);
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dismiss();
    setSettingsTab(target);
    setMcpVisited(target === 'mcp');
    setView(next);
  }
  function teach(id: ShortcutId) {
    const now = Date.now();
    if (!enabled || seen.current.has(id) || (lastTip.current !== null && now - lastTip.current < 30_000)) return;
    seen.current.add(id);
    lastTip.current = now;
    dismiss();
    active.current = toast(SHORTCUTS[id].label, {
      duration: Number.POSITIVE_INFINITY,
      action: (
        <span aria-live="polite" className="flex flex-wrap items-center gap-2">
          <span role="status" aria-label="Shortcut tip">
            <span className="sr-only">{SHORTCUTS[id].label}: </span>
            <ShortcutKeys id={id} />
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              open('guide');
            }}
          >
            All shortcuts
          </Button>
          <Button size="sm" variant="ghost" onClick={() => changeEnabled(false)}>
            Turn off tips
          </Button>
        </span>
      ),
    });
    timer.current = setTimeout(dismiss, 6000);
  }
  return (
    <ShortcutContext.Provider
      value={{
        teach,
        open,
        compactToolbars,
        lineNumbers,
        setLineNumbers,
      }}
    >
      {children}
      <Dialog
        open={view !== null}
        onOpenChange={(open) => {
          if (!open && !anyBusy && (!anyDirty || window.confirm('Discard unsaved connection settings?'))) {
            setMcpDirty(false);
            setView(null);
            setMcpVisited(false);
            setRuntimeDirty(false);
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const fallback = document.querySelector<HTMLElement>(
              'button[data-studio-command-menu="Help"], button[data-studio-command-menu="File"]',
            );
            (returnFocus.current?.isConnected ? returnFocus.current : fallback)?.focus();
          }}
          className="studio mx-auto flex max-h-[90dvh] w-[calc(100vw-2rem)] min-w-0 flex-col gap-4 overflow-hidden sm:mx-0 sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>{view === 'settings' ? 'App settings' : 'Keyboard shortcuts'}</DialogTitle>
            <DialogDescription>
              {view === 'settings'
                ? 'Device preferences and shared defaults for runs and evaluations.'
                : 'Find the keys for your next action. No connection or API key needed.'}
            </DialogDescription>
          </DialogHeader>
          {view === 'settings' ? (
            <Tabs
              value={settingsTab}
              onValueChange={(value) => {
                setSettingsTab(value);
                if (value === 'mcp') setMcpVisited(true);
              }}
              className="flex min-h-0 flex-1 flex-col gap-4"
            >
              <TabsList aria-label="Settings sections" className="h-auto shrink-0 flex-wrap justify-start">
                <TabsTrigger value="appearance">Appearance &amp; editing</TabsTrigger>
                {document.querySelector('meta[name="studio-workspace"]') && (
                  <>
                    <TabsTrigger value="execution">Models &amp; skills</TabsTrigger>
                    <TabsTrigger value="mcp">MCP servers</TabsTrigger>
                  </>
                )}
              </TabsList>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <TabsContent value="appearance" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                  <p className="text-xs text-muted-foreground">Saved on this device, across projects.</p>
                  <ShortcutGuide
                    view="settings"
                    enabled={enabled}
                    onEnabled={changeEnabled}
                    storageError={storageError}
                    lineNumbers={lineNumbers}
                    onLineNumbers={setLineNumbers}
                    compactToolbars={compactToolbars}
                    onCompactToolbars={(next) => savePreferences(enabled, next)}
                  />
                </TabsContent>
                {document.querySelector('meta[name="studio-workspace"]') && (
                  <>
                    <TabsContent value="execution" forceMount className="mt-0 data-[state=inactive]:hidden">
                      <RuntimeSettings onDirtyChange={setRuntimeDirty} onBusyChange={setRuntimeBusy} />
                    </TabsContent>
                    <TabsContent value="mcp" forceMount className="mt-0 data-[state=inactive]:hidden">
                      {mcpVisited && <McpSettings onDirtyChange={setMcpDirty} onBusyChange={setMcpBusy} />}
                    </TabsContent>
                  </>
                )}
              </div>
            </Tabs>
          ) : view === 'guide' ? (
            <ShortcutGuide
              view="guide"
              enabled={enabled}
              onEnabled={changeEnabled}
              storageError={storageError}
              lineNumbers={lineNumbers}
              onLineNumbers={setLineNumbers}
              compactToolbars={compactToolbars}
              onCompactToolbars={(next) => savePreferences(enabled, next)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </ShortcutContext.Provider>
  );
}

export function ShortcutHelpMenu({ onAssistant }: { onAssistant: () => void }) {
  const education = useShortcutEducation();
  return (
    <StudioCommandMenu
      label="Help"
      icon={<CircleHelp className="size-4" />}
      commands={[
        { label: 'Keyboard shortcuts', run: () => education.open('guide') },
        { label: 'App settings', run: () => education.open('settings') },
        { label: 'Ask the help assistant', run: onAssistant },
      ]}
    />
  );
}
