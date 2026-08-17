import type { SavedPhrase, StorageSchema } from "./types.ts";
import { generateId } from "./utils.ts";

const STORAGE_KEY: keyof StorageSchema = "phrases";

export const PhraseRepository = {
  async getAll(): Promise<SavedPhrase[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY];
    if (!Array.isArray(raw)) return [];
    return raw;
  },

  async getById(id: string): Promise<SavedPhrase | null> {
    const phrases = await this.getAll();
    return phrases.find((p) => p.id === id) || null;
  },

  async save(
    phrase: Omit<SavedPhrase, "id" | "createdAt">
  ): Promise<SavedPhrase> {
    const phrases = await this.getAll();

    // Avoid obvious duplicates: same sentence + same word on same platform
    const existing = phrases.find(
      (p) =>
        p.sentence === phrase.sentence &&
        p.selectedWord === phrase.selectedWord &&
        p.platform === phrase.platform
    );
    if (existing) return existing;

    const newPhrase: SavedPhrase = {
      ...phrase,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };

    phrases.push(newPhrase);
    await chrome.storage.local.set({ [STORAGE_KEY]: phrases });
    return newPhrase;
  },

  async remove(id: string): Promise<boolean> {
    const phrases = await this.getAll();
    const index = phrases.findIndex((p) => p.id === id);
    if (index === -1) return false;

    phrases.splice(index, 1);
    await chrome.storage.local.set({ [STORAGE_KEY]: phrases });
    return true;
  },

  async clear(): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  },

  async count(): Promise<number> {
    const phrases = await this.getAll();
    return phrases.length;
  },
};
