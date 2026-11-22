/**
 * MarkdownDropzone — wraps any content and provides drag-and-drop upload of
 * markdown files. Shows an overlay while dragging. Calls `onText` on success
 * or `onError` on rejection. Overlay is suppressed when `disabled`.
 */

import { cn } from '@prompt-studio/ui/utils';
import { type ReactNode, useState } from 'react';
import { type MarkdownFileContent, type MarkdownUploadError, readMarkdownFile } from './read-markdown-file';

export interface MarkdownDropzoneProps {
  onText: (content: MarkdownFileContent) => void;
  onError?: (error: MarkdownUploadError) => void;
  disabled?: boolean;
  className?: string;
  /** Overlay text shown while dragging. Default: "Drop markdown to load". */
  overlayLabel?: string;
  children: ReactNode;
}

export function MarkdownDropzone({
  onText,
  onError,
  disabled,
  className,
  overlayLabel = 'Drop markdown to load',
  children,
}: MarkdownDropzoneProps): React.JSX.Element {
  const [dragActive, setDragActive] = useState(false);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!disabled) setDragActive(true);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!disabled) setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    // Only clear drag state when leaving the zone itself (not moving to a child).
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    readMarkdownFile(file)
      .then(onText)
      .catch((error: unknown) => {
        onError?.(error as MarkdownUploadError);
      });
  };

  return (
    <div
      data-testid="markdown-dropzone"
      className={cn('relative', className)}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragActive && !disabled && (
        <div
          data-testid="markdown-dropzone-overlay"
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none flex items-center justify-center border-2 border-dashed bg-background/80"
        >
          <span className="text-sm font-medium">{overlayLabel}</span>
        </div>
      )}
    </div>
  );
}
