// @module-tag dom
/**
 * BDD coverage for the universal editor's two contracts (ADR-096):
 *
 *  - `plain` mode is BYTE TRANSPARENT — Liquid tags, markdown specials, and
 *    HTML pass through onChange exactly as typed. This is the regression pin
 *    for prompt/email-template safety.
 *  - `markdown` mode lazy-loads the Milkdown chunk and degrades to the plain
 *    textarea while loading or when the chunk fails (safe fallback).
 *
 * The real Crepe editor is exercised in Storybook (it needs a real browser
 * DOM); here the milkdown module is mocked at the boundary.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { mockCrepe } = vi.hoisted(() => ({
  mockCrepe: vi.fn(({ defaultValue, onChange }: { defaultValue: string; onChange: (markdown: string) => void }) => (
    <div data-testid="crepe-editor" data-default-value={defaultValue}>
      <button type="button" onClick={() => onChange('# edited')}>
        emit-edit
      </button>
    </div>
  )),
}));

vi.mock('./MilkdownCrepeEditor', () => ({ default: mockCrepe }));

import { MarkdownEditor } from './MarkdownEditor';

describe('plain mode (verbatim-safe)', () => {
  it('renders a controlled textarea with the value', () => {
    render(<MarkdownEditor mode="plain" value="hello {{ name }}" onChange={() => {}} ariaLabel="Body" />);
    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveValue('hello {{ name }}');
  });

  it('passes Liquid tags, markdown specials, and HTML through byte-identically', async () => {
    const user = userEvent.setup();
    let value = '';
    const onChange = vi.fn((next: string) => {
      value = next;
    });
    const { rerender } = render(<MarkdownEditor mode="plain" value={value} onChange={onChange} ariaLabel="Body" />);

    // userEvent.type treats {} [] as key descriptors — paste covers the
    // realistic "drop a template in" path AND the hostile characters.
    const hostile = '{{ user_name }} {% if a %}*not-emphasis* _x_ <b>raw</b>{% endif %}';
    screen.getByRole('textbox', { name: 'Body' }).focus();
    await user.paste(hostile);
    rerender(<MarkdownEditor mode="plain" value={value} onChange={onChange} ariaLabel="Body" />);

    expect(value).toBe(hostile);
    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveValue(hostile);
  });

  it('honors readOnly, maxLength, rows, and placeholder', () => {
    render(
      <MarkdownEditor
        mode="plain"
        value=""
        onChange={() => {}}
        readOnly
        maxLength={10}
        rows={3}
        placeholder="Type here"
        ariaLabel="Body"
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Body' });
    expect(textarea).toHaveAttribute('readonly');
    expect(textarea).toHaveAttribute('maxlength', '10');
    expect(textarea).toHaveAttribute('rows', '3');
    expect(textarea).toHaveAttribute('placeholder', 'Type here');
  });
});

describe('markdown mode (lazy WYSIWYG)', () => {
  it('mounts the lazy editor with the value as the initial document', async () => {
    render(<MarkdownEditor value="# Title" onChange={() => {}} ariaLabel="Answer" />);
    const editor = await screen.findByTestId('crepe-editor');
    expect(editor).toHaveAttribute('data-default-value', '# Title');
  });

  it('streams editor changes to onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MarkdownEditor value="" onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: 'emit-edit' }));
    expect(onChange).toHaveBeenCalledWith('# edited');
  });

  it('remounts on contentKey change so a new document loads', async () => {
    const { rerender } = render(<MarkdownEditor value="doc A" onChange={() => {}} contentKey="a" />);
    expect(await screen.findByTestId('crepe-editor')).toHaveAttribute('data-default-value', 'doc A');
    rerender(<MarkdownEditor value="doc B" onChange={() => {}} contentKey="b" />);
    await waitFor(() => {
      expect(screen.getByTestId('crepe-editor')).toHaveAttribute('data-default-value', 'doc B');
    });
  });

  it('switches to the Raw view (verbatim textarea) and back, reloading the WYSIWYG with raw edits', async () => {
    const user = userEvent.setup();
    let value = '# Title';
    const onChange = vi.fn((next: string) => {
      value = next;
    });
    const { rerender } = render(<MarkdownEditor value={value} onChange={onChange} ariaLabel="Answer" />);
    await screen.findByTestId('crepe-editor');

    // Visual → Raw: the same controlled textarea, seeded with the current value.
    await user.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.queryByTestId('crepe-editor')).toBeNull();
    const raw = screen.getByRole('textbox', { name: 'Answer' }) as HTMLTextAreaElement;
    expect(raw.value).toBe('# Title');

    // Raw edits flow through the SAME onChange as the WYSIWYG.
    raw.focus();
    await user.paste(' (edited)');
    expect(value).toBe('# Title (edited)');
    rerender(<MarkdownEditor value={value} onChange={onChange} ariaLabel="Answer" />);

    // Raw → Visual: Crepe remounts seeded with the raw edits.
    await user.click(screen.getByRole('button', { name: 'Visual' }));
    const crepe = await screen.findByTestId('crepe-editor');
    expect(crepe).toHaveAttribute('data-default-value', '# Title (edited)');
  });

  it('plain mode renders no view toggle', () => {
    render(<MarkdownEditor mode="plain" value="" onChange={() => {}} ariaLabel="Body" />);
    expect(screen.queryByRole('button', { name: 'Raw' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Visual' })).toBeNull();
  });

  it('degrades to the plain textarea when the editor chunk throws', async () => {
    // Persistent throw (not Once): React retries a failed render before the
    // boundary commits, and the degradation must hold through the retry.
    const defaultImpl = mockCrepe.getMockImplementation();
    mockCrepe.mockImplementation(() => {
      throw new Error('chunk failed to load');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSilencer = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<MarkdownEditor value="fallback content" onChange={() => {}} ariaLabel="Answer" />);
      const textarea = await screen.findByRole('textbox', { name: 'Answer' });
      expect(textarea).toHaveValue('fallback content');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('plain editor'), expect.any(Error));
    } finally {
      if (defaultImpl) mockCrepe.mockImplementation(defaultImpl);
      warn.mockRestore();
      errorSilencer.mockRestore();
    }
  });
});

describe('textarea passthrough (plain-mode overlay support)', () => {
  it('textareaRef receives the HTMLTextAreaElement in plain mode', () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    render(<MarkdownEditor mode="plain" value="hi" onChange={() => {}} ariaLabel="Body" textareaRef={ref} />);
    const textarea = screen.getByRole('textbox', { name: 'Body' });
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current).toBe(textarea);
  });

  it('onScroll fires when the plain-mode textarea scrolls', () => {
    const onScroll = vi.fn();
    render(<MarkdownEditor mode="plain" value="hi" onChange={() => {}} ariaLabel="Body" onScroll={onScroll} />);
    fireEvent.scroll(screen.getByRole('textbox', { name: 'Body' }));
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it('textareaRef and onScroll also reach the markdown-mode Raw view textarea', async () => {
    const user = userEvent.setup();
    const ref = { current: null as HTMLTextAreaElement | null };
    const onScroll = vi.fn();
    render(
      <MarkdownEditor value="# Title" onChange={() => {}} ariaLabel="Answer" textareaRef={ref} onScroll={onScroll} />,
    );
    await screen.findByTestId('crepe-editor');

    await user.click(screen.getByRole('button', { name: 'Raw' }));
    const raw = screen.getByRole('textbox', { name: 'Answer' });
    expect(ref.current).toBe(raw);

    fireEvent.scroll(raw);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });
});
