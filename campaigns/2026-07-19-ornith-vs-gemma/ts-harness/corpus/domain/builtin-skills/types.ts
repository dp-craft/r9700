export interface PromptTranslationEntry {
  readonly name: string;
  readonly prompt: string;
}

export type PromptTranslations = Readonly<Record<string, PromptTranslationEntry>>;
