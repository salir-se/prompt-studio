import type { PromptVerificationProfile } from '@prompt-studio/prompts';

export interface CanonicalPromptSection {
  readonly id: string;
  readonly tag: string;
  readonly nodeId?: string;
  readonly heading: string;
  readonly profileId: string;
  readonly parentId?: string;
}

export interface CanonicalPromptRoot {
  readonly id: string;
  readonly text: string;
  readonly toolNames: readonly string[];
  readonly sections: readonly CanonicalPromptSection[];
  readonly profiles: readonly PromptVerificationProfile[];
}

export interface CanonicalPromptSource {
  getRoot(id: string): CanonicalPromptRoot | null;
}
