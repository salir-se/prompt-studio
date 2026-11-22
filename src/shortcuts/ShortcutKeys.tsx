import { Kbd, KbdGroup } from '@prompt-studio/ui/kbd';
import { Fragment } from 'react';
import { type ShortcutId, shortcutKeys } from './shortcuts';

export function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function ShortcutKeys({ id, mac = isMacPlatform() }: { id: ShortcutId; mac?: boolean }) {
  return (
    <KbdGroup>
      {shortcutKeys(id, mac).map((keys, index) => (
        <Fragment key={keys.join('+')}>
          {index > 0 && <span className="px-1 text-xs">or</span>}
          {keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </Fragment>
      ))}
    </KbdGroup>
  );
}
