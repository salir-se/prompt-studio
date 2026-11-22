import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@prompt-studio/ui/dialog';
import { type ReactNode, useRef } from 'react';
import { CloseButton } from './CloseButton';

export function PromptExplorer({
  open,
  drawer,
  onClose,
  children,
}: {
  open: boolean;
  drawer: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const body = (
    <>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="text-xs font-semibold tracking-wide">Explorer</span>
        <CloseButton onClick={onClose} label="Close explorer" />
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </>
  );
  if (!drawer)
    return open ? (
      <aside
        id="prompt-explorer"
        aria-label="Prompt explorer"
        className="studio-explorer flex w-64 shrink-0 flex-col bg-card"
      >
        {body}
      </aside>
    ) : null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        id="prompt-explorer"
        ref={content}
        className="studio studio-explorer-drawer"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          opener.current = document.activeElement as HTMLElement | null;
          content.current?.querySelector<HTMLElement>('[role="searchbox"], input[type="search"]')?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        <DialogTitle className="sr-only">Prompt explorer</DialogTitle>
        <DialogDescription className="sr-only">Find a prompt or skill, or navigate its sections.</DialogDescription>
        {body}
      </DialogContent>
    </Dialog>
  );
}
