/**
 * Test fixture: the neutral `examples/starter` project as a third-party manifest catalog.
 *
 * The public build ships no built-in prompt catalog, so tests that need loadable prompt roots build one
 * from the starter example through the same path a real project takes: an explicit manifest catalog whose
 * documents are `file` sources, with the file texts served by the bridge (`/__studio/file`).
 */
import { createBlankPromptDesign, type PromptDesign, parsePromptDesign } from '@prompt-studio/prompts';
import { buildRootCatalog, type CatalogRoot } from '../catalog/root-catalog';
import type { StudioManifestParsed } from '../manifest/manifest-schema';
import { workspaceFileForDesign } from '../prompt-repo/workspace-document';
import releaseNotesText from '../../examples/starter/prompts/release-notes.md?raw';
import supportTriageText from '../../examples/starter/prompts/support-triage.md?raw';

export const SUPPORT_TRIAGE_ID = 'support-triage';
export const RELEASE_NOTES_ID = 'release-notes';
export const SUPPORT_TRIAGE_PATH = 'prompts/support-triage.md';
export const RELEASE_NOTES_PATH = 'prompts/release-notes.md';

/** A prose fragment with no sections, for the editor's single "Document" card fallback. */
export const TONE_ID = 'tone';
export const TONE_PATH = 'prompts/tone.md';
export const TONE_TEXT = 'Write in a calm, friendly tone. Thank the customer once, then get to the point.\n';

/** A document whose text comes from a code symbol the bridge cannot resolve: listed, but not openable. */
export const UNREADABLE_ID = 'unreadable';

export { releaseNotesText as RELEASE_NOTES_TEXT, supportTriageText as SUPPORT_TRIAGE_TEXT };

/**
 * The starter project's manifest: its two file-sourced prompts plus a prose fragment, and one symbol-sourced document
 * no bridge can read (it stays listed but disabled).
 */
export const STARTER_MANIFEST: StudioManifestParsed = {
  schemaVersion: 1,
  name: 'starter',
  contentRoots: ['prompts', 'skills'],
  skillsRoot: 'skills',
  exportRoot: 'prompts',
  catalog: {
    source: 'explicit',
    documents: [
      { id: SUPPORT_TRIAGE_ID, title: 'Support Triage', source: { kind: 'file', path: SUPPORT_TRIAGE_PATH } },
      { id: RELEASE_NOTES_ID, title: 'Release Notes', source: { kind: 'file', path: RELEASE_NOTES_PATH } },
      { id: TONE_ID, title: 'Tone', group: 'fragments', source: { kind: 'file', path: TONE_PATH } },
      {
        id: UNREADABLE_ID,
        title: 'Unreadable',
        source: { kind: 'symbol', module: 'src/unreadable.ts', symbol: 'UNREADABLE_PROMPT' },
      },
    ],
  },
  baselines: [
    {
      id: 'repository',
      label: 'Your prompts',
      description: 'The prompts in this repository.',
      positioning: 'shipped',
      source: { kind: 'shipped' },
    },
  ],
} as StudioManifestParsed;

const blankSupportTriage = createBlankPromptDesign({ id: SUPPORT_TRIAGE_ID, title: 'Support Triage' }).design;

/**
 * The versioned design saved with the Support Triage prompt: its Mission section carries one platform principle
 * for AI review, its Customer Message section requires `{{customer_message}}`, and a whole-prompt profile flags
 * any placeholder other than the example's two. It declares no runtime variables,
 * so a pristine document verifies with no findings (a runtime variable always raises a prompt-cache warning).
 */
export const SUPPORT_TRIAGE_DESIGN: PromptDesign = parsePromptDesign(
  JSON.stringify({
    ...blankSupportTriage,
    input: { kind: 'free-text', description: 'One customer message.' },
    output: { kind: 'freeform', description: 'One JSON object with category, urgency and next_step.' },
    variables: [],
    verificationProfiles: [
      ...blankSupportTriage.verificationProfiles
        .filter((profile) => profile.scope === 'section')
        .map((profile) => ({
          ...profile,
          principles: [
            {
              id: `${SUPPORT_TRIAGE_ID}.mission.no-promises`,
              version: 1,
              owner: 'platform',
              statement: 'The assistant never promises refunds, dates, or fixes.',
              severity: 'error',
              allowedCustomization: 'Wording may change; the no-promises rule may not.',
              sectionIds: [`${SUPPORT_TRIAGE_ID}.mission`],
            },
          ],
        })),
      {
        id: `${SUPPORT_TRIAGE_ID}.customer_message.verification`,
        version: 1,
        scope: 'section',
        sectionId: `${SUPPORT_TRIAGE_ID}.customer_message`,
        deterministicRules: [
          {
            id: 'required-placeholder:customer_message',
            kind: 'required-placeholder',
            name: 'customer_message',
            severity: 'warning',
            enforcement: 'edit',
          },
        ],
        principles: [],
      },
      {
        id: `${SUPPORT_TRIAGE_ID}.consolidated.verification`,
        version: 1,
        scope: 'consolidated',
        deterministicRules: [
          { id: 'non-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' },
          {
            id: 'known-placeholder',
            kind: 'known-placeholder',
            allowedNames: ['company_name', 'customer_message'],
            severity: 'warning',
            enforcement: 'edit',
          },
        ],
        principles: [],
      },
    ],
  }),
);

/** `prompts/support-triage.md` as Prompt Studio saves it: the example text followed by its design marker. */
export const SUPPORT_TRIAGE_FILE_TEXT = workspaceFileForDesign(
  SUPPORT_TRIAGE_DESIGN,
  supportTriageText,
  'Default',
).text;

/** The texts the bridge serves for the starter manifest's file sources, keyed by path. */
export const STARTER_FILE_TEXTS: ReadonlyMap<string, string> = new Map([
  [SUPPORT_TRIAGE_PATH, SUPPORT_TRIAGE_FILE_TEXT],
  [RELEASE_NOTES_PATH, releaseNotesText],
  [TONE_PATH, TONE_TEXT],
]);

/** The root catalog the App builds once the starter manifest and its file texts arrived. */
export function starterCatalog(): readonly CatalogRoot[] {
  return buildRootCatalog(undefined, STARTER_MANIFEST, STARTER_FILE_TEXTS);
}

/** The loaded Support Triage root (a `constant` root with the example's text). */
export function supportTriageRoot(): CatalogRoot {
  const root = starterCatalog().find((candidate) => candidate.id === SUPPORT_TRIAGE_ID);
  if (!root) throw new Error('Fixture setup failed: the starter catalog has no support-triage root.');
  return root;
}
