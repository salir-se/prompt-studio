/** Explicitly supplied text assets. Local repository discovery uses its narrower prompt-only policy. */
export function safeAdoptionReferencePath(path: string): boolean {
  return (
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) &&
    (/\.(?:md|txt|json|ya?ml|csv|toml|lua|py|js|ts|sh)$/i.test(path) ||
      /(?:^|\/)(?:README|LICENSE|NOTICE)$/i.test(path))
  );
}
export function writableReferencePath(path: string): boolean {
  const match = /^skills\/[^/]+\/(.+)$/.exec(path);
  return !!match && safeAdoptionReferencePath(path) && safeAdoptionReferencePath(match[1]);
}
