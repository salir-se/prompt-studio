import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directory the standalone server resolves `dist/` and `src/manifest/` against.
 *
 * A source run (`bun server/main.ts`) uses the app directory, the parent of `server/`.
 * `bun build --compile` reports this module as `/$bunfs/root/<outfile>` on macOS and
 * Linux, and as `B:\~BUN\root\<outfile>` on Windows. Files passed with `--asset dist`
 * and `--asset src` are embedded beside that file. The parent `/$bunfs` or `B:\~BUN`
 * directory does not contain them, so the editor page never loads.
 */
export function standaloneAppRoot(moduleUrl: string): string {
  const modulePath = fileURLToPath(moduleUrl);
  if (modulePath.includes('$bunfs') || modulePath.includes('~BUN')) return path.dirname(modulePath);
  return path.resolve(path.dirname(modulePath), '..');
}
