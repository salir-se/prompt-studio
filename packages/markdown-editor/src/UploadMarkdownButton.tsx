/**
 * UploadMarkdownButton — a button that triggers a hidden file input to upload
 * a markdown file. Calls `onText` on success or `onError` on rejection.
 * The input is reset after every change so re-selecting the same file fires
 * another `change` event.
 */

import { Button } from '@prompt-studio/ui/button';
import { cn } from '@prompt-studio/ui/utils';
import { type ReactNode, useRef } from 'react';
import {
  ACCEPTED_MARKDOWN_EXTENSIONS,
  ACCEPTED_MARKDOWN_MIME_TYPES,
  type MarkdownFileContent,
  type MarkdownUploadError,
  readMarkdownFile,
} from './read-markdown-file';

const ACCEPT = [...ACCEPTED_MARKDOWN_EXTENSIONS, ...ACCEPTED_MARKDOWN_MIME_TYPES].join(',');

export interface UploadMarkdownButtonProps {
  onText: (content: MarkdownFileContent) => void;
  onError?: (error: MarkdownUploadError) => void;
  disabled?: boolean;
  className?: string;
  /** Button label/icon; defaults to the text "Upload". */
  children?: ReactNode;
  /** Accessible name (use for icon-only buttons). */
  'aria-label'?: string;
}

export function UploadMarkdownButton({
  onText,
  onError,
  disabled,
  className,
  children,
  'aria-label': ariaLabel,
}: UploadMarkdownButtonProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset value immediately so re-selecting the same file fires change.
    event.target.value = '';
    if (!file) return;
    readMarkdownFile(file)
      .then(onText)
      .catch((error: unknown) => {
        onError?.(error as MarkdownUploadError);
      });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(className)}
        onClick={handleButtonClick}
      >
        {children ?? 'Upload'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid="upload-markdown-input"
        aria-hidden
        onChange={handleChange}
      />
    </>
  );
}
