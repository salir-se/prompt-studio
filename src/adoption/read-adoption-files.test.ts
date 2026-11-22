// @vitest-environment node
// @module-tag pure
import { describe, expect, it } from 'vitest';
import { readAdoptionFiles } from './read-adoption-files';

function file(path: string, text: string | Uint8Array) {
  const result = new File([typeof text === 'string' ? text : new Uint8Array(text)], path.split('/').at(-1)!);
  Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}
describe('adoption file intake', () => {
  it('preserves UTF-8 source, BOM, CRLF and reference paths', async () => {
    const text = '\uFEFF---\r\nname: test\r\n---\r\nRead @references/rules.md';
    expect(
      await readAdoptionFiles([
        file('test/SKILL.md', text),
        file('test/references/rules.md', 'Rules\r\n'),
        file('test/LICENSE', 'License'),
      ]),
    ).toEqual({
      text,
      filename: 'SKILL.md',
      attachments: [
        { path: 'references/rules.md', text: 'Rules\r\n' },
        { path: 'LICENSE', text: 'License' },
      ],
    });
  });
  it('rejects binary, ambiguous skills and traversal without partially importing', async () => {
    await expect(
      readAdoptionFiles([file('test/SKILL.md', 'Source'), file('test/data.bin', new Uint8Array([255, 0]))]),
    ).rejects.toThrow(/UTF-8|binary/);
    await expect(readAdoptionFiles([file('a/SKILL.md', 'A'), file('b/SKILL.md', 'B')])).rejects.toThrow(/exactly one/);
    await expect(
      readAdoptionFiles([file('test/SKILL.md', 'Source'), file('test/../secret.md', 'Secret')]),
    ).rejects.toThrow(/reference/);
  });
});
