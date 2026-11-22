import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex');

/** Private runtime data is outside the Git project and its publication/export paths. */
export class LocalRunStore {
  constructor(readonly directory: string) {}
  project(projectId: string) {
    return `projects/${fingerprint(projectId)}`;
  }
  async read<T>(key: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.directory, key), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw new Error('Local run data could not be read. Your saved files have been preserved.', { cause: error });
    }
  }
  async write(key: string, value: unknown, exclusive = false) {
    const target = path.join(this.directory, key);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (exclusive) await fs.link(temporary, target);
      else await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  async list(key: string): Promise<string[]> {
    try {
      return (await fs.readdir(path.join(this.directory, key))).filter((name) => name.endsWith('.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
