import { describe, expect, it } from "vitest";
import { createStudyContext, sentencePhrase, wordContext, type StudySnapshot } from "../core/study-context.ts";

function line(occurrenceId: string, text: string, overrides: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    sessionId: "s",
    sourceId: "dom",
    cueId: text,
    occurrenceId,
    text,
    direction: "en-pt",
    start: 12,
    platform: "Netflix",
    mediaTitle: "Show",
    season: 1,
    episode: 2,
    freshKeys: new Set(),
    ...overrides,
  };
}

describe("study context", () => {
  it("studies the retained line, else the held one, else the live one", () => {
    const context = createStudyContext();
    context.setLive(line("1", "First"));
    expect(context.study?.text).toBe("First");

    context.hold(line("1", "First"));
    context.setLive(line("2", "Second"));
    expect(context.study?.text).toBe("First");

    context.retain(line("1", "First"));
    expect(context.held).toBeNull();
    expect(context.study?.text).toBe("First");

    context.release();
    expect(context.study?.text).toBe("Second");
  });

  it("attaches a translation only to the occurrence it was made for", () => {
    const context = createStudyContext();
    context.retain(line("1", "Yes."));
    context.setLive(line("2", "Yes."));

    context.translate("2", "Sim.");

    expect(context.retained?.translation).toBeUndefined();
    expect(context.live?.translation).toBe("Sim.");
  });

  it("keeps its own copies, so a caller cannot change a stored snapshot", () => {
    const context = createStudyContext();
    const fresh = new Set(["hello"]);
    context.setLive(line("1", "Hello", { freshKeys: fresh }));
    fresh.add("other");

    expect([...context.live!.freshKeys]).toEqual(["hello"]);
  });

  it("turns a snapshot into a whole-sentence phrase without a selected word", () => {
    const phrase = sentencePhrase(line("1", "Line one\nline two", { translation: "Linha" }));

    expect(phrase).toEqual({
      kind: "sentence",
      sentence: "Line one\nline two",
      sentenceTranslation: "Linha",
      sourceLanguage: "en",
      targetLanguage: "pt-BR",
      platform: "Netflix",
      mediaTitle: "Show",
      season: 1,
      episode: 2,
      timeSeconds: 12,
    });
    expect("selectedWord" in phrase).toBe(false);
  });

  it("leaves out times and translations it does not have", () => {
    const context = wordContext(line("1", "Hello", { start: undefined, direction: "pt-en" }));

    expect(context).not.toHaveProperty("timeSeconds");
    expect(context).not.toHaveProperty("sentenceTranslation");
    expect(context.sourceLanguage).toBe("pt-BR");
  });
});
