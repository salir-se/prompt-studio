// @module-tag dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('renders **bold** as <strong> rather than literal asterisks', () => {
    render(<Markdown text="You edit drafts in the **Outreach** tab." />);
    const strong = screen.getByText('Outreach');
    expect(strong.tagName).toBe('STRONG');
    // The literal asterisks must not survive into the DOM text.
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it('renders *italic* / _italic_ as <em>', () => {
    render(<Markdown text="This is *very* _important_." />);
    expect(screen.getByText('very').tagName).toBe('EM');
    expect(screen.getByText('important').tagName).toBe('EM');
  });

  it('renders `inline code` as <code>', () => {
    render(<Markdown text="Press the `Run Scout` button." />);
    expect(screen.getByText('Run Scout').tagName).toBe('CODE');
  });

  it('renders a numbered list as an ordered list', () => {
    render(<Markdown text={'Steps:\n1. Open the tab\n2. Click Edit\n3. Approve'} />);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    // Markers are set inline so they survive a host CSS reset (Tailwind Preflight
    // sets `ol,ul { list-style: none }`).
    expect(list).toHaveStyle({ listStyleType: 'decimal' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Open the tab', 'Click Edit', 'Approve']);
  });

  it('keeps contiguous 1./2./3. items in a single ordered list with no start attribute', () => {
    render(<Markdown text={'1. Open the tab\n2. Click Edit\n3. Approve'} />);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(list).not.toHaveAttribute('start');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Open the tab', 'Click Edit', 'Approve']);
  });

  it('continues ordered-list numbering across a group split by a prose line', () => {
    // The studio final-prompt preview case: explicit 1./2./3. steps, a prose line, then 4./5. —
    // every group used to restart at 1; the second <ol> must now carry the source's own start.
    render(
      <Markdown
        text={[
          '1. Open the tab',
          '2. Click Edit',
          '3. Approve',
          '',
          'Now finish up:',
          '',
          '4. Save',
          '5. Publish',
        ].join('\n')}
      />,
    );
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    expect(lists[0]).not.toHaveAttribute('start');
    expect(
      within(lists[0])
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Open the tab', 'Click Edit', 'Approve']);
    expect(lists[1]).toHaveAttribute('start', '4');
    expect(
      within(lists[1])
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Save', 'Publish']);
  });

  it('renders both bullet markers and preserves the Markdown list boundary when the marker changes', () => {
    render(<Markdown text={'- first\n- second\n* third'} />);
    const lists = screen.getAllByRole('list');
    expect(lists.map((list) => list.tagName)).toEqual(['UL', 'UL']);
    expect(
      lists.map((list) =>
        within(list)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ),
    ).toEqual([['first', 'second'], ['third']]);
  });

  it('renders headings', () => {
    render(<Markdown text={'# Title\n## Section\n### Sub'} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Sub' })).toBeInTheDocument();
  });

  it('renders [links](url) as anchors and opens external links safely', () => {
    render(<Markdown text="See the [Admin Console](https://salir.se/admin)." />);
    const link = screen.getByRole('link', { name: 'Admin Console' });
    expect(link).toHaveAttribute('href', 'https://salir.se/admin');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not linkify javascript: URLs', () => {
    // A would-be malicious link must render inert (no anchor with the dangerous href).
    render(<Markdown text="[click](javascript:alert(1))" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not parse markdown inside inline code spans', () => {
    render(<Markdown text="Use `**not bold**` literally." />);
    const code = screen.getByText('**not bold**');
    expect(code.tagName).toBe('CODE');
  });

  it('splits paragraphs on blank lines', () => {
    const { container } = render(<Markdown text={'First paragraph.\n\nSecond paragraph.'} />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
  });

  it('renders nothing meaningful for empty input without throwing', () => {
    const { container } = render(<Markdown text="" />);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('renders a GFM table as a real <table> with header and body cells', () => {
    render(
      <Markdown
        text={
          '| Area | What it does |\n|------|-------------|\n| Filter toolbar | narrow by Type |\n| Pagination | 25 per page |'
        }
      />,
    );
    const table = screen.getByRole('table');
    // Header cells (th).
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Area', 'What it does']);
    for (const cell of table.querySelectorAll('th, td')) {
      expect(cell).toHaveAttribute('data-layout-contract', 'dense-row');
    }
    // Body rows (excludes the header row).
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(
      within(bodyRows[0])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Filter toolbar', 'narrow by Type']);
    // The raw delimiter/pipe syntax must not survive as text.
    expect(table.textContent).not.toContain('|');
    expect(table.textContent).not.toContain('---');
  });

  it('parses inline markdown (bold, code) inside table cells', () => {
    render(<Markdown text={'| Col |\n|-----|\n| **bold** and `code` |'} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('bold').tagName).toBe('STRONG');
    expect(within(table).getByText('code').tagName).toBe('CODE');
  });

  it('does not treat a lone pipe line without a delimiter row as a table', () => {
    // A paragraph that merely contains a pipe must stay a paragraph.
    const { container } = render(<Markdown text={'This a | b sentence has a pipe.'} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.querySelector('p')?.textContent).toContain('|');
  });
});
