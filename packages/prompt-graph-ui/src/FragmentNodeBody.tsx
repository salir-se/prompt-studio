import { Markdown } from '@prompt-studio/help-system';
import type { PromptToken } from '@prompt-studio/prompts';
import { HighlightedTokenSpans } from './HighlightedPromptText';

export function FragmentNodeBody({
  title,
  text,
  mode,
  tokens,
  className,
}: {
  title: string;
  text: string;
  mode: 'raw' | 'rendered';
  tokens: readonly PromptToken[];
  className: string;
}) {
  return (
    <section
      className={`nodrag nopan nokey select-text ${className}`}
      aria-label={`${title} instructions`}
      tabIndex={0}
      data-testid={mode === 'rendered' ? 'fragment-node-body-rendered' : undefined}
    >
      {mode === 'rendered' ? (
        <Markdown text={text} />
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono">
          <HighlightedTokenSpans tokens={tokens} />
        </pre>
      )}
    </section>
  );
}
