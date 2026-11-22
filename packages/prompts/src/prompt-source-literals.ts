/** Preserve source offsets while excluding frontmatter and fenced examples from structure discovery. */
export function maskPromptSourceLiterals(text: string): string {
  const lines = text.split('\n');
  const metadataEnd = /^\uFEFF?---\s*$/.test(lines[0] ?? '')
    ? lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line))
    : -1;
  let fence: { marker: string; length: number } | undefined;
  return lines
    .map((line, index) => {
      if (metadataEnd > 0 && index <= metadataEnd) return ' '.repeat(line.length);
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && marker[2].trim() === '')
          fence = undefined;
        return ' '.repeat(line.length);
      }
      if (marker) {
        fence = { marker: marker[1][0], length: marker[1].length };
        return ' '.repeat(line.length);
      }
      return line;
    })
    .join('\n');
}
