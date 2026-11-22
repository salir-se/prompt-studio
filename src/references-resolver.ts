export type ReferenceResolution =
  | { state: 'Found'; path: string }
  | { state: 'Missing' | 'Outside project' }
  | { state: 'Ambiguous'; candidates: string[] };

function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part.toLowerCase() === '.git' || part === '.prompt-studio') return null;
    else parts.push(part);
  }
  return parts.join('/') || null;
}
export function resolveProjectReference(
  raw: string,
  documentPath: string,
  files: readonly string[],
): ReferenceResolution {
  let path = raw.replaceAll('\\', '/');
  try {
    path = decodeURIComponent(path.split('#')[0]);
  } catch {
    return { state: 'Missing' };
  }
  if (/^(?:\/|[a-z][\w+.-]*:)/i.test(path)) return { state: 'Outside project' };
  const directory = documentPath.split('/').slice(0, -1).join('/');
  const local = normalize(`${directory}/${path}`);
  const root = path.startsWith('.') ? null : normalize(path);
  if (!local && !root) return { state: 'Outside project' };
  const candidates = [
    ...new Set([root, local].filter((candidate): candidate is string => !!candidate && files.includes(candidate))),
  ];
  return candidates.length === 1
    ? { state: 'Found', path: candidates[0] }
    : candidates.length > 1
      ? { state: 'Ambiguous', candidates }
      : { state: 'Missing' };
}
