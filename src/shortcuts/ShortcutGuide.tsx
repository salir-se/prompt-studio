import { Input } from '@prompt-studio/ui/input';
import { Label } from '@prompt-studio/ui/label';
import { Switch } from '@prompt-studio/ui/switch';
import { useId, useState } from 'react';
import { ShortcutKeys } from './ShortcutKeys';
import { SHORTCUT_IDS, SHORTCUTS } from './shortcuts';

export function ShortcutGuide({
  view,
  enabled,
  storageError,
  onEnabled,
  compactToolbars,
  onCompactToolbars,
  lineNumbers,
  onLineNumbers,
}: {
  view: 'guide' | 'settings';
  enabled: boolean;
  storageError: boolean;
  onEnabled: (enabled: boolean) => void;
  compactToolbars: boolean;
  onCompactToolbars: (compact: boolean) => void;
  lineNumbers: boolean;
  onLineNumbers: (enabled: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const id = useId();
  const matches = SHORTCUT_IDS.filter((id) => {
    const item = SHORTCUTS[id];
    return `${item.label} ${item.group} ${item.scope} ${item.keys}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const groups = [...new Set(matches.map((id) => SHORTCUTS[id].group))];
  return (
    <>
      {view === 'settings' && (
        <div className="flex shrink-0 items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
          <div>
            <Label htmlFor={`${id}-tips`}>Show shortcut tips</Label>
            <p id={`${id}-description`} className="mt-1 text-sm text-muted-foreground">
              Learn the keys after clicking an action. Applies across projects on this device.
            </p>
          </div>
          <Switch
            id={`${id}-tips`}
            checked={enabled}
            onCheckedChange={onEnabled}
            aria-describedby={`${id}-description`}
          />
        </div>
      )}
      {view === 'settings' && (
        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
          <div>
            <Label htmlFor={`${id}-compact`}>Compact toolbars</Label>
            <p id={`${id}-compact-description`} className="mt-1 text-sm text-muted-foreground">
              Use icons for workspace and composing tools. Turn off to show labels.
            </p>
          </div>
          <Switch
            id={`${id}-compact`}
            checked={compactToolbars}
            onCheckedChange={onCompactToolbars}
            aria-describedby={`${id}-compact-description`}
          />
        </div>
      )}
      {view === 'settings' && (
        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
          <div>
            <Label htmlFor={`${id}-lines`}>Editor line numbers</Label>
            <p id={`${id}-lines-description`} className="mt-1 text-sm text-muted-foreground">
              Show source line numbers while composing Markdown. You can also toggle them from the editor toolbar.
            </p>
          </div>
          <Switch
            id={`${id}-lines`}
            checked={lineNumbers}
            onCheckedChange={onLineNumbers}
            aria-describedby={`${id}-lines-description`}
          />
        </div>
      )}
      {storageError && (
        <p role="status" className="text-sm text-muted-foreground">
          Changed for this session. Browser storage is unavailable, so this preference could not be saved.
        </p>
      )}
      {view === 'settings' ? (
        <p className="text-sm text-muted-foreground">
          Tooltips and the keyboard guide remain available when tips are off.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${id}-search`}>Find a shortcut</Label>
            <Input
              autoFocus
              id={`${id}-search`}
              placeholder="Search actions, keys or workspace…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Shortcuts act in the workspace shown below. Menus and dialogs keep their own keys. On Mac, ⌥ means Option.
          </p>
          <section
            className="min-h-0 flex-1 overflow-y-auto space-y-5 pr-1"
            aria-label="Keyboard shortcuts"
            tabIndex={0}
          >
            {!matches.length && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No matching shortcuts. Try “section”, “save” or “evaluation”.
              </p>
            )}
            {groups.map((group) => (
              <section key={group} aria-label={group}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</h3>
                <dl className="divide-y rounded-lg border">
                  {matches
                    .filter((id) => SHORTCUTS[id].group === group)
                    .map((id) => (
                      <div key={id} className="space-y-1 p-3">
                        <dt className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
                          <span>{SHORTCUTS[id].label}</span>
                          <ShortcutKeys id={id} />
                        </dt>
                        <dd className="text-xs leading-relaxed text-muted-foreground">{SHORTCUTS[id].scope}</dd>
                      </div>
                    ))}
                </dl>
              </section>
            ))}
          </section>
          <div className="flex shrink-0 items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
            <div>
              <Label htmlFor={`${id}-tips`}>Show shortcut tips</Label>
              <p id={`${id}-description`} className="mt-1 text-sm text-muted-foreground">
                Learn the keys after clicking an action. Applies across projects on this device.
              </p>
            </div>
            <Switch
              id={`${id}-tips`}
              checked={enabled}
              onCheckedChange={onEnabled}
              aria-describedby={`${id}-description`}
            />
          </div>
        </>
      )}
    </>
  );
}
