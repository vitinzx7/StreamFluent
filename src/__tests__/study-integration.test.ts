/** @vitest-environment jsdom */
/**
 * Combined flows with the real modules: overlay, vocabulary, settings,
 * phrases, shortcuts, auto-pause and the serialized worker. Only the
 * platform adapter and the network providers are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import libraryHtml from "../../public/library.html?raw";
import librarySource from "../../public/library.js?raw";
import manifest from "../../public/manifest.json";
import { installStudyWorker } from "./helpers/study-worker.ts";
import { requestStudy } from "../core/study-messages.ts";
import { createVocabularyStore } from "../core/vocabulary.ts";
import { isAllowedProviderUrl } from "../core/translation-request.ts";
import type { SubtitleCue } from "../core/types.ts";
import type { TranslationResult } from "../core/translation.ts";

const mocks = vi.hoisted(() => ({
  getAdapter: vi.fn(),
  translateWord: vi.fn(),
  translateSentence: vi.fn(),
  demo: false,
}));
vi.mock("../adapters/registry.ts", () => ({ getAdapter: mocks.getAdapter }));
vi.mock("../core/demo-mode.ts", () => ({ get DEMO_MODE() { return mocks.demo; } }));
vi.mock("../core/translation.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/translation.ts")>()),
  translateWord: mocks.translateWord,
  translateSentence: mocks.translateSentence,
}));

type Vocabulary = { languages: Record<string, { seen: string[]; marks: Record<string, string>; details: Record<string, unknown> }> };
type Phrase = { kind: string; sentence: string; selectedWord?: string };

let worker: ReturnType<typeof installStudyWorker>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

const lookup = (word: string, overrides: Partial<TranslationResult> = {}): TranslationResult => ({
  word, translation: "tradução", phonetic: "", definition: "", example: "", error: null, ...overrides,
});

/** A Netflix-like player whose subtitles the test emits. */
function player() {
  const video = document.createElement("video");
  let paused = false;
  Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(video, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(video, "duration", { configurable: true, value: 600 });
  document.body.append(video);
  let listener: ((cue: SubtitleCue | null) => void) | undefined;
  const adapter = {
    name: "Netflix",
    isSupportedPage: () => true,
    getMediaMetadata: () => ({ title: "Show", season: 1, episode: 2 }),
    observeSubtitles: (next: (cue: SubtitleCue | null) => void) => {
      listener = next;
      return () => { listener = undefined; };
    },
    getVideo: () => video,
    seekTo: vi.fn(async (seconds: number) => {
      video.currentTime = seconds;
      video.dispatchEvent(new Event("seeking"));
      video.dispatchEvent(new Event("seeked"));
      return true;
    }),
    play: vi.fn(async () => {
      paused = false;
      video.dispatchEvent(new Event("play"));
      return true;
    }),
    pause: vi.fn(async () => {
      paused = true;
      video.dispatchEvent(new Event("pause"));
      return true;
    }),
    canPlayPause: () => true,
  };
  mocks.getAdapter.mockReturnValue(adapter);
  return {
    video,
    adapter,
    ready: () => vi.waitFor(() => expect(listener).toBeTypeOf("function")),
    line: (text: string | null) => listener!(text ? { text, start: 0, end: 0 } : null),
  };
}

async function boot(): Promise<void> {
  await import("../content/content.ts");
}

const word = (text: string) =>
  [...document.querySelectorAll<HTMLElement>(".sf-overlay .sf-word")].find((element) => element.textContent === text)!;

function colour(text: string): string {
  const element = word(text);
  for (const status of ["difficult", "learned", "special", "new"]) {
    if (element.classList.contains(`sf-word-${status}`)) return status;
  }
  return "normal";
}

const rightClick = (text: string) =>
  word(text).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
const cardButton = (mark: string) => document.querySelector<HTMLButtonElement>(`.sf-card [data-mark="${mark}"]`)!;
const press = (key: string, init: KeyboardEventInit = {}) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
const vocabulary = () => worker.storage.vocabulary as Vocabulary;
const phrases = () => (worker.storage.phrases ?? []) as Phrase[];

beforeEach(() => {
  vi.resetModules();
  mocks.translateWord.mockImplementation(async (text: string) => lookup(text));
  mocks.translateSentence.mockResolvedValue("");
  window.history.replaceState({}, "", "/watch/1");
});

afterEach(() => {
  mocks.demo = false;
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("colour lifecycle of one word", () => {
  it("C07: special → difficult → learned → no mark is lilac → red → green → lilac, without duplicates", async () => {
    worker = installStudyWorker({ settings: { highlightSpecialWords: true } });
    const p = player();
    await boot();
    await p.ready();
    p.line("This is ambiguous");
    await flush();
    expect(colour("ambiguous")).toBe("special");

    rightClick("ambiguous");
    await flush();
    expect(colour("ambiguous")).toBe("difficult");

    word("ambiguous").click();
    await flush();
    cardButton("learned").click();
    await flush();
    expect(colour("ambiguous")).toBe("learned");

    // Pressing the active mark again removes it.
    cardButton("learned").click();
    await flush();
    expect(colour("ambiguous")).toBe("special");

    const en = vocabulary().languages.en;
    expect(en.marks).toEqual({});
    expect(en.details).toEqual({});
    expect((await worker.seen.all()).en).toContain("ambiguous");
    expect(phrases()).toEqual([]);
  });

  it("M02 + M01: two right clicks make one difficult mark, and neither reaches the network", async () => {
    worker = installStudyWorker();
    const p = player();
    await boot();
    await p.ready();
    p.line("Hello world");
    await flush();

    rightClick("world");
    rightClick("world");
    await flush();

    expect(vocabulary().languages.en.marks).toEqual({ world: "difficult" });
    expect(mocks.translateWord).not.toHaveBeenCalled();
    const types = worker.sendMessage.mock.calls.map(([message]) => (message as { type: string }).type);
    expect(types.every((type) => type.startsWith("sf:study:"))).toBe(true);
    expect(document.querySelector(".sf-feedback")!.textContent).toBe("Já está nas difíceis");
  });

  it("M03: a failed translation leaves a usable card that marks and saves the original", async () => {
    worker = installStudyWorker();
    mocks.translateWord.mockResolvedValue(lookup("world", { translation: "", error: "offline" }));
    const p = player();
    await boot();
    await p.ready();
    p.line("Hello world");
    await flush();

    word("world").click();
    await flush();
    expect(document.querySelector(".sf-card-translation")!.textContent).toContain("Tradução indisponível");
    cardButton("difficult").click();
    document.querySelector<HTMLButtonElement>(".sf-card-btn")!.click();
    await flush();

    expect(vocabulary().languages.en.marks.world).toBe("difficult");
    expect(phrases()).toEqual([expect.objectContaining({ kind: "word", sentence: "Hello world", selectedWord: "world" })]);
  });

  it("offers dictionary links in the card that open in a new tab, without fetching them", async () => {
    worker = installStudyWorker();
    const p = player();
    await boot();
    await p.ready();
    p.line("They ran away");
    await flush();

    word("ran").click();
    await flush();

    const links = [...document.querySelectorAll<HTMLAnchorElement>(".sf-card-links a")];
    expect(links.map((link) => link.textContent)).toEqual(["Linguee", "WordReference", "Reverso", "Cambridge"]);
    expect(links[1].href).toBe("https://www.wordreference.com/enpt/ran");
    expect(links.every((link) => link.target === "_blank" && link.rel === "noopener noreferrer")).toBe(true);
    const types = worker.sendMessage.mock.calls.map(([message]) => (message as { type: string }).type);
    expect(types.every((type) => type.startsWith("sf:study:"))).toBe(true);
  });

  it("S01: subtitle text that looks like HTML is shown as text", async () => {
    worker = installStudyWorker();
    const p = player();
    await boot();
    await p.ready();

    p.line("<img src=x onerror=alert(1)> hi");
    await flush();

    expect(document.querySelector(".sf-overlay img")).toBeNull();
    expect(document.querySelector(".sf-line-source")!.textContent).toBe("<img src=x onerror=alert(1)> hi");
  });
});

describe("migration and the first line", () => {
  it("C02 + C03: an old profile keeps its marks, yellow becomes green, and the first line is not all new", async () => {
    worker = installStudyWorker({
      vocabulary: { en: { seen: ["hello", "world"], marks: { world: "marked", "Again!": "difficult" } } },
      settings: { direction: "en-pt", subtitleBottom: 40, highlightNewWords: true },
      phrases: [{ id: "old", sentence: "Kept phrase", selectedWord: "kept", createdAt: "2020-01-01T00:00:00.000Z" }],
    });
    const p = player();
    await boot();
    await p.ready();

    // Arrives before the vocabulary store finished loading.
    p.line("Hello world again friend");
    await flush();

    expect(colour("Hello")).toBe("normal");
    expect(colour("world")).toBe("learned");
    expect(colour("again")).toBe("difficult");
    expect(colour("friend")).toBe("new");
    expect(worker.storage.settings).toMatchObject({ subtitleBottom: 40, highlightSpecialWords: false, autoPause: false });
    expect(phrases()).toEqual([expect.objectContaining({ id: "old", kind: "word", createdAt: "2020-01-01T00:00:00.000Z" })]);
  });

  it("C04 + C05: a new word is blue everywhere in its first line, and never again", async () => {
    worker = installStudyWorker();
    const p = player();
    await boot();
    await p.ready();

    p.line("Go, go, go!");
    await flush();
    const first = [...document.querySelectorAll(".sf-overlay .sf-word")].map((element) => element.className);
    expect(first.every((name) => name.includes("sf-word-new"))).toBe(true);

    p.line(null);
    p.line("Go, go, go!");
    await flush();

    expect(colour("Go")).toBe("normal");
  });

  it("C01: a fresh install has new words on, special words and auto-pause off", async () => {
    worker = installStudyWorker();

    const { data } = await requestStudy<{ settings: Record<string, unknown> }>("read");

    expect(data.settings).toMatchObject({ highlightNewWords: true, highlightSpecialWords: false, autoPause: false });
  });
});

describe("two tabs and the library", () => {
  it("P01 + L01: both tabs' marks survive, and the open library shows them without reload", async () => {
    worker = installStudyWorker();
    document.documentElement.innerHTML = libraryHtml;
    window.history.replaceState({}, "", "/library.html?tab=difficult");
    const library = new Function("studyRequest", "chrome", `${librarySource}\nreturn { refresh };`)(
      async (action: Parameters<typeof requestStudy>[0], payload: unknown) => (await requestStudy(action, payload)).data,
      chrome,
    ) as { refresh(): Promise<void> };
    await library.refresh();
    const tabOne = createVocabularyStore();
    const tabTwo = createVocabularyStore();
    await Promise.all([tabOne.ready, tabTwo.ready]);

    await Promise.all([
      tabOne.setMark("hello", "en", "difficult"),
      tabTwo.setMark("world", "en", "difficult"),
    ]);

    expect(vocabulary().languages.en.marks).toEqual({ hello: "difficult", world: "difficult" });
    await vi.waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(2));
    expect(tabOne.getMark("world", "en")).toBe("difficult");
    tabOne.dispose();
    tabTwo.dispose();
  });
});

describe("auto-pause with R and copy", () => {
  it("saves and copies the retained line, not the next one already in the DOM", async () => {
    worker = installStudyWorker({ settings: { autoPause: true } });
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const p = player();
    await boot();
    await p.ready();

    p.line("Where were you?");
    p.line("At home.");
    await flush();
    expect(p.adapter.pause).toHaveBeenCalledOnce();

    press("c", { ctrlKey: true });
    await flush();
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Where were you?");
    expect(document.querySelector(".sf-feedback")!.textContent).toBe("Copiado");

    press("r");
    await flush();
    expect(phrases()).toEqual([expect.objectContaining({ kind: "sentence", sentence: "Where were you?" })]);
    expect(document.querySelector(".sf-feedback")!.textContent).toBe("Fala salva");
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("Q toggles the stored preference in the worker, once per press", async () => {
    worker = installStudyWorker();
    const p = player();
    await boot();
    await p.ready();
    p.line("Hello");

    press("q");
    press("q");
    press("q");
    await flush();

    expect(worker.storage.settings).toMatchObject({ autoPause: true });
  });
});

describe("a session change with work in flight", () => {
  it("keeps a save asked for the old episode, without announcing it in the new one", async () => {
    worker = installStudyWorker();
    const p = player();
    await boot();
    await p.ready();
    p.line("Old episode line");
    await flush();
    const gate = deferred<void>();
    const write = worker.local.set.getMockImplementation()!;
    worker.local.set.mockImplementationOnce(async (items) => {
      await gate.promise;
      return write(items);
    });

    press("r");
    window.history.replaceState({}, "", "/watch/2");
    p.line("New episode line");
    gate.resolve();
    await flush();

    expect(phrases()).toEqual([expect.objectContaining({ sentence: "Old episode line" })]);
    expect(document.querySelector(".sf-feedback")!.textContent).not.toBe("Fala salva");
  });

  it("drops a lookup that finishes after the episode changed", async () => {
    worker = installStudyWorker();
    const pending = deferred<TranslationResult>();
    mocks.translateWord.mockReturnValue(pending.promise);
    const p = player();
    await boot();
    await p.ready();
    p.line("Old episode line");
    await flush();

    word("episode").click();
    window.history.replaceState({}, "", "/watch/2");
    p.line("New line");
    pending.resolve(lookup("episode", { translation: "episódio" }));
    await flush();

    expect(document.querySelector(".sf-card")!.classList.contains("sf-hidden")).toBe(true);
    expect(document.querySelector(".sf-card-translation")!.textContent).not.toBe("episódio");
  });
});

describe("S02: nothing new leaves the machine", () => {
  it("asks for exactly the three provider hosts and refuses the word-list sources", () => {
    expect(manifest.host_permissions.sort()).toEqual([
      "https://api.dictionaryapi.dev/*",
      "https://api.mymemory.translated.net/*",
      "https://clients5.google.com/*",
    ]);
    // unlimitedStorage lifts the 10 MB cap and keeps IndexedDB from eviction; it shows no install warning.
    expect(manifest.permissions).toEqual(["storage", "unlimitedStorage"]);
    for (const url of [
      "https://linglify.com/pt-BR/learn/en/blog/hard-english-words",
      "https://www.oxfordlearnersdictionaries.com/definition/english/ambiguous",
    ]) {
      expect(isAllowedProviderUrl(url)).toBe(false);
    }
  });
});

describe("demo build", () => {
  const coloured = () => [...document.querySelectorAll<HTMLElement>(".sf-overlay .sf-word")].filter((element) => colour(element.textContent!) !== "normal").map((element) => `${element.textContent}:${colour(element.textContent!)}`);

  it("keeps white in charge: one automatic colour, then white lines, while marks still show", async () => {
    mocks.demo = true;
    worker = installStudyWorker({ settings: { level: "A2", highlightSpecialWords: true } });
    const p = player();
    await boot();
    await p.ready();

    // In the normal build every word of a first line would be blue.
    p.line("The police found the victim.");
    await flush();
    expect(coloured()).toEqual(["victim:special"]);

    p.line("This murder is about family.");
    await flush();
    expect(coloured()).toEqual([]);

    rightClick("family");
    await flush();
    expect(coloured()).toEqual(["family:difficult"]);
    expect(vocabulary().languages.en.marks.family).toBe("difficult");
  });
});
