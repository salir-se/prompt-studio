import { createHash } from 'node:crypto';

/** Release asset names published for each machine. `platformForThisMachine` in `./update.ts` uses the same keys. */
export const RELEASE_OBJECTS = {
  'macos-arm64': 'prompt-studio-macos-arm64',
  'macos-x64': 'prompt-studio-macos-x64',
  'linux-x64': 'prompt-studio-linux-x64',
  'windows-x64': 'prompt-studio-windows-x64.exe',
} as const;

export type ReleasePlatform = keyof typeof RELEASE_OBJECTS;

export interface LatestJson {
  readonly version: string;
  readonly objects: Record<ReleasePlatform, { readonly key: string; readonly sha256: string }>;
}

/** The release asset name for a platform. Assets are downloaded from `<release download base>/v<version>/<key>`. */
export function objectKey(_version: string, platform: ReleasePlatform): string {
  return RELEASE_OBJECTS[platform];
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The `latest.json` release asset that `prompt-studio update` reads. */
export function buildLatestJson(version: string, files: Record<ReleasePlatform, Uint8Array>): LatestJson {
  const objects = {} as LatestJson['objects'];
  for (const platform of Object.keys(RELEASE_OBJECTS) as ReleasePlatform[]) {
    objects[platform] = { key: objectKey(version, platform), sha256: sha256Hex(files[platform]) };
  }
  return { version, objects };
}
