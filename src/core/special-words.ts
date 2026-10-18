import data from "../data/special-words.en.json";
import { wordKey } from "./word-normalization.ts";
const keys = new Set(data.entries.map(entry => wordKey(entry.word)));
export function isSpecialWord(word: string, sourceLanguage: string): boolean {
  return sourceLanguage === "en" && keys.has(wordKey(word));
}
