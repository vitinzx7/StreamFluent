import { describe, expect, it } from "vitest";
import data from "../data/special-words.en.json";
import { isSpecialWord } from "../core/special-words.ts";
import { resolveWordStatus } from "../core/word-status.ts";
import { wordKey, tokenizeWords } from "../core/word-normalization.ts";
describe("bundled special vocabulary", () => {
  it("contains exactly the 100 normalized unique English words with source URLs", () => {
    expect(data.language).toBe("en"); expect(data.entries).toHaveLength(100);
    expect(new Set(data.entries.map(entry => entry.word)).size).toBe(100);
    for (const entry of data.entries) {
      expect(entry.word).toBe(wordKey(entry.word));
      expect(new URL(entry.oxfordUrl).hostname).toBe("www.oxfordlearnersdictionaries.com");
      expect(isSpecialWord(entry.word.toUpperCase() + ",", "en")).toBe(true);
      expect(isSpecialWord(entry.word, "pt-BR")).toBe(false);
    }
    expect(isSpecialWord("ephemerally", "en")).toBe(false);
  });
  it("resolves personal > special > first occurrence > normal without mutating history", () => {
    const fresh = new Set(["ephemeral"]), on = { highlightNewWords: true, highlightSpecialWords: true };
    expect(resolveWordStatus("EPHEMERAL,", "en", null, fresh, on)).toBe("special");
    for (const mark of ["learned", "difficult"] as const) expect(resolveWordStatus("ephemeral", "en", mark, fresh, on)).toBe(mark);
    expect(resolveWordStatus("ephemeral", "pt-BR", null, fresh, on)).toBe("new");
    expect(resolveWordStatus("ephemeral", "en", null, fresh, { ...on, highlightSpecialWords: false })).toBe("new");
    expect(resolveWordStatus("ephemeral", "en", null, new Set(), { ...on, highlightSpecialWords: false })).toBe("normal");
    expect(resolveWordStatus("ephemeral", "en", null, fresh, { ...on, highlightNewWords: false })).toBe("special");
    expect([...fresh]).toEqual(["ephemeral"]);
  });
  it("tokenizes losslessly with Unicode, contractions, hyphens and separate punctuation", () => {
    const text = "  Don’t—don't well-known!\nCoração, ...";
    const tokens = tokenizeWords(text);
    expect(tokens.map(token => token.text).join("")).toBe(text);
    expect(tokens.filter(token => token.key).map(token => token.key)).toEqual(["don't", "don't", "well-known", "coração"]);
  });
});
