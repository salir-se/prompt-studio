import { FocusScope } from '@radix-ui/react-focus-scope';
import type { ReactNode } from 'react';

/** Keep the same panel instance across resizing so trapping focus never resets a draft. */
export function StudioPanelFocus({ modal, children }: { modal: boolean; children: ReactNode }) {
  const modalProps = modal
    ? { role: 'dialog' as const, 'aria-modal': true as const, 'aria-label': 'Prompt workspace' }
    : {};
  return (
    <FocusScope
      asChild
      trapped={modal}
      loop={modal}
      onMountAutoFocus={(event) => event.preventDefault()}
      onUnmountAutoFocus={(event) => event.preventDefault()}
    >
      <div data-studio-panels {...modalProps}>
        {children}
      </div>
    </FocusScope>
  );
}
