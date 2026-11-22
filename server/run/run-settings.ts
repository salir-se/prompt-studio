import { type } from 'arktype';
import { RUN_PROVIDERS, type RunProvider, type RunSettings } from '../../src/run/contracts';
import type { LocalRunStore } from './local-store';
import { discoverSkills, skillsRoot } from './skill-library';

const patchSchema = type({
  '+': 'reject',
  'skillsFolder?': 'string <= 4096',
  'provider?': 'string',
  'model?': 'string <= 200',
  'baseUrl?': 'string <= 2048',
  'apiKey?': 'string <= 4096',
  'helpModel?': type({
    '+': 'reject',
    provider: "'zai' | 'openai' | 'anthropic' | 'openrouter' | 'openai-compat'",
    model: 'string > 0 & string <= 200',
  }).or('null'),
});
type StoredSettings = Pick<RunSettings, 'skillsFolder' | 'provider' | 'model' | 'baseUrl' | 'helpModel'>;

export class RunSettingsStore {
  private saved?: StoredSettings;
  private credentials = new Map<RunProvider, { apiKey: string; baseUrl: string }>();
  private queue = Promise.resolve();
  constructor(
    private files: LocalRunStore,
    private initial?: { apiKey?: string; baseUrl?: string },
  ) {
    if (initial?.apiKey) this.credentials.set('zai', { apiKey: initial.apiKey, baseUrl: initial.baseUrl ?? '' });
  }
  async value(): Promise<StoredSettings> {
    this.saved ??= await this.files.read('settings.json', {
      skillsFolder: '',
      provider: 'zai',
      model: '',
      baseUrl: this.initial?.baseUrl ?? '',
    } as StoredSettings);
    return this.saved;
  }
  credential(provider: RunProvider) {
    const credential = this.credentials.get(provider);
    if (this.saved?.provider === provider && credential?.baseUrl !== this.saved.baseUrl) return undefined;
    return credential;
  }
  async describe(): Promise<RunSettings> {
    const settings = await this.value();
    let skills: RunSettings['skills'] = [];
    let skillsError: string | undefined;
    try {
      skills = await discoverSkills(settings.skillsFolder);
    } catch {
      skillsError = 'The skills folder is unavailable or exceeds library limits. Choose a readable folder in Settings.';
    }
    return {
      ...settings,
      skillsError,
      connected: !!this.credential(settings.provider),
      connectedProviders: [...this.credentials.keys()].filter((provider) => !!this.credential(provider)),
      skills,
    };
  }
  async update(raw: unknown): Promise<RunSettings> {
    const patch = patchSchema(raw);
    if (patch instanceof type.errors || (patch.provider && !RUN_PROVIDERS.includes(patch.provider as RunProvider)))
      throw new Error('Supply valid run settings.');
    const operation = this.queue.then(async () => {
      const previous = await this.value();
      const provider = (patch.provider ?? previous.provider) as RunProvider;
      const skillsFolder =
        patch.skillsFolder === undefined
          ? previous.skillsFolder
          : patch.skillsFolder.trim()
            ? await skillsRoot(patch.skillsFolder.trim())
            : '';
      if (patch.skillsFolder !== undefined) await discoverSkills(skillsFolder);
      const baseUrl = patch.baseUrl?.trim() ?? (provider === previous.provider ? previous.baseUrl : '');
      if (baseUrl) {
        let url: URL;
        try {
          url = new URL(baseUrl);
        } catch {
          throw new Error('Enter a valid provider endpoint.');
        }
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
          )
        )
          throw new Error('Use HTTPS, or HTTP on localhost, without endpoint credentials or query parameters.');
      }
      const helpModel = patch.helpModel === undefined ? previous.helpModel : patch.helpModel;
      if (helpModel && !helpModel.model.trim()) throw new Error('Enter a Help model.');
      const next = {
        skillsFolder,
        provider,
        model: patch.model?.trim() ?? previous.model,
        baseUrl,
        ...(helpModel === undefined
          ? {}
          : { helpModel: helpModel ? { ...helpModel, model: helpModel.model.trim() } : null }),
      };
      await this.files.write('settings.json', next);
      this.saved = next;
      const existing = this.credentials.get(provider);
      if (patch.apiKey?.trim()) this.credentials.set(provider, { apiKey: patch.apiKey.trim(), baseUrl });
      else if (existing && baseUrl !== existing.baseUrl && patch.baseUrl !== undefined)
        this.credentials.delete(provider);
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return this.describe();
  }
}
