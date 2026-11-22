import * as fs from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { manifestFromPromptRepoFiles } from '../prompt-repo/layout';

/**
 * The folder the installed program edits when the person has not pointed it at a checkout.
 * It is never `/repo`: that default is the Salir source tree, and on Windows it becomes
 * `<drive>:\repo`, which the person does not have.
 */
export function installedPromptRepoDir(env: NodeJS.ProcessEnv): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return path.join(home, 'Salir Prompt Studio', 'repository');
}

async function promptRepoFiles(repoRoot: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) found.push(relative);
    }
  }
  await walk(path.join(repoRoot, 'prompts'), 'prompts');
  await walk(path.join(repoRoot, 'skills'), 'skills');
  return found;
}

/**
 * Prepares the installed editor. Returns nothing when the person already chose a repository
 * or a manifest, so a developer checkout keeps working.
 */
export async function prepareInstalledStudio(
  env: NodeJS.ProcessEnv,
): Promise<{ repoRoot: string; manifestPath: string } | null> {
  if (env.STUDIO_REPO_ROOT || env.STUDIO_MANIFEST_PATH) return null;
  const repoRoot = installedPromptRepoDir(env);
  await mkdir(path.join(repoRoot, 'prompts'), { recursive: true });
  await mkdir(path.join(repoRoot, 'skills'), { recursive: true });
  await git.init({ fs, dir: repoRoot, defaultBranch: 'main' });
  const layout = manifestFromPromptRepoFiles('Your prompts', await promptRepoFiles(repoRoot));
  if (!layout.ok) throw new Error('The prompt folder could not be read.');
  const manifestPath = path.join(repoRoot, '.studio-manifest.json');
  await writeFile(manifestPath, JSON.stringify(layout.manifest));
  return { repoRoot, manifestPath };
}
