import { safeAdoptionReferencePath } from '../prompt-repo/reference-path';
import type { AdoptionAttachment } from './adopt-prompt';

/** Browser intake keeps supplied text byte-for-byte; binary assets use whole-project import. */
export async function readAdoptionFiles(files: readonly File[]) {
  if (!files.length) throw new Error('Choose a Markdown prompt or a skill folder.');
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > 8 * 1024 * 1024)
    throw new Error('Choose files totaling at most 8 MB. Use project import for larger sources.');
  const entries = files.map((file) => ({ file, path: file.webkitRelativePath || file.name }));
  const skills = entries.filter((entry) => /(?:^|\/)SKILL\.md$/i.test(entry.path));
  const main =
    skills.length === 1
      ? skills[0]
      : entries.length === 1 && /\.(md|txt)$/i.test(entries[0].path)
        ? entries[0]
        : undefined;
  if (!main) throw new Error('Choose one prompt file or a folder containing exactly one SKILL.md.');
  const folder = main.path.slice(0, main.path.lastIndexOf('/') + 1);
  const attachments: AdoptionAttachment[] = [];
  let text = '';
  for (const entry of entries) {
    const bytes = new Uint8Array(await entry.file.arrayBuffer());
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error(`${entry.path} is not UTF-8 text. Use project import to preserve binary assets.`);
    }
    if (content.includes('\0')) throw new Error(`${entry.path} is a binary file. Use project import to preserve it.`);
    if (entry === main) text = content;
    else {
      if (!entry.path.startsWith(folder)) throw new Error('References must be inside the selected skill folder.');
      const path = entry.path.slice(folder.length);
      if (!safeAdoptionReferencePath(path))
        throw new Error(`Unsupported reference file: ${path}. Use project import to preserve all assets.`);
      attachments.push({ path, text: content });
    }
  }
  return { text, filename: main.file.name, attachments };
}
