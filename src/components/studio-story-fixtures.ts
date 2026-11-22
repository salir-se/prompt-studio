import { parsePromptTree } from '@prompt-studio/prompts';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import { createWorkspacePrompt } from '../prompt-repo/workspace-document';

const authored = createWorkspacePrompt({
  id: 'document-extraction',
  title: 'Document extraction',
  configuration: 'Research toolkit',
  tool: '',
  variable: 'document',
});
export const STORY_ROOT = authoredPromptRootsFromHeads(
  new Map([
    [authored.design.id, authored.text],
    [promptDesignProviderKey(authored.design.id), serializePromptDesign(authored.design)],
  ]),
).roots[0];
export const STORY_TEXT =
  '<mission>\nExtract the requested facts from {{document}}.\n<evidence>\nSupport each fact with an exact quotation. Leave missing values empty.\n</evidence>\n</mission>\n\n<output>\nReturn JSON with facts, quotations, and missing fields.\n</output>\n';
export const STORY_TREE = parsePromptTree({ key: 'document-extraction', text: STORY_TEXT, toolNames: [] });
