import { describe, expect, it } from "vitest";
import { createDemoColors } from "../core/demo-colors.ts";

// Ranks from the bundled list: victim, detective (B1) are above A2; police, murder, evidence (A2) are not.
const A2 = { highlightNewWords: true, highlightSpecialWords: true, level: "A2" as const };

describe("demo colours", () => {
  it("colours one word per line at most, with white lines in between, blue and lilac taking turns", () => {
    const demo = createDemoColors(2);
    let id = 0;
    const pick = (text: string) => demo.pick(String(++id), text, "en", A2);

    expect(pick("The police found the victim.")).toEqual({ key: "victim", status: "special" });
    expect(pick("Patrick is a nice man.")).toBeNull();
    expect(pick("The killer has a garden.")).toBeNull();
    expect(pick("This murder is about family.")).toEqual({ key: "murder", status: "new" });
    expect(pick("Where were you?")).toBeNull();
    expect(pick("At home, I think.")).toBeNull();
    expect(pick("A detective with evidence.")).toEqual({ key: "detective", status: "special" });
  });

  it("picks the hardest new word, never a name or a short word", () => {
    const demo = createDemoColors(0);

    expect(demo.pick("1", "Patrick Jane is a psychic.", "en", A2)).toBeNull();
    expect(demo.pick("2", "The house of the police.", "en", A2)).toEqual({ key: "police", status: "new" });
  });

  it("makes a word blue only the first time it appears in this take", () => {
    const demo = createDemoColors(0);

    expect(demo.pick("1", "The police are here.", "en", A2)).toEqual({ key: "police", status: "new" });
    expect(demo.pick("2", "The police.", "en", A2)).toBeNull();
    // A new take (page load) starts over.
    expect(createDemoColors(0).pick("1", "The police.", "en", A2)).toEqual({ key: "police", status: "new" });
  });

  it("keeps the same answer for the same occurrence, without spending the turn again", () => {
    const demo = createDemoColors(1);

    const first = demo.pick("1", "The victim.", "en", A2);
    expect(demo.pick("1", "The victim.", "en", A2)).toBe(first);
    expect(demo.pick("2", "Another victim.", "en", A2)).toBeNull();
    expect(demo.pick("3", "Victim.", "en", A2)).toEqual({ key: "victim", status: "special" });
  });

  it("follows the colour switches", () => {
    const noLilac = createDemoColors(0);
    // Without lilac, "victim" is just the hardest new word.
    expect(noLilac.pick("1", "The police found the victim.", "en", { ...A2, highlightSpecialWords: false })).toEqual({ key: "victim", status: "new" });

    const noBlue = createDemoColors(0);
    expect(noBlue.pick("1", "The police were there.", "en", { ...A2, highlightNewWords: false })).toBeNull();
  });
});
