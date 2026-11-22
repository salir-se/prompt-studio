import { type } from 'arktype';
import { lazyType } from '../lazy-type';

/** BCP-47 language tags; never country codes or a jurisdiction inference. */
export function isLanguageCode(value: string) {
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}
export const LanguageCodeSchema = lazyType(() => type('string').narrow(isLanguageCode));
export const OutreachLanguageSourceSchema = lazyType(() =>
  type("'member_preference' | 'explicit_request' | 'conversation' | 'inbound' | 'researcher' | 'workspace_default'"),
);
export const LanguagePreferenceSchema = lazyType(() =>
  type({
    language: LanguageCodeSchema,
    confirmedBy: 'string > 0',
    confirmedAt: 'string.date.iso',
    '+': 'reject',
  }),
);
export const LanguageObservationSchema = lazyType(() =>
  type({
    detectedLanguage: LanguageCodeSchema,
    'languageConfidence?': '0 <= number <= 1',
    source: "'explicit_request' | 'inbound' | 'researcher'",
    sourceText: 'string > 0',
    sourceReference: 'string > 0',
    observedAt: 'string.date.iso',
    '+': 'reject',
  }),
);
/** Critic Inbound proposes languages from only the prospect's new text. Provenance is attached by persistence. */
export const InboundLanguageSchema = lazyType(() =>
  type({
    detectedLanguage: LanguageCodeSchema,
    languageConfidence: '0 <= number <= 1',
    sourceText: 'string > 0',
    'requestedLanguage?': LanguageCodeSchema,
    '+': 'reject',
  }),
);
export const LanguageReviewSchema = lazyType(() =>
  type({
    detectedLanguage: LanguageCodeSchema,
    languageConfidence: '0 <= number <= 1',
    '+': 'reject',
  }),
);
export type LanguageObservation = typeof LanguageObservationSchema.infer;
export type LanguagePreference = typeof LanguagePreferenceSchema.infer;
export type OutreachLanguageSource = typeof OutreachLanguageSourceSchema.infer;

export const RecordContactLanguageArgsSchema = lazyType(() =>
  type({
    lead_id: 'string > 0',
    detected_language: LanguageCodeSchema,
    language_confidence: '0 <= number <= 1',
    source_text: 'string > 0',
    source_url: type('string.url').narrow((url) => /^https?:\/\//.test(url)),
    '+': 'reject',
  }),
);
