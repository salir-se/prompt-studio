import type { LegacyPromptRootInventoryEntry } from '@prompt-studio/prompts';
import type { CatalogRoot } from '../catalog/root-catalog';

/**
 * Skill documents (ADR-235, expectation 5): each `packages/skills/skills/<name>/SKILL.md` becomes
 * a first-class editable catalog root with id `skill-<name>` — selectable in the sidebar, editable
 * through the same single-chokepoint write path, auto-committed to the active configuration's
 * history, and carried by project archives.
 *
 * Skills load through the read-only bridge in BOTH dev and container (the dev server runs the same
 * `/__studio/*` plugin — see `vite.config.ts`), so there is exactly one loading path. Failure is
 * always degrade-to-empty (skills are additive; their absence must never block the studio).
 *
 * Export note: blueprint OVERLAY export refuses skill documents (ADR-202 §6 — mounts, not bodies);
 * project archives include them like any other root's heads.
 */

const SKILLS_BRIDGE_ROOT = 'packages/skills/skills';
const STUDIO_TOKEN_HEADER = 'x-studio-token';

/** Duplicated from fs-bridge.ts on purpose — see bridge-content-source.ts's module doc for why. */

function readStudioToken(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? null;
}

interface BridgeListBody {
  ok?: boolean;
  entries?: Array<{ name?: unknown; type?: unknown }>;
}

/** Lists the skill directory names under the skills root; never throws (empty on any failure). */
async function listSkillNames(skillsRoot: string): Promise<string[]> {
  try {
    if (typeof fetch !== 'function') return [];
    const token = readStudioToken();
    if (!token) return [];
    const response = await fetch(`/__studio/list?dir=${encodeURIComponent(skillsRoot)}`, {
      headers: { [STUDIO_TOKEN_HEADER]: token },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as BridgeListBody;
    if (!body.ok || !Array.isArray(body.entries)) return [];
    return body.entries
      .filter((entry) => entry.type === 'dir' && typeof entry.name === 'string')
      .map((entry) => entry.name as string)
      .sort();
  } catch {
    return [];
  }
}

/** Fetches one skill's SKILL.md; `null` (never a throw) when unavailable. */
async function fetchSkillMarkdown(skillsRoot: string, name: string): Promise<string | null> {
  try {
    if (typeof fetch !== 'function') return null;
    const token = readStudioToken();
    if (!token) return null;
    const path = `${skillsRoot}/${name}/SKILL.md`;
    const response = await fetch(`/__studio/file?path=${encodeURIComponent(path)}`, {
      headers: { [STUDIO_TOKEN_HEADER]: token },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean; text?: string };
    if (!body.ok || typeof body.text !== 'string') return null;
    return body.text;
  } catch {
    return null;
  }
}

/** Synthesizes an inventory-shaped entry for a skill document (same rationale as extraDocuments). */
function skillEntry(skillsRoot: string, name: string): LegacyPromptRootInventoryEntry {
  return {
    id: `skill-${name}`,
    kind: 'system',
    status: 'live',
    owner: { module: `${skillsRoot}/${name}/SKILL.md`, symbol: `<skill ${name}>` },
    consumers: [],
    editableKeys: [],
    dynamicSources: [],
    toolSets: [],
    variants: [],
    ownedFragments: [],
    protectedSkills: [name],
    legacyIdentity: [],
  };
}

/** The catalog root id for a skill directory name. */
export function skillDocumentId(name: string): string {
  return `skill-${name}`;
}

export function isSkillDocumentId(rootId: string): boolean {
  return rootId.startsWith('skill-');
}

/**
 * Loads every skill in the manifest's skills root as a `constant` catalog root. Skills whose
 * SKILL.md cannot be fetched are skipped (visible by absence), not rendered broken.
 */
export async function loadSkillCatalogRoots(skillsRoot: string = SKILLS_BRIDGE_ROOT): Promise<readonly CatalogRoot[]> {
  const names = await listSkillNames(skillsRoot);
  const loaded = await Promise.all(
    names.map(async (name) => {
      const text = await fetchSkillMarkdown(skillsRoot, name);
      if (text === null) return null;
      const entry = skillEntry(skillsRoot, name);
      const root: CatalogRoot = {
        id: entry.id,
        title: `Skill: ${name}`,
        loadability: 'constant',
        status: 'live',
        text,
        toolNames: [],
        protectedSkills: [name],
        ownerLabel: entry.owner.symbol,
        entry,
      };
      return root;
    }),
  );
  return loaded.filter((root): root is CatalogRoot => root !== null);
}
