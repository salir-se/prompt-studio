// @module-tag dom
/**
 * BDD tests for DownloadMarkdownButton.
 *
 * Behaviour contracts:
 *  - Renders children as the button label.
 *  - Carries the download-markdown-button testid.
 *  - Disabled when `disabled` is set OR `text` is empty/whitespace-only.
 *  - Clicking triggers a markdown file download (Blob -> anchor -> click -> revoke).
 *  - onDownloaded fires with the final normalized filename.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadMarkdownButton } from './DownloadMarkdownButton';

describe('DownloadMarkdownButton', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('renders children as the button label', () => {
    render(
      <DownloadMarkdownButton text="hello" filenameBase="notes">
        Download
      </DownloadMarkdownButton>,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('carries the download-markdown-button testid', () => {
    render(
      <DownloadMarkdownButton text="hello" filenameBase="notes">
        Download
      </DownloadMarkdownButton>,
    );
    expect(screen.getByTestId('download-markdown-button')).toBeInTheDocument();
  });

  it('is disabled when text is empty', () => {
    render(
      <DownloadMarkdownButton text="" filenameBase="notes">
        Download
      </DownloadMarkdownButton>,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('is disabled when text is whitespace-only', () => {
    render(
      <DownloadMarkdownButton text="   " filenameBase="notes">
        Download
      </DownloadMarkdownButton>,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('is disabled when disabled is set, even with non-empty text', () => {
    render(
      <DownloadMarkdownButton text="hello" filenameBase="notes" disabled>
        Download
      </DownloadMarkdownButton>,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('is enabled when text is non-empty and disabled is not set', () => {
    render(
      <DownloadMarkdownButton text="hello" filenameBase="notes">
        Download
      </DownloadMarkdownButton>,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
  });

  it('clicking downloads a text/markdown Blob and revokes the object URL', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <DownloadMarkdownButton text="# hello" filenameBase="notes">
        Download
      </DownloadMarkdownButton>,
    );
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/markdown');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    clickSpy.mockRestore();
  });

  it('calls onDownloaded with the final normalized filename', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const onDownloaded = vi.fn();
    render(
      <DownloadMarkdownButton text="# hello" filenameBase="  My Notes.MD  " onDownloaded={onDownloaded}>
        Download
      </DownloadMarkdownButton>,
    );
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownloaded).toHaveBeenCalledWith('My Notes.md');
    clickSpy.mockRestore();
  });

  it('does not throw when onDownloaded is not provided', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <DownloadMarkdownButton text="hi" filenameBase="notes">
        Download
      </DownloadMarkdownButton>,
    );
    await expect(user.click(screen.getByRole('button', { name: 'Download' }))).resolves.not.toThrow();
    clickSpy.mockRestore();
  });

  it('applies custom className to the button', () => {
    render(
      <DownloadMarkdownButton text="hi" filenameBase="notes" className="my-custom-class">
        Download
      </DownloadMarkdownButton>,
    );
    expect(screen.getByRole('button', { name: 'Download' })).toHaveClass('my-custom-class');
  });
});
