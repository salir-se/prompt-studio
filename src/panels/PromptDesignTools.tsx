import { useState } from 'react';

export function PromptDesignTools({ tools, onChange }: { tools: string[]; onChange: (tools: string[]) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="text-xs font-medium">
      Available tools
      <input
        aria-label="Available tools"
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
        value={draft ?? tools.join(', ')}
        onBlur={() => setDraft(null)}
        placeholder="search_accounts, save_account"
        onChange={(event) => {
          // Keep unfinished separators visible while the design stores normalized names.
          setDraft(event.target.value);
          onChange(
            event.target.value
              .split(',')
              .map((tool) => tool.trim())
              .filter(Boolean),
          );
        }}
      />
    </label>
  );
}
