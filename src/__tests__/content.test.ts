/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../core/settings.ts";
import type { SubtitleCue } from "../core/types.ts";
import type { OverlayOptions } from "../core/ui/subtitle-overlay.ts";

const mocks = vi.hoisted(() => ({
  getAdapter: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn().mockResolvedValue({}),
  onSettingsChange: vi.fn(),
  createOverlay: vi.fn(),
  translateSentence: vi.fn(),
  translateWord: vi.fn(),
  savePhrase: vi.fn(),
  observeHtml5Player: vi.fn(),
  createTimedSubtitles: vi.fn(),
  createVocabularyStore: vi.fn(),
  createLineNavigation: vi.fn(),
}));

vi.mock("../adapters/registry.ts", () => ({ getAdapter: mocks.getAdapter }));
vi.mock("../adapters/html5-player.ts", () => ({ observeHtml5Player: mocks.observeHtml5Player }));
vi.mock("../core/ui/timed-subtitles.ts", () => ({ createTimedSubtitles: mocks.createTimedSubtitles }));
vi.mock("../core/ui/subtitle-overlay.ts", () => ({ createSubtitleOverlay: mocks.createOverlay }));
vi.mock("../core/storage.ts", () => ({ PhraseRepository: { save: mocks.savePhrase } }));
vi.mock("../core/settings.ts", () => ({
  SettingsRepository: { get: mocks.getSettings, save: mocks.saveSettings, onChange: mocks.onSettingsChange },
  DIRECTION_LABELS: { "en-pt": "EN → PT", "pt-en": "PT → EN" },
  getLangPair: (direction: string) =>
    direction === "pt-en" ? { source: "pt-BR", target: "en" } : { source: "en", target: "pt-BR" },
}));
vi.mock("../core/line-navigation.ts", () => ({ createLineNavigation: mocks.createLineNavigation }));
vi.mock("../core/vocabulary.ts", () => ({
  createVocabularyStore: mocks.createVocabularyStore,
  wordKey: (word: string) => word.toLowerCase().replace(/[^\p{L}']/gu, ""),
}));
vi.mock("../core/translation.ts", () => ({ translateSentence: mocks.translateSentence, translateWord: mocks.translateWord }));

const defaults: Settings = { direction: "en-pt", showTranslation: true, subtitleBottom: 12, highlightNewWords: true, highlightSpecialWords: false, autoPause: false };
let cue: (value: SubtitleCue | null) => void;
let settingsChanged: (value: Settings) => void;
let options: OverlayOptions;
let stopObserving: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;
let overlay: Record<"update" | "setTranslation" | "applySettings" | "refreshWordStatuses" | "hideCard" | "showCard" | "destroy", ReturnType<typeof vi.fn>>;
let vocabulary: {
  ready: Promise<void>;
  observeLine: ReturnType<typeof vi.fn>;
  getMark: ReturnType<typeof vi.fn>;
  setMark: ReturnType<typeof vi.fn>;
  onChange: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};
let stopVocabulary: ReturnType<typeof vi.fn>;
let navigation: { cueChanged: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function boot() {
  await import("../content/content.ts");
  await Promise.resolve();
}

function emit(text: string) { cue({ text, start: 0, end: 0 }); }

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/watch/first");
  stopObserving = vi.fn();
  unsubscribe = vi.fn();
  overlay = { update: vi.fn(), setTranslation: vi.fn(), applySettings: vi.fn(), refreshWordStatuses: vi.fn(), hideCard: vi.fn(), showCard: vi.fn(), destroy: vi.fn() };
  stopVocabulary = vi.fn();
  vocabulary = {
    ready: Promise.resolve(),
    observeLine: vi.fn().mockResolvedValue(new Set()),
    getMark: vi.fn().mockReturnValue(null),
    setMark: vi.fn(),
    onChange: vi.fn().mockReturnValue(stopVocabulary),
    dispose: vi.fn(),
  };
  mocks.createVocabularyStore.mockReturnValue(vocabulary);
  navigation = { cueChanged: vi.fn(), stop: vi.fn() };
  mocks.createLineNavigation.mockReturnValue(navigation);
  mocks.getSettings.mockResolvedValue({ ...defaults });
  mocks.onSettingsChange.mockImplementation((listener) => { settingsChanged = listener; return unsubscribe; });
  mocks.getAdapter.mockReturnValue({
    name: "Netflix",
    isSupportedPage: () => true,
    getMediaMetadata: () => ({ title: "Episode one", season: 1, episode: 1 }),
    observeSubtitles: (listener: typeof cue) => { cue = listener; return stopObserving; },
  });
  mocks.createOverlay.mockImplementation((next) => { options = next; return overlay; });
  mocks.translateSentence.mockResolvedValue("Olá");
  mocks.translateWord.mockResolvedValue({ word: "Hello", translation: "Olá", phonetic: "", definition: "", example: "", error: null });
  vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) } });
});

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
});

