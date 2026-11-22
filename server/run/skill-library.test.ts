// @module-tag integration
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { captureSkills, discoverSkills } from './skill-library';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true })));
});
it('rejects an oversized references folder before returning attached context', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'studio-skill-cap-'));
  folders.push(root);
  await fs.mkdir(path.join(root, 'writer/references'), { recursive: true });
  await fs.writeFile(path.join(root, 'writer/SKILL.md'), '# Writer');
  await Promise.all(
    Array.from({ length: 101 }, (_, index) =>
      fs.writeFile(path.join(root, `writer/references/${index}.md`), 'evidence'),
    ),
  );
  const [skill] = await discoverSkills(root);
  await expect(captureSkills(root, [skill.id])).rejects.toThrow('100 files');
});
it('rejects a reference alias pointing at a private file within the library', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'studio-skill-private-'));
  folders.push(root);
  await fs.mkdir(path.join(root, 'writer/references'), { recursive: true });
  await fs.mkdir(path.join(root, 'secrets'));
  await fs.writeFile(path.join(root, 'secrets/credentials.txt'), 'private credential');
  await fs.symlink(path.join(root, 'secrets/credentials.txt'), path.join(root, 'writer/references/rules.md'));
  await fs.writeFile(path.join(root, 'writer/SKILL.md'), 'Read @references/rules.md.');
  const [skill] = await discoverSkills(root);
  await expect(captureSkills(root, [skill.id])).rejects.toThrow('Cannot load skill file');
});
