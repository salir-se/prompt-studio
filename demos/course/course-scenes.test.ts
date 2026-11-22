// @module-tag pure
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The course scripts are inputs for Argo recordings: a manifest that does not parse, a scene without narration, or
 * a scene with no shot list fails the recording step later, far from the change that caused it.
 */
const DIR = import.meta.dirname;
// Argo reads a demo's manifest from `demos/<demo>.scenes.json`; the plans stay next to this test.
const DEMOS = path.resolve(DIR, '..');
const OVERLAY_TYPES = ['lower-third', 'headline-card', 'callout', 'image-card', 'arrow'];
const episodes = readdirSync(DEMOS)
  .filter((name) => /^course-ep\d-[a-z0-9-]+\.scenes\.json$/.test(name))
  .sort()
  .map((name) => name.replace('course-', '').replace('.scenes.json', ''));
const manifest = (episode: string) =>
  JSON.parse(readFileSync(path.join(DEMOS, `course-${episode}.scenes.json`), 'utf8')) as Scene[];

interface Scene {
  scene: string;
  text: string;
  elevenLabsDirection: string;
  overlay?: { type: string };
}

describe('course episode scripts', () => {
  it('has six episodes, numbered 1 to 6', () => {
    // Given: the course folder
    // Then: one manifest per episode, in order
    expect(episodes.map((name) => name.slice(0, 3))).toEqual(['ep1', 'ep2', 'ep3', 'ep4', 'ep5', 'ep6']);
  });

  it.each(episodes)('%s: every scene has narration, a voice direction, a valid overlay and a shot list', (episode) => {
    // Given: the episode manifest and its plan
    const scenes = manifest(episode);
    const plan = readFileSync(path.join(DIR, `${episode}.plan.md`), 'utf8');
    // When: each scene is inspected
    const ids = scenes.map((scene) => scene.scene);
    // Then: ids are unique slugs with narration, an audio tag and a known overlay type
    expect(new Set(ids).size).toBe(ids.length);
    for (const scene of scenes) {
      expect(scene.scene).toMatch(/^[a-z0-9-]+$/);
      expect(scene.text.trim().length).toBeGreaterThan(0);
      expect(scene.elevenLabsDirection).toMatch(/^\[[a-z ]+\]$/);
      if (scene.overlay) expect(OVERLAY_TYPES).toContain(scene.overlay.type);
    }
    // And: the plan has one section per scene, in the same order
    const headings = [...plan.matchAll(/^## ([a-z0-9-]+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(ids);
  });

  it('keeps each episode near the 3–4 minute target at 140 words per minute', () => {
    // Given: all manifests
    for (const episode of episodes) {
      const scenes = manifest(episode);
      // When: narration words are counted
      const words = scenes.reduce((sum, scene) => sum + scene.text.split(/\s+/).filter(Boolean).length, 0);
      // Then: narration alone stays between 2.5 and 4.2 minutes
      expect(words / 140, episode).toBeGreaterThanOrEqual(2.5);
      expect(words / 140, episode).toBeLessThanOrEqual(4.2);
    }
  });
});
