// @module-tag dom
import { describe, expect, it } from 'vitest';
import { type Announcement, selectAnnouncements } from './announcements';

const NOW = new Date('2026-06-08T00:00:00Z');
const PAST = '2026-01-01T00:00:00Z';
const FUTURE = '2027-01-01T00:00:00Z';

const make = (over: Partial<Announcement> & Pick<Announcement, 'id'>): Announcement => ({
  title: 't',
  body: 'b',
  ...over,
});

describe('selectAnnouncements', () => {
  it('keeps ungated, page-agnostic, in-window announcements', () => {
    const list = [make({ id: 'a' })];
    expect(selectAnnouncements(list, { now: NOW }).map((a) => a.id)).toEqual(['a']);
  });

  it('drops announcements outside the date window', () => {
    const list = [
      make({ id: 'future', startsAt: FUTURE }),
      make({ id: 'ended', endsAt: PAST }),
      make({ id: 'live', startsAt: PAST, endsAt: FUTURE }),
    ];
    expect(selectAnnouncements(list, { now: NOW }).map((a) => a.id)).toEqual(['live']);
  });

  it('scopes by pageKeys', () => {
    const list = [make({ id: 'scout-only', pageKeys: ['Scout'] }), make({ id: 'global' })];
    expect(selectAnnouncements(list, { now: NOW, pageKey: 'Scout' }).map((a) => a.id)).toEqual([
      'scout-only',
      'global',
    ]);
    expect(selectAnnouncements(list, { now: NOW, pageKey: 'Outreach' }).map((a) => a.id)).toEqual(['global']);
    // No current page → page-scoped announcements are hidden.
    expect(selectAnnouncements(list, { now: NOW }).map((a) => a.id)).toEqual(['global']);
  });

  it('gates by feature flag', () => {
    const list = [make({ id: 'beta', flag: 'whats-new-beta' })];
    expect(selectAnnouncements(list, { now: NOW })).toHaveLength(0);
    expect(selectAnnouncements(list, { now: NOW, flagEnabled: (f) => f === 'whats-new-beta' })).toHaveLength(1);
  });
});
