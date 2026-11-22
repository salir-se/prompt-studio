/**
 * SkillMountNode — a presentational, read-only card rendering one skill
 * mount point (`name@version` + the mount tag it sits under) for the prompt
 * graph studio.
 *
 * Per ADR-202 §6: a `skill-mount` node renders COLLAPSED, redacted by
 * default, showing only `name@version` and the mount tag — never the
 * skill's body. That body (the `SKILL.md` under `packages/skills/skills/`)
 * is Salir IP per ADR-093/ADR-089's agent-skills model: it is injected into
 * the system prompt server-side and must never reach a client bundle.
 *
 * Two boundaries keep that posture intact here, matching ADR-202 §6's own
 * wording almost verbatim:
 *
 *  - **This component has no dependency on `@prompt-studio/skills` loaders and no
 *    way to fetch anything.** It is physically incapable of retrieving a
 *    skill body — it renders only the `summary` string its caller passes,
 *    and only when the caller ALSO opts out of the default `redacted: true`
 *    posture. There is no prop that names a file path or a skill id to load.
 *  - **The studio deliberately passes nothing.** When `www/app.salir.se`
 *    later imports this component, the operator SPA has no access to skill
 *    bodies either (ADR-089 keeps them server-side), so it renders in the
 *    same redacted state every other caller gets by default.
 *
 * Pure by design, matching `FragmentNode`/`LabelChip`/`ToolDefinitionNode`:
 * no data fetching, no `useEffect`, no graph-rendering library import.
 *
 * Colour vocabulary: emerald, matching the `tag` token kind in
 * `TOKEN_KIND_CLASSES` (`PromptHighlightedEditor.tsx`) — a mount point is a
 * structural tag (like `<mount_tag>`), not a variable or a tool reference.
 */

import { cn } from '@prompt-studio/ui/utils';

export interface SkillMountNodeProps {
  /** Stable skill id / folder name under `packages/skills/skills/` (`AgentSkillMeta.name`). Not secret. */
  name: string;
  /** Short, non-sensitive label for the skill (`AgentSkillMeta.label`). NOT the skill's (IP) description. */
  label: string;
  /** The skill's version, shown as `name@version`. Omitted renders `name` alone. */
  version?: string;
  /** The prompt tag this skill is mounted under (e.g. `session_learning_closeout`), shown as `<mountTag>`. */
  mountTag: string;
  /**
   * Whether the skill's body stays redacted. Defaults to `true` — the safe, IP-protecting posture per
   * ADR-202 §6. When `false` and `summary` is given, that non-sensitive summary renders instead of the
   * redaction notice; this component never fetches the summary itself.
   */
  redacted?: boolean;
  /** A non-sensitive summary to show ONLY when `redacted` is `false`. Never the skill's protected body. */
  summary?: string;
  /** Whether this node is the current selection in a containing graph/list view. */
  selected?: boolean;
}

const SKILL_KIND_CHIP_CLASSES = 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300';
const CHIP_BASE_CLASSES = 'inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-xs';

/** Inline padlock glyph — matches lucide's `Lock` path data/stroke conventions (no new dependency: this
 *  package doesn't declare `lucide-react`, so the icon is reproduced as a literal SVG instead). */
function LockIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function SkillMountNode({
  name,
  label,
  version,
  mountTag,
  redacted = true,
  summary,
  selected = false,
}: SkillMountNodeProps): React.JSX.Element {
  return (
    <article
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      data-selected={selected}
      data-redacted={redacted}
      data-testid="skill-mount-node"
      className={cn(
        'flex w-[360px] flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground',
        selected && 'ring-2 ring-ring',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{label}</h3>
        <span className={cn(CHIP_BASE_CLASSES, SKILL_KIND_CHIP_CLASSES, 'shrink-0')}>skill</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{version ? `${name}@${version}` : name}</span>
        {mountTag && (
          <>
            <span aria-hidden="true">·</span>
            <span className={cn(CHIP_BASE_CLASSES, SKILL_KIND_CHIP_CLASSES)}>{`<${mountTag}>`}</span>
          </>
        )}
      </div>
      {redacted ? (
        <div
          data-testid="skill-mount-node-redacted"
          className="flex items-center gap-1.5 rounded-md bg-muted p-2 text-xs text-muted-foreground"
        >
          <LockIcon className="size-3.5 shrink-0" />
          <span>Protected content — body never leaves the server.</span>
        </div>
      ) : (
        summary && (
          <p
            data-testid="skill-mount-node-summary"
            className="line-clamp-3 rounded-md bg-muted p-2 text-xs text-muted-foreground"
          >
            {summary}
          </p>
        )
      )}
    </article>
  );
}
