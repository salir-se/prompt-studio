import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { Label } from '@prompt-studio/ui/label';
import { Textarea } from '@prompt-studio/ui/textarea';
import { useId, useState } from 'react';
import { RUN_PROVIDERS, type RunSetup, type SkillEntry } from './contracts';

export const RUN_FIELD = 'w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';
export const PROVIDER_LABELS = {
  zai: 'Z.ai',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  'openai-compat': 'OpenAI compatible',
};

export function ModelFields({
  value,
  onChange,
  disabled,
}: {
  value: Pick<RunSetup, 'provider' | 'model'>;
  onChange: (value: Pick<RunSetup, 'provider' | 'model'>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Label className="grid gap-1.5 text-sm">
        Provider
        <select
          className={RUN_FIELD}
          value={value.provider}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, provider: event.target.value as RunSetup['provider'] })}
        >
          {RUN_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_LABELS[provider]}
            </option>
          ))}
        </select>
      </Label>
      <Label className="grid gap-1.5 text-sm">
        Model
        <Input
          value={value.model}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, model: event.target.value })}
          placeholder="Enter the provider’s model ID"
        />
      </Label>
    </div>
  );
}

export function InputValues({
  value,
  names = [],
  onChange,
  disabled,
}: {
  value: Record<string, string>;
  names?: string[];
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const [newName, setNewName] = useState('');
  const keys = [...new Set([...names, ...Object.keys(value)])];
  return (
    <fieldset className="grid min-w-0 gap-3" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Variable values</legend>
      {keys.length === 0 && (
        <p className="text-xs text-muted-foreground">No variables detected. Add one if the prompt needs it.</p>
      )}
      {keys.map((name) => (
        <Label className="grid min-w-0 gap-1 text-sm" key={name}>
          <span className="break-all font-mono">{name}</span>
          <Textarea
            rows={2}
            value={value[name] ?? ''}
            onChange={(event) => onChange({ ...value, [name]: event.target.value })}
          />
        </Label>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <Label className="grid min-w-0 flex-1 gap-1 text-xs">
          New variable name
          <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="customer_name" />
        </Label>
        <Button
          type="button"
          variant="outline"
          disabled={!newName.trim() || keys.includes(newName.trim())}
          onClick={() => {
            onChange({ ...value, [newName.trim()]: '' });
            setNewName('');
          }}
        >
          Add variable
        </Button>
      </div>
    </fieldset>
  );
}

export function SkillAttachments({
  skills,
  selected,
  onChange,
  onSettings,
}: {
  skills: SkillEntry[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onSettings: () => void;
}) {
  const [query, setQuery] = useState('');
  const id = useId();
  const visible = skills.filter((skill) =>
    `${skill.name} ${skill.description} ${skill.path}`.toLowerCase().includes(query.toLowerCase()),
  );
  const missing = selected.filter((selectedId) => !skills.some((skill) => skill.id === selectedId));
  return (
    <fieldset className="grid min-w-0 gap-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">Attached skills · {selected.length}</legend>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Search the skills folder configured in Settings
      </Label>
      <Input
        id={id}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find a skill"
      />
      {visible.length > 0 ? (
        <div className="grid max-h-56 gap-2 overflow-y-auto">
          {visible.map((skill) => (
            <Label
              className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border p-3 text-sm"
              key={skill.id}
            >
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={selected.includes(skill.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked ? [...selected, skill.id] : selected.filter((value) => value !== skill.id),
                  )
                }
              />
              <span className="min-w-0">
                <span className="block font-medium">{skill.name}</span>
                <span className="block break-words text-xs text-muted-foreground">{skill.description}</span>
                <span className="mt-1 block break-all font-mono text-[11px] text-muted-foreground">{skill.path}</span>
              </span>
            </Label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {skills.length ? 'No matching skills.' : 'No skills discovered. Choose a local skills folder in Settings.'}
        </p>
      )}
      {missing.map((selectedId) => (
        <div key={selectedId} className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 break-all">Unavailable attachment: {selectedId}</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(selected.filter((value) => value !== selectedId))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button className="justify-self-start" type="button" variant="ghost" onClick={onSettings}>
        Skills folder settings
      </Button>
    </fieldset>
  );
}
