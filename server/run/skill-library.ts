import * as fs from 'node:fs/promises';
import path from 'node:path';
import { extractPromptFileReferences } from '@prompt-studio/prompts';
import { hasBlockedSegment, isWithinRoot } from '../../src/bridge/fs-bridge';
import { safeAdoptionReferencePath } from '../../src/prompt-repo/reference-path';
import type { CapturedFile, RunRecord, SkillEntry } from '../../src/run/contracts';
import { fingerprint } from './local-store';

export async function skillsRoot(folder: string): Promise<string> {
  if (!path.isAbsolute(folder)) throw new Error('Enter the absolute path to your skills folder.');
  try {
    const root = await fs.realpath(folder);
    if (!(await fs.stat(root)).isDirectory()) throw new Error();
    return root;
  } catch {
    throw new Error('The skills folder is unavailable. Choose an existing readable folder.');
  }
}

async function textFile(root: string, relative: string): Promise<CapturedFile> {
  const normalized = path.posix.normalize(relative.replaceAll('\\', '/'));
  if (!safeAdoptionReferencePath(normalized) || hasBlockedSegment(normalized))
    throw new Error(`Skill reference is outside the library or private: ${relative}`);
  const target = path.resolve(root, normalized);
  try {
    const actual = await fs.realpath(target);
    if (!isWithinRoot(root, actual) || hasBlockedSegment(path.relative(root, actual).split(path.sep).join('/')))
      throw new Error();
    const info = await fs.stat(actual);
    if (!info.isFile() || info.size > 128 * 1024) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(actual));
    if (text.includes('\0')) throw new Error();
    return { path: normalized, text, hash: fingerprint(text) };
  } catch {
    throw new Error(
      `Cannot load skill file ${normalized}. Use readable UTF-8 files under 128 KiB inside the skills folder.`,
    );
  }
}

async function walk(root: string, directory = '', depth = 0, budget = { entries: 0 }): Promise<string[]> {
  if (depth > 8) throw new Error('The skills folder exceeds eight directory levels. Choose a smaller folder.');
  const found: string[] = [];
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    if (++budget.entries > 3000) throw new Error('The skills folder exceeds 3,000 entries. Choose a smaller folder.');
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (hasBlockedSegment(relative) || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) found.push(...(await walk(root, relative, depth + 1, budget)));
    else if (entry.isFile()) found.push(relative);
  }
  return found.sort();
}

export async function discoverSkills(folder: string): Promise<SkillEntry[]> {
  if (!folder) return [];
  const root = await skillsRoot(folder);
  const entries = (await walk(root)).filter((file) => path.posix.basename(file) === 'SKILL.md');
  if (entries.length > 256) throw new Error('The library exceeds 256 skills. Choose a smaller folder.');
  return Promise.all(
    entries.map(async (file) => {
      const content = await textFile(root, file);
      return {
        id: `${fingerprint(root).slice(0, 16)}:${file}`,
        path: file,
        name: path.posix.dirname(file) === '.' ? path.basename(root) : path.posix.dirname(file),
        description: (
          /^description:\s*(.+)$/m.exec(content.text)?.[1] ??
          content.text
            .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
            .split('\n')
            .find((line) => line.trim()) ??
          ''
        ).slice(0, 240),
      };
    }),
  );
}

export async function captureSkills(folder: string, ids: string[]): Promise<RunRecord['skills']> {
  if (ids.length > 16 || new Set(ids).size !== ids.length) throw new Error('Attach up to 16 unique skills.');
  if (!ids.length) return [];
  const root = await skillsRoot(folder);
  const available = await discoverSkills(root);
  const inventory = await walk(root);
  let totalBytes = 0;
  return Promise.all(
    ids.map(async (id) => {
      const skill = available.find((entry) => entry.id === id);
      if (!skill) throw new Error('An attached skill is unavailable in the configured folder. Reattach it in Run.');
      const files = new Map<string, CapturedFile>();
      const add = async (relative: string) => {
        if (files.has(relative)) return;
        if (files.size >= 100) throw new Error('A skill references more than 100 files.');
        const file = await textFile(root, relative);
        totalBytes += Buffer.byteLength(file.text);
        if (totalBytes > 400_000) throw new Error('Attached skills exceed the 400 KiB run limit.');
        files.set(relative, file);
      };
      await add(skill.path);
      const referenceFolder = `${path.posix.dirname(skill.path)}/references/`.replace(/^\.\//, '');
      for (const file of inventory.filter(
        (file) => file.startsWith(referenceFolder) && safeAdoptionReferencePath(file),
      ))
        await add(file);
      // Follow explicit local links too; a bounded queue handles cycles without repeated loading.
      for (const file of files.values()) {
        for (const reference of extractPromptFileReferences(file.text)) {
          if (/^(?:\/|[A-Za-z][\w+.-]*:)/.test(reference.path))
            throw new Error('Skill references must stay inside the skills folder.');
          const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), reference.path));
          await add(relative);
          if (files.size > 100) throw new Error('A skill references more than 100 files.');
        }
      }
      return { id, name: skill.name, files: [...files.values()] };
    }),
  );
}
