// @module-tag dom
import { describe, expect, it, vi } from 'vitest';
import type { CatalogRoot } from '../catalog/root-catalog';
import type { HistoryProvider, ProjectRef } from '../vcs/history-provider';
import { type AppCommandSurface, buildAppCommands } from './app-commands';

/**
 * The control command layer's observable contract (ADR-236): commands are thin adapters over the
 * App surface — strict, readable argument errors; the loaded working document wins over shipped
 * text; edits/resets require the document to be open; history flows through the provider's
 * composite keys. The surface here is a plain fake — the App-level wiring is covered by App tests.
 */

const ROOTS: readonly CatalogRoot[] = [
  {
    id: 'scout',
    title: 'Scout',
    loadability: 'constant',
    status: 'live',
    text: 'Scout shipped.',
    toolNames: ['web_search'],
    protectedSkills: [],
    ownerLabel: 'SCOUT_PROMPT',
    entry: {} as never,
  },
  {
    id: 'critic-outbound-agent-loop',
    title: 'Critic',
    loadability: 'resolver-variants',
    status: 'live',
    variants: [{ symbol: 'CRITIC_PROMPT', text: 'Critic shipped.' }],
    toolNames: [],
    protectedSkills: [],
    ownerLabel: '<resolver>',
    entry: {} as never,
  },
];

function makeSurface(overrides: Partial<AppCommandSurface> = {}): AppCommandSurface {
  return {
    roots: ROOTS,
    loadedDocument: null,
    projects: [{ id: 'default', name: 'Default' }] as readonly ProjectRef[],
    activeProjectId: 'default',
    provider: {
      history: vi.fn(async () => [{ id: 'c1', message: 'baseline', timestampMs: 1 }]),
    } as unknown as HistoryProvider,
    selectRoot: vi.fn(() => true),
    selectVariant: vi.fn(() => true),
    replaceLoadedText: vi.fn(() => true),
    resetLoadedToShipped: vi.fn(() => true),
    createProject: vi.fn(() => true),
    switchProject: vi.fn(() => true),
    ...overrides,
  };
}

describe('listDocuments', () => {
  it('projects id/title/loadability/toolNames for every root', () => {
    const commands = buildAppCommands(makeSurface());
    expect(commands.listDocuments?.(undefined)).toEqual([
      { id: 'scout', title: 'Scout', loadability: 'constant', toolNames: ['web_search'] },
      { id: 'critic-outbound-agent-loop', title: 'Critic', loadability: 'resolver-variants', toolNames: [] },
    ]);
  });
});

describe('openDocument', () => {
  it('rejects an unknown id actionably and demands the variant symbol when required', () => {
    const commands = buildAppCommands(makeSurface());
    expect(() => commands.openDocument?.({ rootId: 'nope' })).toThrow('listDocuments');
    expect(() => commands.openDocument?.({ rootId: 'critic-outbound-agent-loop' })).toThrow('CRITIC_PROMPT');
  });

  it('opens a constant directly and a variant through selectVariant', () => {
    const surface = makeSurface();
    const commands = buildAppCommands(surface);
    expect(commands.openDocument?.({ rootId: 'scout' })).toEqual({ opened: 'scout' });
    expect(surface.selectRoot).toHaveBeenCalledWith('scout');
    expect(commands.openDocument?.({ rootId: 'critic-outbound-agent-loop', variantSymbol: 'CRITIC_PROMPT' })).toEqual({
      opened: 'critic-outbound-agent-loop',
      variantSymbol: 'CRITIC_PROMPT',
    });
    expect(surface.selectVariant).toHaveBeenCalledWith('critic-outbound-agent-loop', 'CRITIC_PROMPT');
  });

  it('reports a declined variant switch instead of claiming that it opened', () => {
    const commands = buildAppCommands(makeSurface({ selectVariant: () => false }));
    expect(() =>
      commands.openDocument?.({ rootId: 'critic-outbound-agent-loop', variantSymbol: 'CRITIC_PROMPT' }),
    ).toThrow('cancelled');
  });
});

