/**
 * The Markdown settings every WYSIWYG editor instance uses, shared by the live Crepe editor and by the headless
 * editor that tests the round trip. Import only from `MilkdownCrepeEditor.tsx` (the lazy chunk) and tests, so
 * `@milkdown/*` never reaches an app's initial bundle (ADR-096).
 */
import { defaultValueCtx, Editor, remarkCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { getMarkdown } from '@milkdown/kit/utils';
import type { ParseMarkdown } from './markdown-fidelity';

/**
 * Writes `-` bullets and `---` rules, the forms authors type most, instead of the serializer's `*` default. Set
 * before the editor is created.
 */
export function configureExactMarkdown(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: '-' as const, rule: '-' as const }));
}

/** The editor's own Markdown parser (CommonMark plus the GFM plugins). Read after the editor is created. */
export function editorMarkdownParser(ctx: Ctx): ParseMarkdown {
  const processor = ctx.get(remarkCtx);
  return (markdown) => processor.parse(markdown);
}

export interface HeadlessMarkdown {
  parse: ParseMarkdown;
  /** What the editor writes back for `markdown` when nothing is edited. */
  roundTrip: (markdown: string) => Promise<string>;
}

/**
 * A view-less editor with the same presets and settings as the Crepe editor (CommonMark + GFM; Crepe's extra
 * features add views, not Markdown syntax), for tests that load real texts without a browser.
 */
export async function createHeadlessMarkdown(): Promise<HeadlessMarkdown> {
  const make = async (defaultValue: string) => {
    const root = document.createElement('div');
    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, defaultValue);
        configureExactMarkdown(ctx);
      })
      .use(commonmark)
      .use(gfm)
      .create();
    return editor;
  };
  const probe = await make('');
  const parse = probe.action(editorMarkdownParser);
  return {
    parse,
    roundTrip: async (markdown) => {
      const editor = await make(markdown);
      const output = editor.action(getMarkdown());
      await editor.destroy();
      return output;
    },
  };
}
