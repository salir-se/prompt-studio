import { createHash } from 'node:crypto';
import type { MemoryRepository } from './memory-project';
import { DIR, safePath } from './repository-policy';

export interface ProjectFileEdit {
  path: string;
  text: string;
  expectedHash: string;
}
export interface ProjectTextFile {
  path: string;
  text: string;
  hash: string;
}
export class ProjectFileConflict extends Error {}
const MAX_TEXT_BYTES = 1024 * 1024;
function publicFile(path: string): boolean {
  return safePath(path) && !path.split('/').includes('.prompt-studio');
}
export async function projectFileIndex(repo: MemoryRepository): Promise<string[]> {
  const entries = await Promise.all(
    (await repo.allFiles())
      .filter(publicFile)
      .map(async (path) => ({ path, stat: await repo.fs.promises.lstat(`${DIR}/${path}`) })),
  );
  return entries
    .filter(({ stat }) => stat.isFile() || stat.isSymbolicLink())
    .map(({ path }) => path)
    .sort();
}
export async function readProjectFile(repo: MemoryRepository, path: string): Promise<ProjectTextFile> {
  if (!publicFile(path)) throw new Error('That path is outside the project or private to Studio.');
  let current = DIR;
  for (const part of path.split('/')) {
    current += `/${part}`;
    if ((await repo.fs.promises.lstat(current)).isSymbolicLink())
      throw new Error('Opening symbolic links is unsupported.');
  }
  const info = await repo.fs.promises.stat(current);
  if (!info.isFile()) throw new Error('Choose a project file.');
  if (info.size > MAX_TEXT_BYTES) throw new Error('This file exceeds the 1 MiB text editor limit.');
  const bytes = Buffer.from(await repo.fs.promises.readFile(current));
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw new Error();
  } catch {
    throw new Error('This file is not editable UTF-8 text. Export the project to edit it externally.');
  }
  return { path, text, hash: createHash('sha256').update(bytes).digest('hex') };
}
export async function editProjectFiles(repo: MemoryRepository, edits: readonly ProjectFileEdit[]): Promise<void> {
  const paths = new Set<string>();
  for (const edit of edits) {
    if (paths.has(edit.path)) throw new Error('Choose unique project files.');
    paths.add(edit.path);
    if (Buffer.byteLength(edit.text) > MAX_TEXT_BYTES || edit.text.includes('\0'))
      throw new Error('Save UTF-8 text under 1 MiB.');
    const saved = await readProjectFile(repo, edit.path);
    if (saved.hash !== edit.expectedHash)
      throw new ProjectFileConflict(
        `${edit.path} changed since you opened it. Keep your draft and reopen the saved file before retrying.`,
      );
  }
  for (const edit of edits) {
    await repo.fs.promises.writeFile(`${DIR}/${edit.path}`, edit.text);
    if (!repo.editedFiles.includes(edit.path)) repo.editedFiles.push(edit.path);
  }
}
