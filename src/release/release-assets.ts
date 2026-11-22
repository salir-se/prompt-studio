import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLatestJson, RELEASE_OBJECTS, type ReleasePlatform } from './latest-json';

/**
 * Release step: reads the compiled binaries from a directory and writes the `latest.json` that
 * `prompt-studio update` reads. The release workflow uploads the binaries and this file as GitHub Release assets.
 */

/** Reads one compiled binary per platform. An empty or missing file is an error. */
export async function loadReleaseFiles(directory: string): Promise<Record<ReleasePlatform, Uint8Array>> {
  const files = {} as Record<ReleasePlatform, Uint8Array>;
  for (const platform of Object.keys(RELEASE_OBJECTS) as ReleasePlatform[]) {
    const bytes = new Uint8Array(await readFile(path.join(directory, RELEASE_OBJECTS[platform])));
    if (bytes.byteLength === 0) throw new Error(`The ${platform} build is empty.`);
    files[platform] = bytes;
  }
  return files;
}

/** Writes `<directory>/latest.json` for `version` and returns its path. */
export async function writeLatestJson(version: string, directory: string): Promise<string> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Release version must be X.Y.Z, got "${version}".`);
  const latest = buildLatestJson(version, await loadReleaseFiles(directory));
  const target = path.join(directory, 'latest.json');
  await writeFile(target, `${JSON.stringify(latest, null, 2)}\n`);
  return target;
}

if (import.meta.main) {
  const [version = '', directory = 'release'] = process.argv.slice(2);
  const target = await writeLatestJson(version.replace(/^v/, ''), directory);
  process.stdout.write(`${target}\n`);
}
