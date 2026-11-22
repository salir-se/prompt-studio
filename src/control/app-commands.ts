/**
 * The App's control-command implementations (ADR-236; tasks #18–#20): each command is a thin,
 * PURE-ish adapter over the App's own state and handlers — the CLI/MCP path and the UI drive the
 * SAME code, so there is exactly one source of truth and one behavior.
 *
 * Extracted from App.tsx as a factory so the wiring stays a one-liner: the App passes its live
 * values/handlers, gets back the command map the channel resolves against. Argument validation
 * is strict-and-readable (JSON arrives from outside the tab) and every failure is an actionable
 * message — a CLI/MCP user sees "open the document first", never a stack.
 */

import type { CatalogRoot } from '../catalog/root-catalog';
import type { HistoryProvider, ProjectRef } from '../vcs/history-provider';
import { providerKeyFor } from '../vcs/provider-keys';
import type { ControlHandler } from './control-channel';

/** The App surface the commands need — implemented by the App with its live state/handlers. */
export interface AppCommandSurface {
  readonly roots: readonly CatalogRoot[];
  /** The currently loaded working document, if any (rootId + optional variantSymbol + text). */
  readonly loadedDocument: { readonly rootId: string; readonly variantSymbol?: string; readonly text: string } | null;
  readonly projects: readonly ProjectRef[] | null;
  readonly activeProjectId: string | null;
  readonly provider: HistoryProvider | null;
  selectRoot(rootId: string): boolean;
  selectVariant(rootId: string, variantSymbol: string): boolean;
  /** Replaces the loaded document's text through the app's transactional write path. */
  replaceLoadedText(text: string, message: string): boolean;
  resetLoadedToShipped(): boolean;
  createProject(name: string, baselineId: string): boolean;
  switchProject(projectId: string): boolean;
}

interface DocumentArgs {
  rootId?: unknown;
  variantSymbol?: unknown;
}

function readDocumentArgs(args: unknown): { rootId: string; variantSymbol?: string } {
  if (typeof args !== 'object' || args === null) {
    throw new Error('Expected { rootId: string, variantSymbol?: string }.');
  }
  const { rootId, variantSymbol } = args as DocumentArgs;
  if (typeof rootId !== 'string' || rootId.length === 0) {
    throw new Error('Expected { rootId: string, variantSymbol?: string }.');
  }
  if (variantSymbol !== undefined && typeof variantSymbol !== 'string') {
    throw new Error('variantSymbol must be a string.');
  }
  return { rootId, variantSymbol };
}

