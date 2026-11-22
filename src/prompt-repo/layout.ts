import { type } from 'arktype';
import { type StudioManifestParsed, validateStudioManifest } from '../manifest/manifest-schema';

/**
 * A prompt repository is a folder a person can read without knowing the Salir monorepo:
 *
 *   prompts/<name>.md
 *   skills/<name>/SKILL.md
 *
 * Anything else is ignored. A path that escapes those two folders is refused.
 */

export const PROMPTS_DIR = 'prompts';
export const SKILLS_DIR = 'skills';

export interface PromptRepoDocument {
  readonly id: string;
  readonly title: string;
  readonly group: 'prompts' | 'skills';
  readonly path: string;
}

export type PromptRepoLayout =
  | { readonly ok: true; readonly documents: readonly PromptRepoDocument[]; readonly manifest: StudioManifestParsed }
  | { readonly ok: false; readonly reason: 'escape' | 'duplicate' };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/** True when every segment stays inside the repository (no absolute path, no `.` or `..`). */
export function isInsidePromptRepo(relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath.startsWith('/') || relativePath.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(relativePath)) return false;
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return false;
  return true;
}

function titleFromId(id: string): string {
  return id.replace(/[-_]+/g, ' ');
}

/**
 * Turns the relative paths found in a checkout into the studio manifest.
 * `repoName` is the GitHub repository name, shown as the catalog name.
 */
export function manifestFromPromptRepoFiles(repoName: string, relativePaths: readonly string[]): PromptRepoLayout {
  const documents: PromptRepoDocument[] = [];
  const seen = new Set<string>();

  for (const raw of relativePaths) {
    const relativePath = raw.replace(/\\/g, '/');
    if (!isInsidePromptRepo(relativePath)) return { ok: false, reason: 'escape' };

    const prompt = /^prompts\/([^/]+)\.md$/.exec(relativePath);
    const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(relativePath);
    const id = prompt?.[1] ?? skill?.[1];
    if (!id || !ID_PATTERN.test(id)) continue;

    if (seen.has(id)) return { ok: false, reason: 'duplicate' };
    seen.add(id);
    documents.push({
      id,
      title: titleFromId(id),
      group: prompt ? 'prompts' : 'skills',
      path: relativePath,
    });
  }

  documents.sort((a, b) => a.path.localeCompare(b.path));
  const name = repoName.trim().length > 0 ? repoName.trim() : 'prompts';
  const manifestInput = {
    schemaVersion: 1 as const,
    name,
    contentRoots: [PROMPTS_DIR, SKILLS_DIR],
    skillsRoot: SKILLS_DIR,
    exportRoot: PROMPTS_DIR,
    catalog: {
      source: 'explicit' as const,
      documents: documents.map((document) => ({
        id: document.id,
        title: document.title,
        group: document.group,
        source: { kind: 'file' as const, path: document.path },
      })),
    },
    baselines: [
      {
        id: 'repository',
        label: 'Your prompts',
        description: 'The prompts in this repository.',
        positioning: 'shipped' as const,
        source: { kind: 'shipped' as const },
      },
    ],
  };
  const manifest = validateStudioManifest(manifestInput);
  if (manifest instanceof type.errors) {
    throw new Error('Prompt repository layout did not produce a valid catalog.');
  }
  return { ok: true, documents, manifest };
}
