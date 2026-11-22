/**
 * DownloadMarkdownButton — a button that downloads `text` as a `.md` file
 * named from `filenameBase`. Symmetric counterpart to UploadMarkdownButton:
 * same dependency-light shape, icon/label supplied by the consumer via
 * `children`.
 */

import { Button } from '@prompt-studio/ui/button';
import { cn } from '@prompt-studio/ui/utils';
import type { ReactNode } from 'react';
import { downloadMarkdownFile, markdownDownloadFilename } from './download-markdown-file';

export interface DownloadMarkdownButtonProps {
  /** Content to write to the downloaded file. */
  text: string;
  /** Base name normalized (via `markdownDownloadFilename`) into the download filename. */
  filenameBase: string;
  disabled?: boolean;
  className?: string;
  /** Button label/icon; supplied by the consumer (no default). */
  children: ReactNode;
  /** Fired with the final, normalized filename after the download is triggered. */
  onDownloaded?: (filename: string) => void;
}

export function DownloadMarkdownButton({
  text,
  filenameBase,
  disabled,
  className,
  children,
  onDownloaded,
}: DownloadMarkdownButtonProps): React.JSX.Element {
  const handleClick = () => {
    downloadMarkdownFile(text, filenameBase);
    onDownloaded?.(markdownDownloadFilename(filenameBase));
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || !text.trim()}
      className={cn(className)}
      data-testid="download-markdown-button"
      onClick={handleClick}
    >
      {children}
    </Button>
  );
}
