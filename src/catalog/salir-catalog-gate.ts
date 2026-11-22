const STUDIO_TOKEN_HEADER = 'x-studio-token';

/** The Salir checkout catalog. A person's prompt folder uses `prompts` and `skills` instead. */
export function usesSalirSourceTree(contentRoots: readonly string[]): boolean {
  return contentRoots.includes('packages/prompts');
}

/**
 * True when this computer's studio is a person's prompt folder, so the page must not ask
 * the bridge for `packages/prompts/src/*.ts`.
 */
export async function installedCatalogSkipsSalirSources(): Promise<boolean> {
  if (typeof fetch !== 'function' || typeof document === 'undefined') return false;
  const token = document.querySelector('meta[name="studio-token"]')?.getAttribute('content');
  if (!token) return false;
  try {
    const response = await fetch('/__studio/manifest', { headers: { [STUDIO_TOKEN_HEADER]: token } });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean; manifest?: { contentRoots?: unknown } };
    const roots = body.manifest?.contentRoots;
    if (!body.ok || !Array.isArray(roots) || roots.some((root) => typeof root !== 'string')) return false;
    return !usesSalirSourceTree(roots as string[]);
  } catch {
    return false;
  }
}
