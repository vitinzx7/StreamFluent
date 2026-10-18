import { describe, expect, it } from "vitest";
import data from "../data/word-levels.en.json";
import { BEYOND_C2, CEFR_LEVELS, isAboveLevel, wordRank } from "../core/word-levels.ts";
import { resolveWordStatus } from "../core/word-status.ts";

const rank = (level: string) => CEFR_LEVELS.indexOf(level as (typeof CEFR_LEVELS)[number]);

describe("bundled CEFR word list", () => {
  it("has thousands of single words at every level, with its sources and licence", () => {
    for (const level of CEFR_LEVELS) {
      const words = Object.values(data.entries[level]).join(" ").split(" ").filter(Boolean);
      expect(words.length).toBeGreaterThan(900);
      expect(words.every((word) => !/\s/.test(word))).toBe(true);
    }
    expect(data.sources.map((source) => source.name).join(" ")).toMatch(/CEFR-J.*Octanove/);
    expect(data.license).toContain("CC BY-SA 4.0");
  });
});

describe("level of a subtitle word", () => {
  it.each([
    ["go", "A1"], ["went", "A1"], ["gone", "A1"], ["going", "A1"],
    ["children", "A1"], ["bigger", "A1"], ["happiest", "A1"],
    ["studies", "A1"], ["stopped", "A1"], ["making", "A1"],
    ["Is", "A1"], ["was", "A1"], ["better", "A1"],
  ])("%s → %s", (word, level) => {
    expect(wordRank(word)).toBe(rank(level));
  });

  it("keeps the lowest level of homographs: 'found' is find (A1), not found (to establish)", () => {
    expect(wordRank("found")).toBe(rank("A1"));
  });

  it("reads possessives and contractions through their base", () => {
    expect(wordRank("teacher's")).toBe(wordRank("teacher"));
    expect(wordRank("you'll")).toBe(wordRank("you"));
  });

  it("knows the rarer words of the list and leaves names and unknown words alone", () => {
    expect(wordRank("ephemeral")).toBe(rank("C2"));
    expect(wordRank("Gumball")).toBeNull();
    expect(wordRank("Darwin")).toBeNull();
  });

  it("puts the bundled special words missing from the list above C2", () => {
    expect(wordRank("ameliorate")).toBe(BEYOND_C2);
  });
});

describe("lilac above the user's level", () => {
  const line = "The ambiguous answer was obvious, but ameliorate it anyway".split(/\W+/).filter(Boolean);
  const lilac = (level: Parameters<typeof isAboveLevel>[2]) => line.filter((word) => isAboveLevel(word, "en", level));

  it("shows many more words at A1 than at C2", () => {
    expect(lilac("A1").length).toBeGreaterThan(lilac("B2").length);
    expect(lilac("B2").length).toBeGreaterThanOrEqual(lilac("C2").length);
    expect(lilac("C2")).toEqual(["ameliorate"]);
  });

  it("never marks words at or below the level", () => {
    expect(lilac("A1")).not.toContain("The");
    expect(lilac("A1")).not.toContain("answer");
  });

  it("keeps the original 100 special words until a level is chosen", () => {
    expect(lilac(null)).toEqual(["ambiguous", "ameliorate"]);
  });

  it("never applies to Portuguese subtitles", () => {
    expect(isAboveLevel("ameliorate", "pt-BR", "A1")).toBe(false);
  });

  it("lets a personal mark win over lilac, and turns off with the option", () => {
    const settings = { highlightNewWords: true, highlightSpecialWords: true, level: "A2" as const };
    expect(resolveWordStatus("ambiguous", "en", null, new Set(), settings)).toBe("special");
    expect(resolveWordStatus("ambiguous", "en", "learned", new Set(), settings)).toBe("learned");
    expect(resolveWordStatus("ambiguous", "en", null, new Set(), { ...settings, highlightSpecialWords: false })).toBe("normal");
  });
});
