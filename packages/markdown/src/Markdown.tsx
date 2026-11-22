import { Markdown as TanStackMarkdown, type MarkdownComponents } from '@tanstack/markdown/react';
import { type ComponentPropsWithoutRef, isValidElement, type ReactNode, useMemo } from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import { type MarkdownDocument, type MarkdownOptions, parseMarkdown, streamingExtensions } from './document';
import { codeHighlighter } from './highlight';

export type { MarkdownComponents } from '@tanstack/markdown/react';

export function MarkdownLink(props: ComponentPropsWithoutRef<'a'>) {
  const external = /^https?:\/\//i.test(props.href ?? '');
  return <a {...props} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} />;
}

function MarkdownTable(props: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="markdown-table-scroll">
      <table {...props} />
    </div>
  );
}

function HighlightedCode({ className, children }: ComponentPropsWithoutRef<'code'>) {
  const lang = className?.slice('language-'.length);
  if (typeof children !== 'string' || !lang || codeHighlighter.normalizeLanguage(lang) === 'plaintext') {
    return <code className={className}>{children}</code>;
  }
  const { tokens } = codeHighlighter.tokenize(children, { lang });
  let offset = 0;
  return (
    <code className={className}>
      {tokens.map((token) => {
        const start = offset;
        offset += token.value.length;
        return token.className ? (
          <span key={start} className={'th-' + token.className}>
            {token.value}
          </span>
        ) : (
          token.value
        );
      })}
    </code>
  );
}

function CodeBlock(props: ComponentPropsWithoutRef<'pre'> & { 'data-lang'?: string }) {
  const { children } = props;
  if (props['data-lang']?.toLowerCase() === 'mermaid' && isValidElement<{ children: ReactNode }>(children)) {
    const source = children.props.children;
    if (typeof source === 'string') return <MermaidDiagram code={source} />;
  }
  return <pre {...props} />;
}

interface MarkdownProps extends MarkdownOptions {
  /** Markdown text or a trusted document returned by parseMarkdown. */
  source: string | MarkdownDocument;
  components?: MarkdownComponents;
}

export function Markdown({ source, streaming, headingIds, extensions, components }: MarkdownProps) {
  const document = useMemo(
    () => (typeof source === 'string' ? parseMarkdown(source, { streaming, headingIds, extensions }) : source),
    [source, streaming, headingIds, extensions],
  );
  return (
    <TanStackMarkdown
      extensions={streaming ? streamingExtensions : undefined}
      components={{
        a: MarkdownLink,
        table: MarkdownTable,
        ...components,
        code: HighlightedCode,
        pre: streaming ? 'pre' : CodeBlock,
      }}
    >
      {document}
    </TanStackMarkdown>
  );
}