describe('readDocument', () => {
  it('prefers the loaded working document — what the user sees is what the client gets', () => {
    const commands = buildAppCommands(makeSurface({ loadedDocument: { rootId: 'scout', text: 'Scout WORKING.' } }));
    expect(commands.readDocument?.({ rootId: 'scout' })).toEqual({
      rootId: 'scout',
      text: 'Scout WORKING.',
      source: 'working',
    });
  });

  it('falls back to shipped text, including variant-resolved documents', async () => {
    const commands = buildAppCommands(makeSurface());
    expect(commands.readDocument?.({ rootId: 'scout' })).toEqual({
      rootId: 'scout',
      text: 'Scout shipped.',
      source: 'shipped',
    });
    expect(commands.readDocument?.({ rootId: 'critic-outbound-agent-loop', variantSymbol: 'CRITIC_PROMPT' })).toEqual({
      rootId: 'critic-outbound-agent-loop',
      variantSymbol: 'CRITIC_PROMPT',
      text: 'Critic shipped.',
      source: 'shipped',
    });
  });
});

describe('editDocument / resetDocument', () => {
  it('require the document to be open — the actionable error names the prerequisite', () => {
    const commands = buildAppCommands(makeSurface());
    expect(() => commands.editDocument?.({ rootId: 'scout', text: 'x' })).toThrow('Open "scout" first');
    expect(() => commands.resetDocument?.({ rootId: 'scout' })).toThrow('Open "scout" first');
  });

  it('route an open document through the app write path with the given message', () => {
    const surface = makeSurface({ loadedDocument: { rootId: 'scout', text: 'old' } });
    const commands = buildAppCommands(surface);
    expect(commands.editDocument?.({ rootId: 'scout', text: 'new text', message: 'cli tweak' })).toEqual({
      edited: 'scout',
      message: 'cli tweak',
      variantSymbol: undefined,
    });
    expect(surface.replaceLoadedText).toHaveBeenCalledWith('new text', 'cli tweak');
    expect(commands.resetDocument?.({ rootId: 'scout' })).toEqual({ reset: 'scout' });
    expect(surface.resetLoadedToShipped).toHaveBeenCalled();
  });
});

describe('configurations + history', () => {
  it('lists configurations with the active one; create/switch route through the app handlers', () => {
    const surface = makeSurface();
    const commands = buildAppCommands(surface);
    expect(commands.listConfigurations?.(undefined)).toEqual({
      activeProjectId: 'default',
      projects: [{ id: 'default', name: 'Default' }],
    });
    expect(commands.createConfiguration?.({ name: 'Trial', fromBaseline: 'job-seeker-personal-broker' })).toEqual({
      creating: 'Trial',
      fromBaseline: 'job-seeker-personal-broker',
    });
    expect(surface.createProject).toHaveBeenCalledWith('Trial', 'job-seeker-personal-broker');
    expect(commands.switchConfiguration?.({ projectId: 'default' })).toEqual({ switchedTo: 'default' });
    expect(surface.switchProject).toHaveBeenCalledWith('default');
  });

  it('history awaits the provider and projects the commit fields', async () => {
    const surface = makeSurface();
    const commands = buildAppCommands(surface);
    await expect(
      commands.history?.({ rootId: 'critic-outbound-agent-loop', variantSymbol: 'CRITIC_PROMPT' }),
    ).resolves.toEqual([{ id: 'c1', message: 'baseline', timestampMs: 1 }]);
    // Composite key — variants have their own history lanes (ADR-235).
    expect(surface.provider?.history).toHaveBeenCalledWith('default', 'critic-outbound-agent-loop@CRITIC_PROMPT');
  });

  it('reports a still-booting history layer instead of crashing', async () => {
    const commands = buildAppCommands(makeSurface({ provider: null, projects: null, activeProjectId: null }));
    expect(() => commands.listConfigurations?.(undefined)).toThrow('booting');
    await expect(commands.history?.({ rootId: 'scout' })).rejects.toThrow('booting');
  });
});
