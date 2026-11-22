/**
 * Test fixture: variable documentation a host application could register for its own prompt keys
 * (`PROMPT_VARIABLE_DOCS` in `@prompt-studio/prompts`, empty in the public build). Two neutral prompt keys share
 * `company_name`, and `change_list` is optional, so the flattening rules have something to merge and default.
 */
import type { PromptKeyVariableDocs } from '@prompt-studio/prompts';

export const HOST_VARIABLE_DOCS: Readonly<Record<string, PromptKeyVariableDocs>> = {
  'support-triage': {
    promptKey: 'support-triage',
    supportsPlaceholders: true,
    variables: [
      { key: 'company_name', label: 'The company whose support team uses the prompt', sample: 'Example Co' },
      { key: 'customer_message', label: 'The customer message to classify', sample: 'I was charged twice.' },
    ],
  },
  'release-notes': {
    promptKey: 'release-notes',
    supportsPlaceholders: true,
    variables: [
      { key: 'company_name', label: 'The company that ships the product', sample: 'Example Co' },
      { key: 'product_name', label: 'The product the notes describe', sample: 'Example App' },
      { key: 'change_list', label: 'The merged changes, one per line', sample: '- Faster sign-in', required: false },
    ],
  },
};
