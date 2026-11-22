// @module-tag dom
import { describe, expect, it, vi } from 'vitest';
import { isSkillDocumentId, loadSkillCatalogRoots } from './skill-catalog';

/**
 * Skill-document loading through the bridge (ADR-235, expectation 5): directory listing + per-skill
 * SKILL.md fetch, degrade-to-empty on every failure shape, and never a throw. Fetch is stubbed via
 * `vi.stubGlobal` (the network-guard-sanctioned pattern) and the studio token via a real meta tag.
 */

function mountStudioToken(): HTMLElement {
  const token = document.createElement('meta');
  token.setAttribute('name', 'studio-token');
  token.setAttribute('content', 'test-token');
  document.head.appendChild(token);
  return token;
}

function stubBridge(entries: Array<{ name: string; type: string }>, files: Record<string, string>): void {
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/__studio/list')) {
      return { ok: true, json: async () => ({ ok: true, entries }) } as unknown as Response;
    }
    if (url.includes('/__studio/file')) {
      const path = new URL(url, 'http://localhost').searchParams.get('path') ?? '';
      if (path in files) {
        return { ok: true, json: async () => ({ ok: true, text: files[path] }) } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response;
    }
    return { ok: false, status: 404 } as unknown as Response;
  }) as unknown as typeof fetch);
}

describe('loadSkillCatalogRoots', () => {
  it('loads every skill directory as a constant catalog root', async () => {
    const token = mountStudioToken();
    stubBridge(
      [
        { name: 'sales-scout', type: 'dir' },
        { name: 'sales-humanizer', type: 'dir' },
        { name: 'README.md', type: 'file' }, // files in the skills root are not skills
      ],
      {
        'packages/skills/skills/sales-scout/SKILL.md': '# Sales Scout\nbody',
        'packages/skills/skills/sales-humanizer/SKILL.md': '# Sales Humanizer\nbody',
      },
    );

    try {
      const roots = await loadSkillCatalogRoots();
      expect(roots.map((root) => root.id)).toEqual(['skill-sales-humanizer', 'skill-sales-scout']);
      expect(roots[0]).toMatchObject({
        title: 'Skill: sales-humanizer',
        loadability: 'constant',
        status: 'live',
        text: '# Sales Humanizer\nbody',
        protectedSkills: ['sales-humanizer'],
      });
      // Inventory-shaped entry keeps every entry.* consumer working.
      expect(roots[0].entry.editableKeys).toEqual([]);
      expect(roots[0].entry.protectedSkills).toEqual(['sales-humanizer']);
    } finally {
      vi.unstubAllGlobals();
      token.remove();
    }
  });

  it('skips skills whose SKILL.md the bridge cannot supply', async () => {
    const token = mountStudioToken();
    stubBridge(
      [
        { name: 'present', type: 'dir' },
        { name: 'absent', type: 'dir' },
      ],
      { 'packages/skills/skills/present/SKILL.md': 'body' },
    );

    try {
      const roots = await loadSkillCatalogRoots();
      expect(roots.map((root) => root.id)).toEqual(['skill-present']);
    } finally {
      vi.unstubAllGlobals();
      token.remove();
    }
  });

  it('degrades to empty when no bridge is reachable — never throws', async () => {
    vi.stubGlobal('fetch', (async () => ({ ok: false, status: 503 }) as unknown as Response) as typeof fetch);
    try {
      expect(await loadSkillCatalogRoots()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('isSkillDocumentId', () => {
  it('recognizes the skill- prefix namespace', () => {
    expect(isSkillDocumentId('skill-sales-scout')).toBe(true);
    expect(isSkillDocumentId('scout')).toBe(false);
  });
});