describe("Netflix content integration", () => {
  it("renders native cues through the existing adapter and translates their text", async () => {
    await boot();
    emit("Hello");
    await Promise.resolve();
    expect(overlay.update).toHaveBeenCalledWith("Hello");
    expect(mocks.translateSentence).toHaveBeenCalledWith("Hello", "en-pt");
    expect(overlay.setTranslation).toHaveBeenCalledWith("Hello", "Olá");
    expect(mocks.observeHtml5Player).not.toHaveBeenCalled();
  });

  it("drops an in-flight result after the translated line is disabled", async () => {
    const request = deferred<string>();
    mocks.translateSentence.mockReturnValue(request.promise);
    await boot();
    emit("Hello");
    settingsChanged({ ...defaults, showTranslation: false });
    request.resolve("Olá");
    await Promise.resolve();
    expect(overlay.setTranslation).not.toHaveBeenCalled();
    expect(overlay.applySettings).toHaveBeenCalledWith({ ...defaults, showTranslation: false });
  });

  it("retranslates the current line after changing direction and rejects the old response", async () => {
    const oldRequest = deferred<string>();
    const newRequest = deferred<string>();
    mocks.translateSentence.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    await boot();
    emit("Hello");
    settingsChanged({ ...defaults, direction: "pt-en" });
    oldRequest.resolve("Tradução antiga");
    newRequest.resolve("New translation");
    await Promise.resolve();
    expect(mocks.translateSentence).toHaveBeenLastCalledWith("Hello", "pt-en");
    expect(overlay.setTranslation).toHaveBeenCalledTimes(1);
    expect(overlay.setTranslation).toHaveBeenCalledWith("Hello", "New translation");
  });

  it("does not discard a valid translation when only the subtitle position changes", async () => {
    const request = deferred<string>();
    mocks.translateSentence.mockReturnValue(request.promise);
    await boot();
    emit("Hello");
    settingsChanged({ ...defaults, subtitleBottom: 30 });
    request.resolve("Olá");
    await Promise.resolve();
    expect(overlay.setTranslation).toHaveBeenCalledWith("Hello", "Olá");
  });

  it("drops a result when the cue ends or the episode URL changes", async () => {
    const request = deferred<string>();
    mocks.translateSentence.mockReturnValue(request.promise);
    await boot();
    emit("Hello");
    cue(null);
    request.resolve("Olá");
    await Promise.resolve();
    expect(overlay.setTranslation).not.toHaveBeenCalled();

    const next = deferred<string>();
    mocks.translateSentence.mockReturnValue(next.promise);
    emit("Other episode");
    window.history.replaceState({}, "", "/watch/second");
    next.resolve("Outro episódio");
    await Promise.resolve();
    expect(overlay.setTranslation).not.toHaveBeenCalled();
  });

  it("stops the adapter and settings listener once and rejects pending results on pagehide", async () => {
    const request = deferred<string>();
    mocks.translateSentence.mockReturnValue(request.promise);
    await boot();
    emit("Hello");
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    request.resolve("Olá");
    await Promise.resolve();
    expect(stopObserving).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(overlay.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.setTranslation).not.toHaveBeenCalled();
  });

  it("does not create an overlay when pagehide occurs before settings finish loading", async () => {
    const settings = deferred<Settings>();
    mocks.getSettings.mockReturnValue(settings.promise);
    await boot();
    window.dispatchEvent(new Event("pagehide"));
    settings.resolve(defaults);
    await Promise.resolve();
    expect(mocks.createOverlay).not.toHaveBeenCalled();
  });

  it("opens the library through runtime messaging without requiring tabs in the content script", async () => {
    await boot();
    options.onOpenLibrary();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "sf:open-library" });
  });

  it("restarts once when a page is restored from the back/forward cache", async () => {
    await boot();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await Promise.resolve();
    expect(mocks.createOverlay).toHaveBeenCalledTimes(2);
    expect(stopObserving).toHaveBeenCalledTimes(1);
    emit("Restored");
    await Promise.resolve();
    expect(overlay.setTranslation).toHaveBeenCalledWith("Restored", "Olá");
  });

  it("does not reopen an old word card when the language changes during lookup", async () => {
    const word = deferred<{ word: string; translation: string; definition: string; phonetic: string; example: string; error: null }>();
    mocks.translateWord.mockReturnValue(word.promise);
    await boot();
    const lookup = options.onWordSelect("Hello", "Hello");
    settingsChanged({ ...defaults, direction: "pt-en" });
    word.resolve({ word: "Hello", translation: "Olá", definition: "", phonetic: "", example: "", error: null });
    await lookup;
    await Promise.resolve();
    expect(overlay.showCard).toHaveBeenCalledTimes(1);
    expect(overlay.hideCard).toHaveBeenCalled();
  });
});

