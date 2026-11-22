// @module-tag pure
import { describe, expect, it } from 'vitest';
import { LanguageCodeSchema, LanguageObservationSchema, RecordContactLanguageArgsSchema } from './outreach-language';

describe('language evidence boundaries', () => {
  it('accepts language tags, bounded observations and forbids machine confirmation fields', () => {
    // Given / When: a tool or stored observation crosses a typed language boundary.
    const observation = {
      detectedLanguage: 'ru',
      languageConfidence: 0.8,
      source: 'researcher',
      sourceText: 'Мой текст',
      sourceReference: 'https://example.test/person',
      observedAt: '2026-10-22T10:00:00.000Z',
    };
    const args = {
      lead_id: 'lead',
      detected_language: 'ru',
      language_confidence: 0.95,
      source_text: 'Мой текст',
      source_url: 'https://example.test/person',
    };
    // Then: invalid language/confidence and a forged member preference are refused.
    expect(LanguageCodeSchema.allows('en-US')).toBe(true);
    expect(LanguageCodeSchema.allows('Russia')).toBe(false);
    expect(LanguageObservationSchema.allows(observation)).toBe(true);
    expect(LanguageObservationSchema.allows({ ...observation, languageConfidence: 1.1 })).toBe(false);
    expect(RecordContactLanguageArgsSchema.allows(args)).toBe(true);
    expect(RecordContactLanguageArgsSchema.allows({ ...args, confirmedBy: 'member' })).toBe(false);
  });
});
