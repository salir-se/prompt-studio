import { createHash, randomUUID } from 'node:crypto';
import * as files from 'node:fs/promises';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { MemoryRepository } from './memory-project';
import { DIR, type RepositoryData } from './repository-policy';

export class RepositoryStore {
  projects = new Map<string, MemoryRepository>();
  activeId?: string;
  private observedHash: string | null = null;
  constructor(private directory: string) {}
  get active() {
    return this.activeId ? this.projects.get(this.activeId) : undefined;
  }
  private async readRecovery(): Promise<Buffer | null> {
    try {
      return await files.readFile(path.join(this.directory, 'projects.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async load() {
    const raw = await this.readRecovery();
    if (raw === null) {
      this.projects.clear();
      this.activeId = undefined;
      this.observedHash = null;
      return;
    }
    const data = JSON.parse(raw.toString('utf8')) as { activeId: string; projects: RepositoryData[] };
    if (!Array.isArray(data.projects))
      throw new Error('Project recovery data is invalid. Your saved file has been preserved.');
    const projects = new Map<string, MemoryRepository>();
    for (const item of data.projects) {
      const repo = MemoryRepository.fromSnapshot(item);
      await git.log({ fs: repo.fs, dir: DIR });
      await repo.describe();
      projects.set(repo.projectId, repo);
    }
    this.projects = projects;
    this.activeId = data.activeId;
    this.observedHash = createHash('sha256').update(raw).digest('hex');
  }
  async adopt(repo: MemoryRepository) {
    const projects = new Map(this.projects);
    projects.set(repo.projectId, repo);
    await files.mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, 'projects.json');
    const temporary = `${target}.${randomUUID()}.tmp`;
    const lockPath = path.join(this.directory, 'projects.lock');
    let lock: files.FileHandle;
    try {
      lock = await files.open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      throw new Error(
        `Another Prompt Studio instance is saving. Retry shortly. If this persists after a crash, close all Prompt Studio processes, then remove ${lockPath} and restart.`,
        { cause: error },
      );
    }
    try {
      const raw = await this.readRecovery();
      const currentHash = raw === null ? null : createHash('sha256').update(raw).digest('hex');
      if (currentHash !== this.observedHash)
        throw new Error(
          'Project recovery changed on disk in another Prompt Studio instance. Restart to load its saved work before retrying.',
        );
      const serialized = JSON.stringify({
        activeId: repo.projectId,
        projects: [...projects.values()].map((item) => item.snapshot()),
      });
      const handle = await files.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(serialized);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await files.rename(temporary, target);
      this.projects = projects;
      this.activeId = repo.projectId;
      this.observedHash = createHash('sha256').update(serialized).digest('hex');
    } finally {
      try {
        await files.rm(temporary, { force: true });
      } finally {
        await lock.close();
        await files.unlink(lockPath);
      }
    }
  }
}
