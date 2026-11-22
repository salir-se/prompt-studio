/**
 * Per-configuration skill selection (PS-009): overrides only, per agent, per project — an agent
 * with no entry inherits the shipped protected-skills behavior. Owns the override state, its
 * reload-on-project-switch persistence, the effective/available skill derivations, and the toggle
 * the Final-prompt drawer's chips drive. Extracted verbatim from App.tsx.
 */

import { useEffect, useMemo, useState } from 'react';
import { agentForRootId, loadSkillsOverride, saveSkillsOverride, toggleSkill } from '../skills/skills-selection';
import type { DocumentEditor } from './use-document-editor';
import type { HistoryBoot } from './use-history-boot';

export function useSkillsSelection({ boot, editor }: { boot: HistoryBoot; editor: DocumentEditor }) {
  const { doc } = editor;
  const { history, allRoots, skillRoots } = boot;
  const [skillsOverride, setSkillsOverride] = useState<ReturnType<typeof loadSkillsOverride>>({});
  const activeProjectIdForSkills = history?.activeProjectId ?? null;
  useEffect(() => {
    setSkillsOverride(activeProjectIdForSkills === null ? {} : loadSkillsOverride(activeProjectIdForSkills));
  }, [activeProjectIdForSkills]);

  /**
   * The document's agent's EFFECTIVE mounted skills: the configuration's override when one
   * exists, else the shipped `protectedSkills`. Never `undefined` for a mapped agent — the
   * Final-prompt drawer's toggle chips only render when this is defined, and returning
   * `undefined` pre-override used to hide the chips entirely on a fresh configuration, making
   * the first override unreachable (the affordance was invisible until it already existed).
   */
  const injectedSkills = useMemo(() => {
    if (!doc) return undefined;
    const agent = agentForRootId(doc.rootId);
    if (agent === '') return undefined;
    const override = skillsOverride[agent];
    if (override !== undefined) return override;
    return allRoots.find((root) => root.id === doc.rootId)?.protectedSkills ?? [];
  }, [doc, skillsOverride, allRoots]);

  /** Every mountable skill name (the loaded skill documents). */
  const availableSkills = useMemo(() => skillRoots.map((root) => root.id.replace(/^skill-/, '')), [skillRoots]);

  function toggle(name: string): void {
    if (!history || !doc) return;
    const agent = agentForRootId(doc.rootId);
    if (agent === '') return;
    // Toggle against the EFFECTIVE list: on a fresh configuration the shipped protectedSkills
    // are what's mounted, so un-mounting one creates the override from that starting point.
    const current = skillsOverride[agent] ?? injectedSkills ?? [];
    const next = toggleSkill({ ...skillsOverride, [agent]: current }, agent, name);
    setSkillsOverride(next);
    saveSkillsOverride(history.activeProjectId, next);
  }

  return { injectedSkills, availableSkills, toggleSkill: toggle };
}

export type SkillsSelection = ReturnType<typeof useSkillsSelection>;