describe("word colours", () => {
  it("records each new line and colours only its first-time words", async () => {
    vocabulary.observeLine.mockResolvedValue(new Set(["hello"]));
    await boot();

    emit("Hello world");
    await Promise.resolve();

    expect(vocabulary.observeLine).toHaveBeenCalledWith("Hello world", "en", expect.any(String));
    expect(options.getWordStatus?.("Hello")).toBe("new");
    expect(options.getWordStatus?.("world")).toBeNull();
  });

  it("keeps the line's colours on a re-render instead of re-recording it", async () => {
    vocabulary.observeLine.mockResolvedValueOnce(new Set(["hello"])).mockResolvedValue(new Set());
    await boot();
    emit("Hello");

    // A position change preserves the same occurrence.
    await Promise.resolve();
    settingsChanged({ ...defaults, subtitleBottom: 40 });

    expect(vocabulary.observeLine).toHaveBeenCalledTimes(1);
    expect(options.getWordStatus?.("Hello")).toBe("new");
  });

  it("lets a user mark win over new, and keeps marks when new-word colour is off", async () => {
    vocabulary.observeLine.mockResolvedValue(new Set(["hello", "world"]));
    vocabulary.getMark.mockImplementation((word: string) => (word === "Hello" ? "difficult" : null));
    await boot();
    emit("Hello world");

    settingsChanged({ ...defaults, highlightNewWords: false });

    expect(options.getWordStatus?.("Hello")).toBe("difficult");
    expect(options.getWordStatus?.("world")).toBeNull();
    expect(overlay.refreshWordStatuses).toHaveBeenCalled();
  });

  it("saves a mark from the card under the source language and recolours the line", async () => {
    await boot();
    void options.onWordSelect("Hello", "Hello world");

    const onMark = overlay.showCard.mock.calls[0][2] as (mark: string | null) => void;
    overlay.refreshWordStatuses.mockClear();
    await onMark("learned");

    expect(vocabulary.setMark).toHaveBeenCalledWith("Hello", "en", "learned");
    expect(overlay.refreshWordStatuses).toHaveBeenCalledTimes(1);
  });

  it("keys marks by Portuguese when the subtitles are in Portuguese", async () => {
    mocks.getSettings.mockResolvedValue({ ...defaults, direction: "pt-en" });
    await boot();
    void options.onWordSelect("Coração", "Meu coração");

    const onMark = overlay.showCard.mock.calls[0][2] as (mark: string | null) => void;
    await onMark("difficult");

    expect(vocabulary.setMark).toHaveBeenCalledWith("Coração", "pt-BR", "difficult");
  });

  it("shows the word's existing mark on the card", async () => {
    vocabulary.getMark.mockReturnValue("learned");
    await boot();
    void options.onWordSelect("Hello", "Hello world");

    expect(overlay.showCard.mock.calls[0][0]).toMatchObject({ word: "Hello", mark: "learned" });
  });

  it("writes pending vocabulary and stops listening on pagehide", async () => {
    await boot();
    window.dispatchEvent(new Event("pagehide"));

    expect(stopVocabulary).toHaveBeenCalledTimes(1);
    expect(vocabulary.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("line navigation", () => {
  it("learns line times from every cue, including the end of a line", async () => {
    await boot();

    emit("I am student in TI");
    cue(null);
    emit("and you");

    expect(navigation.cueChanged.mock.calls).toEqual([["I am student in TI"], [null], ["and you"]]);
  });

  it("is given the platform adapter so it can seek with it", async () => {
    await boot();

    expect(mocks.createLineNavigation).toHaveBeenCalledWith(mocks.getAdapter.mock.results[0].value);
  });

  it("stops listening for the key on pagehide", async () => {
    await boot();
    window.dispatchEvent(new Event("pagehide"));

    expect(navigation.stop).toHaveBeenCalledTimes(1);
  });
});
