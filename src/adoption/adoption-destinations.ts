import type { ProjectArchive } from '../prompt-repo/prompt-repo-client';

/** An identical durable draft is safe to retry after a later history/checkpoint failure. */
export function assertAdoptionDestinations(
  documents: readonly { path: string; text: string }[],
  archive: ProjectArchive,
  existingPath?: string,
) {
  for (const file of documents) {
    if (file.path === existingPath) continue;
    const known = archive.files.find((entry) => entry.path === file.path);
    if (!known) continue;
    const bytes = Uint8Array.from(atob(known.base64), (character) => character.charCodeAt(0));
    if (new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== file.text)
      throw new Error(`A project file already exists at ${file.path}. Adapt the open document instead.`);
  }
}
