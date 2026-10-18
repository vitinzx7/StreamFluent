import { describe, expect, it } from "vitest";
import { dictionaryLinks } from "../core/word-actions.ts";

describe("dictionary links", () => {
  it("point each site at the English → Portuguese pair", () => {
    expect(dictionaryLinks("run", "en-pt").map((link) => link.url)).toEqual([
      "https://www.linguee.com/english-portuguese/search?query=run",
      "https://www.wordreference.com/enpt/run",
      "https://context.reverso.net/traducao/ingles-portugues/run",
      "https://dictionary.cambridge.org/dictionary/english-portuguese/run",
    ]);
  });

  it("turn around for Portuguese subtitles and encode the word", () => {
    expect(dictionaryLinks("coração", "pt-en").map((link) => link.url)).toEqual([
      "https://www.linguee.com/portuguese-english/search?query=cora%C3%A7%C3%A3o",
      "https://www.wordreference.com/pten/cora%C3%A7%C3%A3o",
      "https://context.reverso.net/traducao/portugues-ingles/cora%C3%A7%C3%A3o",
      "https://dictionary.cambridge.org/dictionary/portuguese-english/cora%C3%A7%C3%A3o",
    ]);
    expect(dictionaryLinks("a/b?c", "en-pt")[1].url).toBe("https://www.wordreference.com/enpt/a%2Fb%3Fc");
  });
});
