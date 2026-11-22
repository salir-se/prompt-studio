/**
 * Per-configuration skill selection (ADR-235 remainder, PS-009): which skills each AGENT mounts,
 * stored per project in localStorage (`prompt-studio:skills:v1:<projectId>`) like config-origin.
 *
 * Model: OVERRIDES only. An agent with no entry inherits the shipped behavior (the root's
 * `protectedSkills`); an entry REPLACES that list for the agent in this configuration. Keeping the
 * shipped default out of the store means "no selection" is indistinguishable from "shipped" and
 * new skills appear automatically until a developer deliberately pins an agent's list.
 */

const KEY_PREFIX = 'prompt-studio:skills:v1';

export type SkillsOverride = Readonly<Record<string, readonly string[]>>;

export function loadSkillsOverride(projectId: string): SkillsOverride {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}:${projectId}`);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const overrides: Record<string, readonly string[]> = {};
    for (const [agent, skills] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(skills) && skills.every((name) => typeof name === 'string')) {
        overrides[agent] = skills as readonly string[];
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

export function saveSkillsOverride(projectId: string, override: SkillsOverride): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}:${projectId}`, JSON.stringify(override));
  } catch {
    // Same posture as config-origin: selection is a convenience, never a boot dependency.
  }
}

export function forgetSkillsOverride(projectId: string): void {
  try {
    localStorage.removeItem(`${KEY_PREFIX}:${projectId}`);
  } catch {
    // Ignore — see saveSkillsOverride.
  }
}

/** Toggles one skill in one agent's list, returning the next override (immutable). */
export function toggleSkill(override: SkillsOverride, agent: string, skill: string): SkillsOverride {
  const current = override[agent] ?? [];
  const next = current.includes(skill) ? current.filter((name) => name !== skill) : [...current, skill];
  return { ...override, [agent]: next };
}

/** Maps a studio document/root id to the agent whose skill mounting it governs; '' = none. */
export function agentForRootId(rootId: string): string {
  if (rootId === 'scout') return 'scout';
  if (rootId === 'researcher') return 'researcher';
  if (rootId === 'closer') return 'closer';
  if (rootId === 'assistant' || rootId === 'help-assistant') return 'assistant';
  if (rootId.startsWith('critic')) return 'critic';
  return ''; // fragments, scheduler roots, skills themselves — no skill mounting
}
