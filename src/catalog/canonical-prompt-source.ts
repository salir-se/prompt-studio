import { PromptVerificationProfileSchema } from '@prompt-studio/prompts';
import { type } from 'arktype';
import type { CanonicalPromptRoot, CanonicalPromptSource } from './canonical-prompt-contract';
import { installedCatalogSkipsSalirSources } from './salir-catalog-gate';

const STUDIO_TOKEN_HEADER = 'x-studio-token';
const ROOTS_JSON_PATH = 'docs/prompts/generated/studio-prompt-roots.json';
let roots = new Map<string, CanonicalPromptRoot>();

function readStudioToken(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? null;
}

function parseRoot(input: unknown): CanonicalPromptRoot | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || typeof value.text !== 'string') return null;
  if (!Array.isArray(value.toolNames) || value.toolNames.some((name) => typeof name !== 'string')) return null;
  if (!Array.isArray(value.sections) || !Array.isArray(value.profiles)) return null;
  const sections = value.sections.flatMap((section) => {
    if (typeof section !== 'object' || section === null) return [];
    const item = section as Record<string, unknown>;
    return typeof item.id === 'string' &&
      typeof item.tag === 'string' &&
      typeof item.heading === 'string' &&
      typeof item.profileId === 'string' &&
      (item.parentId === undefined || typeof item.parentId === 'string')
      ? [
          {
            id: item.id,
            tag: item.tag,
            heading: item.heading,
            profileId: item.profileId,
            ...(typeof item.parentId === 'string' ? { parentId: item.parentId } : {}),
          },
        ]
      : [];
  });
  if (sections.length !== value.sections.length) return null;
  const profiles = value.profiles.map((profile) => PromptVerificationProfileSchema(profile));
  if (profiles.some((profile) => profile instanceof type.errors)) return null;
  return {
    id: value.id,
    text: value.text,
    toolNames: value.toolNames as string[],
    sections,
    profiles: profiles as CanonicalPromptRoot['profiles'],
  };
}

export const bundledCanonicalPromptSource: CanonicalPromptSource = {
  getRoot(id) {
    return roots.get(id) ?? null;
  },
};

export async function primeCanonicalPromptSource(): Promise<void> {
  roots = new Map();
  try {
    if (typeof fetch !== 'function') return;
    const token = readStudioToken();
    if (!token) return;
    if (await installedCatalogSkipsSalirSources()) return;
    const response = await fetch(`/__studio/file?path=${encodeURIComponent(ROOTS_JSON_PATH)}`, {
      headers: { [STUDIO_TOKEN_HEADER]: token },
    });
    if (!response.ok) return;
    const body = (await response.json()) as { ok?: boolean; text?: string };
    if (!body.ok || typeof body.text !== 'string') return;
    const parsed: unknown = JSON.parse(body.text);
    if (!Array.isArray(parsed)) return;
    const valid = parsed.map(parseRoot).filter((root): root is CanonicalPromptRoot => root !== null);
    if (valid.length !== parsed.length) return;
    roots = new Map(valid.map((root) => [root.id, root]));
  } catch (error) {
    console.warn('[canonical-prompt-source] failed to load canonical prompt projection', error);
  }
}