/** Builds the command map the control channel resolves against. */
export function buildAppCommands(surface: AppCommandSurface): Record<string, ControlHandler> {
  return {
    listDocuments: () =>
      surface.roots.map(({ id, title, loadability, toolNames }) => ({
        id,
        title,
        loadability,
        toolNames,
      })),

    openDocument: (args) => {
      const { rootId, variantSymbol } = readDocumentArgs(args);
      const root = surface.roots.find((candidate) => candidate.id === rootId);
      if (root === undefined) throw new Error(`Unknown document "${rootId}" — run listDocuments for ids.`);
      if (root.loadability === 'resolver-variants') {
        if (variantSymbol === undefined) {
          throw new Error(
            `"${rootId}" is variant-resolved — pass one of: ${root.variants?.map((v) => v.symbol).join(', ') ?? '(none)'}.`,
          );
        }
        if (!(root.variants ?? []).some((variant) => variant.symbol === variantSymbol)) {
          throw new Error(`Unknown variant "${variantSymbol}" for "${rootId}".`);
        }
        if (!surface.selectVariant(rootId, variantSymbol)) throw new Error('Opening the document was cancelled.');
        return { opened: rootId, variantSymbol };
      }
      if (!surface.selectRoot(rootId)) throw new Error('Opening the document was cancelled.');
      return { opened: rootId };
    },

    readDocument: (args) => {
      const { rootId, variantSymbol } = readDocumentArgs(args);
      const root = surface.roots.find((candidate) => candidate.id === rootId);
      if (root === undefined) throw new Error(`Unknown document "${rootId}" — run listDocuments for ids.`);
      // The loaded working document wins — that is what the user sees in the editor.
      const loaded = surface.loadedDocument;
      if (loaded?.rootId === rootId && loaded.variantSymbol === variantSymbol) {
        return { rootId, variantSymbol, text: loaded.text, source: 'working' };
      }
      if (root.loadability === 'constant') {
        if (root.text === undefined) throw new Error(`"${rootId}" has no readable text.`);
        return { rootId, text: root.text, source: 'shipped' };
      }
      if (root.loadability === 'resolver-variants') {
        const variant = (root.variants ?? []).find((candidate) => candidate.symbol === variantSymbol);
        if (variant === undefined) {
          throw new Error(
            `"${rootId}" is variant-resolved — pass variantSymbol one of: ${root.variants?.map((v) => v.symbol).join(', ') ?? '(none)'}.`,
          );
        }
        return { rootId, variantSymbol, text: variant.text, source: 'shipped' };
      }
      throw new Error(`"${rootId}" is not readable (${root.loadability}).`);
    },

    editDocument: (args) => {
      if (typeof args !== 'object' || args === null || typeof (args as { text?: unknown }).text !== 'string') {
        throw new Error('Expected { rootId: string, text: string, message?: string }.');
      }
      const { rootId, variantSymbol } = readDocumentArgs(args);
      const text = (args as { text: string }).text;
      const message =
        typeof (args as { message?: unknown }).message === 'string'
          ? (args as { message: string }).message
          : 'control channel edit';
      const loaded = surface.loadedDocument;
      if (loaded === null || loaded.rootId !== rootId || loaded.variantSymbol !== variantSymbol) {
        throw new Error(`Open "${rootId}" first (openDocument) — edits apply to the loaded document.`);
      }
      if (!surface.replaceLoadedText(text, message)) throw new Error('Editing the document was cancelled.');
      return { edited: rootId, variantSymbol, message };
    },

    listConfigurations: () => {
      if (surface.projects === null) throw new Error('History is still booting — try again in a moment.');
      return { activeProjectId: surface.activeProjectId, projects: surface.projects };
    },

    createConfiguration: (args) => {
      if (typeof args !== 'object' || args === null || typeof (args as { name?: unknown }).name !== 'string') {
        throw new Error('Expected { name: string, fromBaseline?: string }.');
      }
      const name = (args as { name: string }).name;
      const fromBaselineRaw = (args as { fromBaseline?: unknown }).fromBaseline;
      const fromBaseline = typeof fromBaselineRaw === 'string' ? fromBaselineRaw : 'default';
      if (!surface.createProject(name, fromBaseline)) throw new Error('Creating the configuration was cancelled.');
      return { creating: name, fromBaseline };
    },

    switchConfiguration: (args) => {
      if (
        typeof args !== 'object' ||
        args === null ||
        typeof (args as { projectId?: unknown }).projectId !== 'string'
      ) {
        throw new Error('Expected { projectId: string } — run listConfigurations for ids.');
      }
      if (!surface.switchProject((args as { projectId: string }).projectId))
        throw new Error('Switching the configuration was cancelled.');
      return { switchedTo: (args as { projectId: string }).projectId };
    },

    resetDocument: (args) => {
      const { rootId, variantSymbol } = readDocumentArgs(args);
      const loaded = surface.loadedDocument;
      if (loaded === null || loaded.rootId !== rootId || loaded.variantSymbol !== variantSymbol) {
        throw new Error(`Open "${rootId}" first (openDocument) — reset applies to the loaded document.`);
      }
      if (!surface.resetLoadedToShipped()) throw new Error('Resetting the document was cancelled.');
      return { reset: rootId };
    },

    history: async (args) => {
      if (surface.provider === null || surface.activeProjectId === null) {
        throw new Error('History is still booting — try again in a moment.');
      }
      const { rootId, variantSymbol } = readDocumentArgs(args);
      const commits = await surface.provider.history(surface.activeProjectId, providerKeyFor(rootId, variantSymbol));
      return commits.map(({ id, message, timestampMs }) => ({ id, message, timestampMs }));
    },
  };
}
