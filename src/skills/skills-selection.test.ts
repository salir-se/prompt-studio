// @module-tag dom
import { describe, expect, it } from 'vitest';
import { agentForRootId, loadSkillsOverride, saveSkillsOverride, toggleSkill } from './skills-selection';

describe('skills-selection persistence', () => {
  it('round-trips an override and treats absent/malformed data as no override', () => {
    expect(loadSkillsOverride('missing')).toEqual({});
    saveSkillsOverride('p1', { closer: ['sales-humanizer'] });
    expect(loadSkillsOverride('p1')).toEqual({ closer: ['sales-humanizer'] });
  });

  it('drops malformed entries rather than failing the load', () => {
    localStorage.setItem('prompt-studio:skills:v1:bad', JSON.stringify({ closer: 'not-an-array', scout: 3 }));
    expect(loadSkillsOverride('bad')).toEqual({});
  });
});

describe('toggleSkill', () => {
  it('adds and removes immutably', () => {
    const base = { closer: ['sales-humanizer'] as readonly string[] };
    const added = toggleSkill(base, 'closer', 'brilliant-communication');
    expect(added).toEqual({ closer: ['sales-humanizer', 'brilliant-communication'] });
    expect(base).toEqual({ closer: ['sales-humanizer'] }); // untouched
    expect(toggleSkill(added, 'closer', 'sales-humanizer')).toEqual({ closer: ['brilliant-communication'] });
  });

  it('creates a list for an agent with no entry', () => {
    expect(toggleSkill({}, 'scout', 'sales-scout')).toEqual({ scout: ['sales-scout'] });
  });
});

describe('agentForRootId', () => {
  it('maps the communication roots and returns none for fragments/skills', () => {
    expect(agentForRootId('scout')).toBe('scout');
    expect(agentForRootId('closer')).toBe('closer');
    expect(agentForRootId('critic-inbound')).toBe('critic');
    expect(agentForRootId('critic-outbound-agent-loop')).toBe('critic');
    expect(agentForRootId('assistant')).toBe('assistant');
    expect(agentForRootId('icp')).toBe('');
    expect(agentForRootId('skill-sales-scout')).toBe('');
  });
});
