import type { SavedPhrase, SavedPhraseInput } from "./types.ts";
import { requestStudy } from "./study-messages.ts";
import { normalizePhrases } from "./study-data.ts";

export interface PhraseSaveResult { phrase: SavedPhrase; duplicate: boolean }

/** The service worker owns every write, including removal and clearing. */
export const PhraseRepository = {
  async getAll(): Promise<SavedPhrase[]> {
    const result = await requestStudy<{ phrases: SavedPhrase[] }>("read");
    return normalizePhrases(result.data.phrases);
  },

  async getById(id: string): Promise<SavedPhrase | null> {
    return (await this.getAll()).find((phrase) => phrase.id === id) ?? null;
  },

  async saveResult(phrase: SavedPhraseInput): Promise<PhraseSaveResult> {
    return (await requestStudy<PhraseSaveResult>("save-phrase", { phrase })).data;
  },

  async save(phrase: SavedPhraseInput): Promise<SavedPhrase> {
    return (await this.saveResult(phrase)).phrase;
  },

  async remove(id: string): Promise<boolean> {
    return (await requestStudy<{ removed: boolean }>("remove-phrase", { id })).data.removed;
  },

  async clear(): Promise<void> {
    await requestStudy("clear-phrases");
  },

  async count(): Promise<number> {
    return (await this.getAll()).length;
  },
};
