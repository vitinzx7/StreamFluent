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
  toggleAutoPause: vi.fn(),
}));

vi.mock("../adapters/registry.ts", () => ({ getAdapter: mocks.getAdapter }));
vi.mock("../adapters/html5-player.ts", () => ({ observeHtml5Player: mocks.observeHtml5Player }));
vi.mock("../core/ui/timed-subtitles.ts", () => ({ createTimedSubtitles: mocks.createTimedSubtitles }));
vi.mock("../core/ui/subtitle-overlay.ts", () => ({ createSubtitleOverlay: mocks.createOverlay }));
vi.mock("../core/storage.ts", () => ({ PhraseRepository: { save: mocks.savePhrase, saveResult: mocks.savePhrase } }));
vi.mock("../core/settings.ts", () => ({
  SettingsRepository: { get: mocks.getSettings, save: mocks.saveSettings, onChange: mocks.onSettingsChange, toggleAutoPause: mocks.toggleAutoPause },
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

const defaults: Settings = { direction: "en-pt", showTranslation: true, subtitleBottom: 12, highlightNewWords: true, highlightSpecialWords: false, autoPause: false, level: null };
let cue: (value: SubtitleCue | null) => void;
let settingsChanged: (value: Settings) => void;
let options: OverlayOptions;
let stopObserving: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;
let overlay: Record<"update" | "setTranslation" | "applySettings" | "refreshWordStatuses" | "hideCard" | "showCard" | "showFeedback" | "showCopyFallback" | "askLevel" | "destroy", ReturnType<typeof vi.fn>>;
let vocabulary: {
  ready: Promise<void>;
  observeLine: ReturnType<typeof vi.fn>;
  getMark: ReturnType<typeof vi.fn>;
  setMark: ReturnType<typeof vi.fn>;
  onChange: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};
let stopVocabulary: ReturnType<typeof vi.fn>;
let navigation: Record<"cueChanged" | "backTarget" | "current" | "reset" | "stop", ReturnType<typeof vi.fn>>;

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
  overlay = { update: vi.fn(), setTranslation: vi.fn(), applySettings: vi.fn(), refreshWordStatuses: vi.fn(), hideCard: vi.fn(), showCard: vi.fn(), showFeedback: vi.fn(), showCopyFallback: vi.fn(), askLevel: vi.fn(), destroy: vi.fn() };
  stopVocabulary = vi.fn();
  vocabulary = {
    ready: Promise.resolve(),
    observeLine: vi.fn().mockResolvedValue(new Set()),
    getMark: vi.fn().mockReturnValue(null),
    setMark: vi.fn().mockResolvedValue(undefined),
    onChange: vi.fn().mockReturnValue(stopVocabulary),
    dispose: vi.fn(),
  };
  mocks.createVocabularyStore.mockReturnValue(vocabulary);
  navigation = { cueChanged: vi.fn(), backTarget: vi.fn().mockReturnValue(null), current: vi.fn().mockReturnValue(null), reset: vi.fn(), stop: vi.fn() };
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
    emit("Hello");
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vocabulary.observeLine).toHaveBeenCalledWith("Hello world", "en", expect.any(String));
    expect(options.getWordStatus?.("Hello")).toBe("new");
    expect(options.getWordStatus?.("world")).toBeNull();
  });

  it("keeps the line's colours on a re-render instead of re-recording it", async () => {
    vocabulary.observeLine.mockResolvedValueOnce(new Set(["hello"])).mockResolvedValue(new Set());
    await boot();
    emit("Hello");

    // A position change preserves the same occurrence.
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    emit("Hello world");
    // Let the line's own history lookup recolour it first.
    await new Promise((resolve) => setTimeout(resolve));
    void options.onWordSelect("Hello", "Hello world");

    const onMark = overlay.showCard.mock.calls[0][2] as (mark: string | null) => void;
    overlay.refreshWordStatuses.mockClear();
    await onMark("learned");

    expect(vocabulary.setMark).toHaveBeenCalledWith("Hello", "en", "learned", expect.objectContaining({ context: expect.objectContaining({ sentence: "Hello world" }) }));
    expect(overlay.refreshWordStatuses).toHaveBeenCalledTimes(1);
  });

  it("keys marks by Portuguese when the subtitles are in Portuguese", async () => {
    mocks.getSettings.mockResolvedValue({ ...defaults, direction: "pt-en" });
    await boot();
    emit("Meu coração");
    void options.onWordSelect("Coração", "Meu coração");

    const onMark = overlay.showCard.mock.calls[0][2] as (mark: string | null) => void;
    await onMark("difficult");

    expect(vocabulary.setMark).toHaveBeenCalledWith("Coração", "pt-BR", "difficult", expect.any(Object));
  });

  it("shows the word's existing mark on the card", async () => {
    vocabulary.getMark.mockReturnValue("learned");
    await boot();
    emit("Hello world");
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

describe("quick difficult marking", () => {
  it("persists the clicked snapshot without any lookup or phrase request", async () => {
    await boot(); emit("Hello world"); await Promise.resolve();
    mocks.translateSentence.mockClear(); mocks.translateWord.mockClear();
    options.onWordDifficult?.("Hello", "Hello world");
    emit("Next line");
    await Promise.resolve();
    expect(vocabulary.setMark).toHaveBeenCalledWith("Hello", "en", "difficult", expect.objectContaining({ context: expect.objectContaining({ sentence: "Hello world", sourceLanguage: "en" }) }));
    expect(mocks.translateWord).not.toHaveBeenCalled();
    expect(mocks.translateSentence).not.toHaveBeenCalledWith("Hello world", expect.anything());
    expect(mocks.savePhrase).not.toHaveBeenCalled();
  });
  it("does not reopen a closed card after a delayed lookup", async () => {
    const pending = deferred<unknown>(); mocks.translateWord.mockReturnValue(pending.promise);
    await boot(); emit("Hello world"); void options.onWordSelect("Hello", "Hello world");
    options.onCardClose?.();
    pending.resolve({ word: "Hello", translation: "Olá", error: null });
    await Promise.resolve();
    expect(overlay.showCard).toHaveBeenCalledTimes(1);
  });
});

describe("study shortcuts", () => {
  function withVideo() {
    const video = document.createElement("video");
    document.body.append(video);
    mocks.getAdapter.mockReturnValue({
      name: "Netflix",
      isSupportedPage: () => true,
      getMediaMetadata: () => ({ title: "Episode one", season: 1, episode: 1 }),
      observeSubtitles: (listener: typeof cue) => { cue = listener; return stopObserving; },
      getVideo: () => video,
      seekTo: vi.fn().mockResolvedValue(true),
      play: vi.fn().mockResolvedValue(true),
      pause: vi.fn().mockResolvedValue(true),
      canPlayPause: () => false,
    });
    return video;
  }

  function press(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(event);
    return event;
  }

  afterEach(() => document.body.replaceChildren());

  it("leaves every key to the page until this episode showed a subtitle", async () => {
    withVideo();
    await boot();

    const event = press("r");

    expect(event.defaultPrevented).toBe(false);
    expect(mocks.savePhrase).not.toHaveBeenCalled();
  });

  it("R saves the line on screen as a whole sentence", async () => {
    withVideo();
    mocks.savePhrase.mockResolvedValue({ phrase: {}, duplicate: false });
    await boot();
    emit("Hello\nworld");

    const event = press("R", { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.savePhrase).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "sentence",
      sentence: "Hello\nworld",
      platform: "Netflix",
      mediaTitle: "Episode one",
    }));
  });

  it("the panel's copy button runs the same copy as Ctrl+C", async () => {
    withVideo();
    await boot();
    emit("Copy me");

    options.onStudyCommand?.("copy-line");
    press("c", { ctrlKey: true });

    // jsdom has no clipboard API: both fall back to the selectable field.
    expect(overlay.showCopyFallback.mock.calls).toEqual([["Copy me"], ["Copy me"]]);
  });

  it("leaves Space to the player while play/pause are not confirmed", async () => {
    withVideo();
    await boot();
    emit("Hello");

    expect(press(" ").defaultPrevented).toBe(false);
  });

  it("asks the timeline where A goes, and stops listening on pagehide", async () => {
    withVideo();
    navigation.backTarget.mockReturnValue(3);
    await boot();
    emit("Hello");

    expect(press("a").defaultPrevented).toBe(true);
    expect(navigation.backTarget).toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));
    expect(press("a").defaultPrevented).toBe(false);
  });
});

