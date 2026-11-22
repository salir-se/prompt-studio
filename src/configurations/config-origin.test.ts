// @module-tag dom
import { describe, expect, it } from 'vitest';
import { loadConfigOrigin, saveConfigOrigin } from './config-origin';

// happy-dom (default env) — config-origin persists through localStorage, like session declarations.
describe('config-origin persistence', () => {
  it('round-trips a baseline id per project and defaults to shipped', () => {
    expect(loadConfigOrigin('missing-project')).toBe('default');
    saveConfigOrigin('p1', 'job-seeker-personal-broker');
    expect(loadConfigOrigin('p1')).toBe('job-seeker-personal-broker');
  });
});
