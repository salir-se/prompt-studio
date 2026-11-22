import { Markdown as MarkdownContent, type MarkdownComponents, MarkdownLink } from '@prompt-studio/markdown/react';
import type { CSSProperties } from 'react';

export interface MarkdownProps {
  text: string;
}

const spacing: CSSProperties = { margin: '0 0 6px' };
const heading: CSSProperties = { ...spacing, fontSize: '1em', fontWeight: 600 };
const list: CSSProperties = { ...spacing, paddingInlineStart: 20, listStylePosition: 'outside' };
const cell: CSSProperties = {
  border: '1px solid var(--border, rgba(0, 0, 0, 0.15))',
  padding: 'var(--spacing) calc(var(--spacing) * 1)',
};

const components = {
  h1: (props) => <h1 {...props} style={{ ...heading, fontSize: '1.1em' }} />,
  h2: (props) => <h2 {...props} style={heading} />,
  h3: (props) => <h3 {...props} style={heading} />,
  p: (props) => <p {...props} style={{ ...spacing, lineHeight: 1.5 }} />,
  ol: (props) => <ol {...props} style={{ ...list, listStyleType: 'decimal' }} />,
  ul: (props) => <ul {...props} style={{ ...list, listStyleType: 'disc' }} />,
  a: (props) => (
    <MarkdownLink
      {...props}
      style={{ color: 'var(--primary, #2563eb)', textDecoration: 'underline', textUnderlineOffset: 2 }}
    />
  ),
  table: (props) => (
    <div className="markdown-table-scroll" style={spacing}>
      <table {...props} style={{ borderCollapse: 'collapse', fontSize: '0.95em', width: '100%' }} />
    </div>
  ),
  th: (props) => (
    <th
      {...props}
      scope="col"
      data-layout-contract="dense-row"
      style={{
        ...cell,
        fontWeight: 600,
        background: 'var(--muted, rgba(0, 0, 0, 0.04))',
        textAlign: 'left',
        ...props.style,
      }}
    />
  ),
  td: (props) => (
    <td {...props} data-layout-contract="dense-row" style={{ ...cell, textAlign: 'left', ...props.style }} />
  ),
} satisfies MarkdownComponents;

export function Markdown({ text }: MarkdownProps) {
  return (
    <div data-help-markdown style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowWrap: 'anywhere' }}>
      <MarkdownContent source={text} components={components} />
    </div>
  );
}