describe("auto-pause on DOM subtitles", () => {
  function playingAdapter() {
    const video = document.createElement("video");
    let paused = false;
    Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
    Object.defineProperty(video, "readyState", { configurable: true, get: () => 4 });
    document.body.append(video);
    const pause = vi.fn(async () => {
      paused = true;
      video.dispatchEvent(new Event("pause"));
      return true;
    });
    mocks.getAdapter.mockReturnValue({
      name: "Netflix",
      isSupportedPage: () => true,
      getMediaMetadata: () => ({ title: "Episode one", season: 1, episode: 1 }),
      observeSubtitles: (listener: typeof cue) => { cue = listener; return stopObserving; },
      getVideo: () => video,
      seekTo: vi.fn().mockResolvedValue(true),
      play: vi.fn().mockResolvedValue(true),
      pause,
      canPlayPause: () => true,
    });
    const resume = () => {
      paused = false;
      video.dispatchEvent(new Event("play"));
    };
    return { video, pause, resume };
  }

  // The translated line is off here: these lines go up at once, as they would without it.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const shownLines = () => overlay.update.mock.calls.map(([text]) => text);
  const observed = () => vocabulary.observeLine.mock.calls.map(([text]) => text);

  afterEach(() => document.body.replaceChildren());

  it("A02: pauses when the line is replaced and keeps the line that ended on screen", async () => {
    const { pause } = playingAdapter();
    mocks.getSettings.mockResolvedValue({ ...defaults, autoPause: true, showTranslation: false });
    await boot();

    emit("Where were you?");
    emit("At home.");
    await settle();

    expect(pause).toHaveBeenCalledOnce();
    expect(shownLines()).toEqual(["Where were you?"]);
    // Hidden behind the retained line, so not yet "seen".
    expect(observed()).toEqual(["Where were you?"]);
  });

  it("R and copy work on the retained line, not on the hidden live one", async () => {
    playingAdapter();
    mocks.getSettings.mockResolvedValue({ ...defaults, autoPause: true, showTranslation: false });
    mocks.savePhrase.mockResolvedValue({ phrase: {}, duplicate: false });
    await boot();
    emit("Where were you?");
    emit("At home.");
    await settle();

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true }));
    options.onStudyCommand?.("copy-line");

    expect(mocks.savePhrase).toHaveBeenCalledWith(expect.objectContaining({ kind: "sentence", sentence: "Where were you?" }));
    expect(overlay.showCopyFallback).toHaveBeenCalledWith("Where were you?");
  });

  it("A03: resuming shows the live line and records its words then", async () => {
    const { pause, resume } = playingAdapter();
    mocks.getSettings.mockResolvedValue({ ...defaults, autoPause: true, showTranslation: false });
    await boot();
    emit("Where were you?");
    emit("At home.");
    await settle();

    resume();

    expect(shownLines()).toEqual(["Where were you?", "At home."]);
    expect(observed()).toEqual(["Where were you?", "At home."]);
    expect(pause).toHaveBeenCalledOnce();
  });

  it("A06: switching auto-pause off while paused keeps the video paused and the line retained", async () => {
    const { video } = playingAdapter();
    mocks.getSettings.mockResolvedValue({ ...defaults, autoPause: true, showTranslation: false });
    await boot();
    emit("Where were you?");
    emit("At home.");
    await settle();

    settingsChanged({ ...defaults, autoPause: false });

    expect(video.paused).toBe(true);
    expect(shownLines()).toEqual(["Where were you?"]);
  });

  it("a seek releases the retained line", async () => {
    const { video } = playingAdapter();
    mocks.getSettings.mockResolvedValue({ ...defaults, autoPause: true, showTranslation: false });
    await boot();
    emit("Where were you?");
    emit("At home.");
    await settle();

    video.dispatchEvent(new Event("seeking"));

    expect(shownLines()).toEqual(["Where were you?", "At home."]);
  });

  it("stays off by default", async () => {
    const { pause } = playingAdapter();
    mocks.getSettings.mockResolvedValue({ ...defaults, showTranslation: false });
    await boot();

    emit("Where were you?");
    emit("At home.");
    await settle();

    expect(pause).not.toHaveBeenCalled();
    expect(shownLines()).toEqual(["Where were you?", "At home."]);
  });
});

