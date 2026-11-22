// @module-tag dom
import { describe, expect, it, vi } from 'vitest';
import { m, t } from './text';

describe('t', () => {
  it('falls back to the key', () => {
    expect(t('common.save')).toBe('common.save');
  });

  it('uses the English default', () => {
    expect(t('common.save', { defaultValue: 'Save' })).toBe('Save');
  });

  it('interpolates values including false and zero', () => {
    expect(
      t('status.summary', {
        defaultValue: 'Enabled: {{enabled}}; remaining: {{remaining}}',
        enabled: false,
        remaining: 0,
      }),
    ).toBe('Enabled: false; remaining: 0');
  });

  it('leaves unmatched and null values unchanged', () => {
    expect(t('welcome.user', { defaultValue: 'Hello {{name}} {{missing}}', name: null })).toBe(
      'Hello {{name}} {{missing}}',
    );
  });

  it('selects the English singular or plural default', () => {
    const defaults = {
      defaultValue: 'Items',
      defaultValue_one: 'One item',
      defaultValue_other: '{{count}} items',
    };

    expect(t('items.count', { ...defaults, count: 1 })).toBe('One item');
    expect(t('items.count', { ...defaults, count: 2 })).toBe('2 items');
  });
});

describe('m', () => {
  it('translates a reusable message descriptor', () => {
    expect(m({ key: 'welcome.user', defaultValue: 'Hello {{name}}' }, { name: 'Ada' })).toBe('Hello Ada');
  });

  // Regression: a data-indexed lookup (`m(LABELS[value])`) that misses used to
  // throw "Cannot read properties of undefined (reading 'key')" and take the
  // whole SPA down via the ErrorBoundary. A missing copy entry must degrade to
  // an empty string (and complain loudly), never crash the render tree.
  it('degrades to an empty string instead of throwing when the message is missing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(m(undefined as unknown as Parameters<typeof m>[0])).toBe('');
      expect(errorSpy).toHaveBeenCalledOnce();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
