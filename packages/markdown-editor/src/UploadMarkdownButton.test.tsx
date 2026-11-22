// @module-tag dom
/**
 * BDD tests for UploadMarkdownButton.
 *
 * Behaviour contracts:
 *  - Renders a Button with default "Upload" label or custom children.
 *  - Clicking the Button triggers the hidden file input.
 *  - Valid markdown file → onText called with { text, name }.
 *  - Invalid file type → onError called with .code === 'UNSUPPORTED_TYPE'.
 *  - Input value is reset to '' after change so re-selecting same file fires change.
 *  - disabled → Button is disabled; no input click.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UploadMarkdownButton } from './UploadMarkdownButton';

const validFile = new File(['# hi'], 'x.md', { type: 'text/markdown' });
const invalidFile = new File(['x'], 'a.pdf', { type: 'application/pdf' });

describe('UploadMarkdownButton', () => {
  it('renders default "Upload" label', () => {
    render(<UploadMarkdownButton onText={() => {}} />);
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('renders custom children when provided', () => {
    render(<UploadMarkdownButton onText={() => {}}>Import file</UploadMarkdownButton>);
    expect(screen.getByRole('button', { name: 'Import file' })).toBeInTheDocument();
    expect(screen.queryByText('Upload')).toBeNull();
  });

  it('applies aria-label to the button', () => {
    render(<UploadMarkdownButton onText={() => {}} aria-label="Upload markdown" />);
    expect(screen.getByRole('button', { name: 'Upload markdown' })).toBeInTheDocument();
  });

  it('clicking the button triggers a click on the hidden input', async () => {
    const user = userEvent.setup();
    render(<UploadMarkdownButton onText={() => {}} />);
    const button = screen.getByRole('button', { name: 'Upload' });
    const input = screen.getByTestId('upload-markdown-input');
    const clickSpy = vi.spyOn(input, 'click');
    await user.click(button);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('valid file triggers onText with { text, name }', async () => {
    const onText = vi.fn();
    render(<UploadMarkdownButton onText={onText} />);
    const input = screen.getByTestId('upload-markdown-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validFile] } });
    await waitFor(() => expect(onText).toHaveBeenCalledWith(expect.objectContaining({ text: '# hi', name: 'x.md' })));
  });

  it('invalid file triggers onError with .code === "UNSUPPORTED_TYPE"', async () => {
    const onError = vi.fn();
    render(<UploadMarkdownButton onText={() => {}} onError={onError} />);
    const input = screen.getByTestId('upload-markdown-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [invalidFile] } });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNSUPPORTED_TYPE' })));
  });

  it('input value is reset to "" after change', async () => {
    render(<UploadMarkdownButton onText={() => {}} />);
    const input = screen.getByTestId('upload-markdown-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validFile] } });
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('does not call onText when no file is selected', async () => {
    const onText = vi.fn();
    render(<UploadMarkdownButton onText={onText} />);
    const input = screen.getByTestId('upload-markdown-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    // short wait to ensure no async call slips through
    await new Promise((r) => setTimeout(r, 50));
    expect(onText).not.toHaveBeenCalled();
  });

  it('disabled prop makes the button disabled', () => {
    render(<UploadMarkdownButton onText={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });

  it('disabled button does not trigger input click', async () => {
    const user = userEvent.setup();
    render(<UploadMarkdownButton onText={() => {}} disabled />);
    const input = screen.getByTestId('upload-markdown-input');
    const clickSpy = vi.spyOn(input, 'click');
    // userEvent won't click a disabled button but we still verify no input click
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('applies custom className to the button', () => {
    render(<UploadMarkdownButton onText={() => {}} className="my-custom-class" />);
    expect(screen.getByRole('button', { name: 'Upload' })).toHaveClass('my-custom-class');
  });

  it('renders a hidden file input with correct accept attribute', () => {
    render(<UploadMarkdownButton onText={() => {}} />);
    const input = screen.getByTestId('upload-markdown-input') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveClass('hidden');
    // accept should include both extensions and MIME types
    const accept = input.getAttribute('accept') ?? '';
    expect(accept).toContain('.md');
    expect(accept).toContain('.markdown');
    expect(accept).toContain('.txt');
    expect(accept).toContain('text/markdown');
    expect(accept).toContain('text/x-markdown');
  });
});