describe("the line and its translation appear together", () => {
  const ticks = () => new Promise((resolve) => setTimeout(resolve, 0));
  const lastShown = () => overlay.update.mock.calls[overlay.update.mock.calls.length - 1]?.[0];

  afterEach(() => vi.useRealTimers());

  it("holds the original until its translation arrives, then shows both at once", async () => {
    const request = deferred<string>();
    mocks.translateSentence.mockReturnValue(request.promise);
    await boot();

    emit("Hello");
    expect(overlay.update).not.toHaveBeenCalledWith("Hello");
    expect(vocabulary.observeLine).not.toHaveBeenCalled();

    request.resolve("Olá");
    await ticks();

    expect(lastShown()).toBe("Hello");
    expect(overlay.setTranslation).toHaveBeenCalledWith("Hello", "Olá");
    const order = overlay.update.mock.invocationCallOrder;
    expect(order[order.length - 1]).toBeLessThan(overlay.setTranslation.mock.invocationCallOrder[0]);
    expect(vocabulary.observeLine).toHaveBeenCalledWith("Hello", "en", expect.any(String));
  });

  it("takes the previous line off at once, without the new one", async () => {
    mocks.translateSentence.mockResolvedValueOnce("Olá").mockReturnValue(new Promise(() => {}));
    await boot();
    emit("Hello");
    await ticks();

    emit("Goodbye");

    expect(lastShown()).toBeNull();
  });

  it("puts the original up alone after the wait, and the translation joins it later", async () => {
    vi.useFakeTimers();
    const request = deferred<string>();
    mocks.translateSentence.mockReturnValue(request.promise);
    await boot();
    emit("Hello");

    await vi.advanceTimersByTimeAsync(999);
    expect(overlay.update).not.toHaveBeenCalledWith("Hello");
    await vi.advanceTimersByTimeAsync(1);
    expect(lastShown()).toBe("Hello");
    expect(overlay.setTranslation).not.toHaveBeenCalled();

    request.resolve("Olá");
    await vi.advanceTimersByTimeAsync(0);
    expect(overlay.setTranslation).toHaveBeenCalledWith("Hello", "Olá");
    // The translation joins the line already up; the line is not drawn again.
    expect(overlay.update.mock.calls.filter(([text]) => text === "Hello")).toHaveLength(1);
  });

  it("shows the original at once when the translation fails", async () => {
    mocks.translateSentence.mockResolvedValue("");
    await boot();

    emit("Hello");
    await ticks();

    expect(lastShown()).toBe("Hello");
    expect(overlay.setTranslation).not.toHaveBeenCalled();
  });

  it("shows the original at once when the translated line is turned off, or is off", async () => {
    mocks.translateSentence.mockReturnValue(new Promise(() => {}));
    await boot();
    emit("Hello");

    settingsChanged({ ...defaults, showTranslation: false });
    expect(lastShown()).toBe("Hello");

    emit("Goodbye");
    expect(lastShown()).toBe("Goodbye");
  });

  it("never shows a line that ended before its translation arrived", async () => {
    const request = deferred<string>();
    mocks.translateSentence.mockReturnValue(request.promise);
    await boot();
    emit("Hello");

    cue(null);
    request.resolve("Olá");
    await ticks();

    expect(overlay.update).not.toHaveBeenCalledWith("Hello");
    expect(overlay.setTranslation).not.toHaveBeenCalled();
  });
});

describe("asking the English level", () => {
  it("asks once, on the first English line, while no level is chosen", async () => {
    await boot();

    emit("Hello");
    emit("Again");

    expect(overlay.askLevel).toHaveBeenCalledOnce();
  });

  it("does not ask when a level is set or the subtitles are Portuguese", async () => {
    mocks.getSettings.mockResolvedValue({ ...defaults, level: "B1" });
    await boot();
    emit("Hello");
    window.dispatchEvent(new Event("pagehide"));

    vi.resetModules();
    mocks.getSettings.mockResolvedValue({ ...defaults, direction: "pt-en" });
    await boot();
    emit("Olá");

    expect(overlay.askLevel).not.toHaveBeenCalled();
  });

  it("recolours the line when the level changes", async () => {
    await boot();
    emit("Hello");
    overlay.refreshWordStatuses.mockClear();

    settingsChanged({ ...defaults, level: "A2" });

    expect(overlay.refreshWordStatuses).toHaveBeenCalled();
  });
});
