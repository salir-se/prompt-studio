import { randomUUID } from 'node:crypto';
import * as disk from 'node:fs';
import * as files from 'node:fs/promises';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { createFsFromVolume, Volume } from 'memfs';
import { manifestFromPromptRepoFiles } from './layout';
import { emptyProjectDefinitions, type ProjectDefinitions, validateProjectDefinitions } from './project-definitions';
import { writableReferencePath } from './reference-path';
import {
  AUTHOR,
  DIR,
  MAX_BYTES,
  MAX_FILES,
  METADATA_PATH,
  type ProjectArchive,
  type Publication,
  type RepositoryData,
  safeHttp,
  safePath,
  safeRemote,
  writableProjectPath,
} from './repository-policy';

export class MemoryRepository {
  vol = new Volume();
  fs = createFsFromVolume(this.vol);
  projectId = randomUUID();
  revision = 0;
  editedFiles: string[] = [];
  lastDraft?: { mutationId: string; revision: number };
  branch = 'main';
  remote?: string;
  sourcePath?: string;
  baseCommit?: string;
  publication?: Publication;
  constructor(public name: string) {}
  private async write(file: string, bytes: Uint8Array | string) {
    await this.fs.promises.mkdir(path.posix.dirname(`${DIR}/${file}`), { recursive: true });
    await this.fs.promises.writeFile(`${DIR}/${file}`, bytes);
  }
  async read(file: string): Promise<string> {
    if (!safePath(file)) throw new Error('That file is outside the project.');
    return String(await this.fs.promises.readFile(`${DIR}/${file}`, 'utf8'));
  }
  async list(directory: string) {
    if (!safePath(directory) || !/^(prompts|skills)(\/|$)/.test(directory))
      throw new Error('That folder is outside the project.');
    const entries = await this.fs.promises.readdir(`${DIR}/${directory}`);
    return Promise.all(
      entries.map(async (entry) => ({
        name: String(entry),
        type: (await this.fs.promises.stat(`${DIR}/${directory}/${String(entry)}`)).isDirectory() ? 'dir' : 'file',
      })),
    );
  }
  async allFiles(): Promise<string[]> {
    return Object.keys(this.vol.toJSON(DIR, undefined, false, true))
      .map((file) => file.slice(DIR.length + 1))
      .filter(safePath);
  }
  async definitions(): Promise<ProjectDefinitions> {
    try {
      return validateProjectDefinitions(JSON.parse(await this.read(METADATA_PATH)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyProjectDefinitions(this.name);
      throw error;
    }
  }
  async describe() {
    const layout = manifestFromPromptRepoFiles(this.name, await this.allFiles());
    if (!layout.ok) throw new Error('Project prompt names conflict.');
    const documents = await Promise.all(
      layout.documents.map(async (document) => ({ ...document, text: await this.read(document.path) })),
    );
    return {
      ok: true as const,
      open: true as const,
      projectId: this.projectId,
      revision: this.revision,
      ...(this.lastDraft ? { lastDraft: { ...this.lastDraft } } : {}),
      name: this.name,
      branch: this.branch,
      ...(this.remote ? { remote: this.remote } : {}),
      documents,
      definitions: await this.definitions(),
    };
  }
  async initialize() {
    await git.init({ fs: this.fs, dir: DIR, defaultBranch: this.branch });
    await this.write(METADATA_PATH, JSON.stringify(emptyProjectDefinitions(this.name), null, 2));
    await git.add({ fs: this.fs, dir: DIR, filepath: METADATA_PATH });
    await git.commit({ fs: this.fs, dir: DIR, message: 'Create prompt project', author: AUTHOR });
  }
  async patch(documents: readonly { path: string; text: string }[], definitions?: unknown) {
    const seen = new Set<string>();
    if (definitions !== undefined) {
      for (const file of ['.prompt-studio', METADATA_PATH]) {
        try {
          if ((await this.fs.promises.lstat(`${DIR}/${file}`)).isSymbolicLink())
            throw new Error('Editing symbolic links is unsupported.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    let size = 0;
    for (const doc of documents) {
      if (
        !(writableProjectPath(doc.path) || writableReferencePath(doc.path)) ||
        doc.path === METADATA_PATH ||
        seen.has(doc.path)
      )
        throw new Error('Choose unique prompt files inside this project.');
      size += Buffer.byteLength(doc.text);
      seen.add(doc.path);
      if (size > MAX_BYTES) throw new Error('Project changes are too large.');
      // Never write through a repository symlink, including a parent directory.
      let current = DIR;
      for (const part of doc.path.split('/')) {
        current += `/${part}`;
        try {
          if ((await this.fs.promises.lstat(current)).isSymbolicLink())
            throw new Error('Editing symbolic links is unsupported.');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    const validated = definitions === undefined ? undefined : validateProjectDefinitions(definitions);
    for (const doc of documents) await this.write(doc.path, doc.text);
    if (validated) {
      await this.write(METADATA_PATH, JSON.stringify(validated, null, 2));
      this.name = validated.name;
    }
    await this.describe();
    this.revision++;
  }
  async commit(message: string): Promise<string> {
    const status = await git.statusMatrix({ fs: this.fs, dir: DIR });
    const changed = status.filter(
      ([file, head, worktree]) =>
        (writableProjectPath(file) || writableReferencePath(file) || this.editedFiles.includes(file)) &&
        head !== worktree,
    );
    if (changed.length === 0) return git.resolveRef({ fs: this.fs, dir: DIR, ref: 'HEAD' });
    for (const [filepath, , worktree] of changed) {
      if (worktree) await git.add({ fs: this.fs, dir: DIR, filepath });
      else await git.remove({ fs: this.fs, dir: DIR, filepath });
    }
    return git.commit({ fs: this.fs, dir: DIR, author: AUTHOR, message: message.trim() || 'Save prompts' });
  }
  async history(file?: string) {
    if (file && !writableProjectPath(file)) throw new Error('That file is outside the project.');
    const entries = await git.log({ fs: this.fs, dir: DIR, ...(file ? { filepath: file } : {}) });
    return entries.map(({ oid, commit }) => ({ commit: oid, message: commit.message.trim() }));
  }
  async restore(file: string, oid: string) {
    if (!writableProjectPath(file) || !/^[a-f0-9]{40}$/.test(oid)) throw new Error('Choose a valid project version.');
    if (!(await git.log({ fs: this.fs, dir: DIR })).some((entry) => entry.oid === oid))
      throw new Error('That version is not part of this project.');
    const { blob } = await git.readBlob({ fs: this.fs, dir: DIR, oid, filepath: file });
    const text = new TextDecoder().decode(blob);
    if (file === METADATA_PATH) await this.patch([], JSON.parse(text));
    else await this.patch([{ path: file, text }]);
    return { text, commit: await this.commit(`Restore ${file}`) };
  }
  static async local(location: string, requestedBranch?: string) {
    const absolute = await files.realpath(path.resolve(location));
    const repo = new MemoryRepository(path.basename(absolute).replace(/\.git$/, '') || 'prompts');
    const gitdir = disk.existsSync(path.join(absolute, '.git')) ? path.join(absolute, '.git') : absolute;
    if (!(await files.lstat(gitdir)).isDirectory())
      throw new Error('Linked worktrees are not supported yet. Open a regular repository checkout.');
    if (!disk.existsSync(path.join(gitdir, 'HEAD'))) throw new Error('That folder is not a Git repository.');
    let copiedBytes = 0;
    let copiedFiles = 0;
    async function copy(from: string, to: string): Promise<void> {
      for (const entry of await files.readdir(from, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Repositories containing symbolic links are not supported.');
        if (entry.isDirectory()) await copy(path.join(from, entry.name), `${to}/${entry.name}`);
        else {
          const content = await files.readFile(path.join(from, entry.name));
          copiedBytes += content.length;
          copiedFiles++;
          if (copiedBytes > 256 * 1024 * 1024 || copiedFiles > 100_000)
            throw new Error('Repository is too large for the in-memory editor.');
          await repo.write(`${to}/${entry.name}`, content);
        }
      }
    }
    // Copy Git data only: never import hooks, credentials, reflogs, or a dirty index.
    await git.init({ fs: repo.fs, dir: DIR, defaultBranch: 'main' });
    for (const directory of ['objects', 'refs']) {
      if (disk.existsSync(path.join(gitdir, directory))) await copy(path.join(gitdir, directory), `.git/${directory}`);
    }
    for (const file of ['HEAD', 'packed-refs', 'shallow']) {
      if (disk.existsSync(path.join(gitdir, file))) {
        if (!(await files.lstat(path.join(gitdir, file))).isFile())
          throw new Error('Linked Git metadata is unsupported.');
        await repo.write(`.git/${file}`, await files.readFile(path.join(gitdir, file)));
      }
    }
    repo.sourcePath = absolute;
    const currentBranch = await git.currentBranch({ fs: repo.fs, dir: DIR });
    if (!requestedBranch && !currentBranch)
      throw new Error('This repository has a detached HEAD. Check out a branch before opening it.');
    repo.branch = requestedBranch ?? currentBranch!;
    const remotes = await git.listRemotes({ fs: disk, gitdir });
    const origin = remotes.find((remote) => remote.remote === 'origin')?.url;
    if (origin?.startsWith('https://')) repo.remote = safeRemote(origin);
    try {
      await git.resolveRef({ fs: repo.fs, dir: DIR, ref: repo.branch });
      // Rebuild the index from HEAD; never include somebody else's staged changes in a Studio commit.
      try {
        await repo.fs.promises.unlink(`${DIR}/.git/index`);
      } catch {
        // No index yet: nothing to rebuild from.
      }
      await git.checkout({ fs: repo.fs, dir: DIR, ref: repo.branch, force: true });
      if (gitdir !== absolute && !requestedBranch) {
        for (const file of await git.listFiles({ fs: repo.fs, dir: DIR })) {
          const source = path.join(absolute, file);
          try {
            const info = await files.lstat(source);
            if (info.isSymbolicLink()) throw new Error('Repositories containing symbolic links are not supported.');
            const real = await files.realpath(source);
            if (!real.startsWith(`${absolute}${path.sep}`)) throw new Error('Repository file escapes its folder.');
            await repo.write(file, await files.readFile(source));
            await repo.fs.promises.chmod(`${DIR}/${file}`, info.mode);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            await repo.fs.promises.unlink(`${DIR}/${file}`);
          }
        }
      }
    } catch (error) {
      if (requestedBranch || (error as { code?: string }).code !== 'NotFoundError') throw error;
      await repo.initialize();
    }
    if (gitdir !== absolute && !requestedBranch) {
      try {
        for (const relative of ['.prompt-studio', METADATA_PATH]) {
          if ((await files.lstat(path.join(absolute, relative))).isSymbolicLink())
            throw new Error('Repositories containing symbolic links are not supported.');
        }
        const metadata = await files.readFile(path.join(absolute, METADATA_PATH), 'utf8');
        validateProjectDefinitions(JSON.parse(metadata));
        await repo.write(METADATA_PATH, metadata);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      // Recover pre-versioning Studio files, without importing arbitrary untracked files or secrets.
      for (const directory of ['prompts', 'skills']) {
        async function ownedFiles(folder: string, prefix: string): Promise<void> {
          let entries: disk.Dirent[];
          try {
            if ((await files.lstat(folder)).isSymbolicLink())
              throw new Error('Repositories containing symbolic links are not supported.');
            entries = await files.readdir(folder, { withFileTypes: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
          }
          for (const entry of entries) {
            const relative = `${prefix}/${entry.name}`;
            if (entry.isSymbolicLink()) throw new Error('Repositories containing symbolic links are not supported.');
            if (entry.isDirectory()) await ownedFiles(path.join(folder, entry.name), relative);
            else if (writableProjectPath(relative))
              await repo.write(relative, await files.readFile(path.join(folder, entry.name)));
          }
        }
        await ownedFiles(path.join(absolute, directory), directory);
      }
    }
    repo.baseCommit = await git.resolveRef({ fs: repo.fs, dir: DIR, ref: 'HEAD' });
    await repo.rejectLinks();
    await repo.definitions();
    return repo;
  }
  static async clone(url: string, token?: string, branch?: string, transport: git.HttpClient = safeHttp) {
    const repo = new MemoryRepository(
      new URL(url).pathname
        .split('/')
        .filter(Boolean)
        .at(-1)
        ?.replace(/\.git$/, '') || 'prompts',
    );
    repo.remote = safeRemote(url);
    await git.clone({
      fs: repo.fs,
      http: transport,
      dir: DIR,
      url: repo.remote,
      ...(branch ? { ref: branch } : {}),
      onAuth: (challenge) => (new URL(challenge).origin === 'https://github.com' && token ? { username: token } : {}),
    });
    repo.branch = (await git.currentBranch({ fs: repo.fs, dir: DIR })) ?? branch ?? 'main';
    repo.baseCommit = await git.resolveRef({ fs: repo.fs, dir: DIR, ref: 'HEAD' });
    await repo.rejectLinks();
    await repo.definitions();
    return repo;
  }
  async rejectLinks() {
    for (const file of await git.listFiles({ fs: this.fs, dir: DIR })) {
      try {
        if ((await this.fs.promises.lstat(`${DIR}/${file}`)).isSymbolicLink())
          throw new Error('Repositories containing symbolic links are not supported.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  async archive(): Promise<ProjectArchive> {
    const exported = [];
    let bytes = 0;
    for (const file of await this.allFiles()) {
      const stat = await this.fs.promises.lstat(`${DIR}/${file}`);
      if (stat.isSymbolicLink()) throw new Error('Exporting symbolic links is unsupported.');
      bytes += Number(stat.size);
      if (bytes > MAX_BYTES || exported.length >= MAX_FILES)
        throw new Error('Project export exceeds 32 MiB or 10,000 files.');
      if (stat.isFile())
        exported.push({
          path: file,
          base64: Buffer.from(await this.fs.promises.readFile(`${DIR}/${file}`)).toString('base64'),
          mode: Number(stat.mode) & 0o111 ? 0o100755 : 0o100644,
        });
    }
    return { format: 'prompt-studio-project-files@1', name: this.name, files: exported };
  }
  static async importArchive(input: unknown) {
    const archive = input as ProjectArchive;
    if (
      archive?.format !== 'prompt-studio-project-files@1' ||
      typeof archive.name !== 'string' ||
      !archive.name.trim() ||
      !Array.isArray(archive.files) ||
      archive.files.length > MAX_FILES
    )
      throw new Error('Invalid project archive.');
    let total = 0;
    const seen = new Set<string>();
    for (const file of archive.files) {
      if (
        !file ||
        typeof file.path !== 'string' ||
        !safePath(file.path) ||
        seen.has(file.path) ||
        typeof file.base64 !== 'string' ||
        (file.mode !== undefined && file.mode !== 0o100644 && file.mode !== 0o100755)
      )
        throw new Error('Invalid or duplicate project file.');
      total += Buffer.byteLength(file.base64, 'base64');
      seen.add(file.path);
      if (total > MAX_BYTES) throw new Error('Project archive exceeds 32 MiB.');
      if (Buffer.from(file.base64, 'base64').toString('base64') !== file.base64)
        throw new Error('Invalid or duplicate project file.');
    }
    const repo = new MemoryRepository(archive.name.trim());
    await git.init({ fs: repo.fs, dir: DIR, defaultBranch: 'main' });
    for (const file of archive.files) {
      await repo.write(file.path, Buffer.from(file.base64, 'base64'));
      await repo.fs.promises.chmod(`${DIR}/${file.path}`, file.mode ?? 0o100644);
    }
    await repo.definitions();
    await repo.describe();
    for (const file of archive.files) await git.add({ fs: repo.fs, dir: DIR, filepath: file.path });
    await git.commit({ fs: repo.fs, dir: DIR, author: AUTHOR, message: 'Import prompt project' });
    return repo;
  }
  snapshot(): RepositoryData {
    const entries = this.vol.toJSON('/', undefined, false, true);
    const encoded: Record<string, string> = {};
    const modes: Record<string, number> = {};
    for (const [file, content] of Object.entries(entries))
      if (content !== null) {
        encoded[file] = Buffer.from(content).toString('base64');
        modes[file] = this.vol.statSync(file).mode;
      }
    return {
      projectId: this.projectId,
      name: this.name,
      editedFiles: [...this.editedFiles],
      revision: this.revision,
      lastDraft: this.lastDraft ? { ...this.lastDraft } : undefined,
      branch: this.branch,
      remote: this.remote,
      sourcePath: this.sourcePath,
      baseCommit: this.baseCommit,
      publication: this.publication,
      files: encoded,
      modes,
    };
  }
  static fromSnapshot(data: RepositoryData) {
    const repo = new MemoryRepository(data.name);
    Object.assign(repo, {
      editedFiles: [...(data.editedFiles ?? [])],
      projectId: data.projectId,
      revision: data.revision,
      lastDraft: data.lastDraft ? { ...data.lastDraft } : undefined,
      branch: data.branch,
      remote: data.remote,
      sourcePath: data.sourcePath,
      baseCommit: data.baseCommit,
      publication: data.publication,
    });
    repo.vol = Volume.fromJSON(
      Object.fromEntries(Object.entries(data.files).map(([file, content]) => [file, Buffer.from(content, 'base64')])),
    );
    for (const [file, mode] of Object.entries(data.modes ?? {})) repo.vol.chmodSync(file, mode);
    repo.fs = createFsFromVolume(repo.vol);
    return repo;
  }
  copy() {
    return MemoryRepository.fromSnapshot(this.snapshot());
  }
  async push(branch: string, token?: string, transport: git.HttpClient = safeHttp) {
    if (!this.remote) throw new Error('Connect a remote repository first.');
    await git.push({
      fs: this.fs,
      http: {
        async request(request) {
          const response = await transport.request(request);
          if (!request.url.includes('/info/refs') || response.statusCode !== 200 || !response.body) return response;
          const chunks: Buffer[] = [];
          for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
          const advertisement = Buffer.concat(chunks);
          const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(` refs/heads/${escaped}(?:\\x00|\\n|$)`).test(advertisement.toString()))
            throw new Error('That branch was created remotely. Choose a new branch.');
          return {
            ...response,
            body: (async function* () {
              yield advertisement;
            })(),
          };
        },
      },
      dir: DIR,
      url: this.remote,
      ref: this.branch,
      remoteRef: branch,
      force: false,
      onAuth: (challenge) => (new URL(challenge).origin === 'https://github.com' && token ? { username: token } : {}),
    });
  }
}
