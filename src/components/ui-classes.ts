/**
 * The studio shell's shared Tailwind class vocabulary — the button/badge "tokens" the chrome
 * components (Sidebar/TopBar/Inspector) share, extracted from App.tsx so each component file
 * styles plain elements consistently without duplicating the strings.
 *
 * `cn` is a minimal `clsx`-style classname joiner, standing in for `@prompt-studio/ui/utils`'s `cn`. This
 * app only declares `@prompt-studio/prompt-graph-ui`/`@prompt-studio/prompts` as dependencies (plus the Tailwind
 * pair) — `@prompt-studio/ui` is a TRANSITIVE dependency of `@prompt-studio/prompt-graph-ui`, not one Bun's
 * isolated linker resolves for a package (this app) that never declared it itself — so these files
 * cannot import `Button`/`Badge`/`cn` from `@prompt-studio/ui` directly and instead style plain elements
 * inline.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export const BUTTON_BASE_CLASSES =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';
export const BUTTON_SM_CLASSES = 'h-7 px-2.5';
export const BUTTON_OUTLINE_CLASSES = 'border border-border bg-card hover:bg-muted';
export const BUTTON_DEFAULT_CLASSES = 'bg-primary text-primary-foreground hover:bg-primary/90';
export const BADGE_OUTLINE_CLASSES =
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground';
