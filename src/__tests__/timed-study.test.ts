/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTimedSubtitles } from "../core/ui/timed-subtitles.ts";
import type { PlayerSnapshot } from "../core/player-types.ts";
import { translateSentence, translateWord } from "../core/translation.ts";
import { installStudyWorker } from "./helpers/study-worker.ts";

vi.mock("../core/translation.ts", () => ({
  translateSentence: vi.fn(async () => "Olá"),
  translateWord: vi.fn(async (word: string) => ({ word, translation: "tradução", phonetic: "", definition: "", example: "", error: null })),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

let overlay: ReturnType<typeof createTimedSubtitles> | null = null;
afterEach(() => {
  overlay?.destroy();
  overlay = null;
  document.body.replaceChildren();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** A player the test drives: its clock moves only through updatePlayer(). */
function setup(storage: Record<string, unknown> = {}, cues = [
  { startTime: 1, endTime: 3, text: "Hello ambiguous world" },
  { startTime: 4, endTime: 6, text: "Second line" },
]) {
  const worker = installStudyWorker(storage);
  const video = document.createElement("video");
  let paused = true;
  Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(video, "duration", { configurable: true, value: 60 });
  video.play = vi.fn(async () => {
    paused = false;
    video.dispatchEvent(new Event("play"));
  });
  video.pause = vi.fn(() => { paused = true; });
  document.body.appendChild(video);
  const track = { kind: "subtitles", mode: "showing", language: "en", label: "English", cues } as unknown as TextTrack;
  let state: PlayerSnapshot = {
    video, sessionKey: "ep1", currentTime: 0, paused: true, seeking: false, playbackRate: 1, tracks: [track], status: "ready",
  };
  overlay = createTimedSubtitles();
  overlay.updatePlayer(state);
  const shadow = document.querySelector<HTMLElement>("[data-streamfluent-timed]")!.shadowRoot!;
  const control = <T extends HTMLElement>(name: string) => shadow.querySelector<T>(`[data-control="${name}"]`)!;
  const change = (name: string, value: boolean | string) => {
    const element = control<HTMLInputElement>(name);
    if (typeof value === "boolean") element.checked = value;
    else element.value = value;
    element.dispatchEvent(new Event("change"));
  };
  change("source", "0");
  change("enabled", true);

  const at = (currentTime: number, playing = !paused) => {
    video.currentTime = currentTime;
    state = { ...state, currentTime, paused: !playing };
    paused = !playing;
    overlay!.updatePlayer(state);
  };
  const play = (from: number, to: number) => {
    for (let time = from; time <= to + 1e-9; time += 0.05) at(Math.round(time * 1000) / 1000, true);
  };
  const words = () => [...shadow.querySelectorAll<HTMLElement>(".sf-word")];
  const word = (text: string) => words().find((element) => element.textContent === text)!;
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
    document.body.dispatchEvent(event);
    return event;
  };
  return { worker, video, track, shadow, control, change, at, play, words, word, press, setState: (next: Partial<PlayerSnapshot>) => { state = { ...state, ...next }; overlay!.updatePlayer(state); } };
}

describe("H01: words on the HTML5 layer", () => {
  it("renders the original line as clickable words inside its own shadow root", async () => {
    const c = setup();

    c.at(1.5);

    expect(c.words().map((element) => element.textContent)).toEqual(["Hello", "ambiguous", "world"]);
    expect(document.querySelectorAll(".sf-word")).toHaveLength(0);
    expect(c.shadow.querySelector(".source")!.textContent).toBe("Hello ambiguous world");
  });

  it("colours first-ever words blue, and only their first occurrence", async () => {
    const c = setup();
    c.at(1.5);
    await flush();
    expect(c.word("Hello").classList.contains("sf-word-new")).toBe(true);

    c.at(3.5);
    c.at(1.5);
    await flush();

    expect(c.word("Hello").classList.contains("sf-word-new")).toBe(false);
  });

  it("shows special words in lilac only for English, when the option is on", async () => {
    const c = setup({ settings: { highlightSpecialWords: true } });
    c.at(1.5);
    await flush();
    expect(c.word("ambiguous").classList.contains("sf-word-special")).toBe(true);

    c.change("language", "pt");
    c.at(1.6);
    await flush();

    expect(c.word("ambiguous").classList.contains("sf-word-special")).toBe(false);
  });

  it("marks a word difficult on right click, offline, without a lookup", async () => {
    const c = setup();
    c.at(1.5);

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true });
    c.word("world").dispatchEvent(event);
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(translateWord).not.toHaveBeenCalled();
    const vocabulary = c.worker.storage.vocabulary as { languages: Record<string, { marks: Record<string, string> }> };
    expect(vocabulary.languages.en.marks.world).toBe("difficult");
    expect(c.word("world").classList.contains("sf-word-difficult")).toBe(true);
    expect(c.worker.storage.phrases ?? []).toEqual([]);
  });

  it("keys Portuguese marks under pt-BR", async () => {
    const c = setup({}, [{ startTime: 1, endTime: 3, text: "Meu coração" }]);
    c.change("language", "pt");
    c.at(1.5);

    c.word("coração").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true }));
    await flush();

    const vocabulary = c.worker.storage.vocabulary as { languages: Record<string, { marks: Record<string, string> }> };
    expect(vocabulary.languages["pt-BR"].marks["coração"]).toBe("difficult");
  });

  it("opens the card in the shadow root on left click without turning on line translation", async () => {
    const c = setup();
    c.at(1.5);

    c.word("world").click();
    await flush();

    const card = c.shadow.querySelector<HTMLElement>(".sf-card")!;
    expect(card.classList.contains("sf-hidden")).toBe(false);
    expect(card.querySelector(".sf-card-word")!.textContent).toBe("world");
    expect(translateWord).toHaveBeenCalledWith("world", "en-pt");
    expect(translateSentence).not.toHaveBeenCalled();
  });
});

describe("H01: shortcuts and auto-pause on the HTML5 layer", () => {
  it("R saves the whole line; D moves exactly five seconds", async () => {
    const c = setup();
    c.at(1.5);

    expect(c.press("r").defaultPrevented).toBe(true);
    await flush();
    expect(c.worker.storage.phrases).toEqual([expect.objectContaining({ kind: "sentence", sentence: "Hello ambiguous world", platform: "HTML5", timeSeconds: 1 })]);

    c.press("d");
    await flush();
    expect(c.video.currentTime).toBe(6.5);
  });

  it("S goes back to the real cue start and plays once", async () => {
    const c = setup();
    c.at(2.5);

    c.press("s");
    await vi.waitFor(() => expect(c.video.play).toHaveBeenCalledOnce());

    expect(c.video.currentTime).toBe(0.75);
  });

  it("A01: pauses once at the cue's end and keeps the line for R", async () => {
    const c = setup({ settings: { autoPause: true } });
    await flush();

    c.play(1, 3.05);
    await flush();

    expect(c.video.pause).toHaveBeenCalledOnce();
    c.at(3.05, false);
    expect(c.shadow.querySelector(".source")!.textContent).toBe("Hello ambiguous world");
    c.press("r");
    await flush();
    expect(c.worker.storage.phrases).toEqual([expect.objectContaining({ sentence: "Hello ambiguous world" })]);
  });

  it("A03: resuming releases the retained line and does not pause again at the same end", async () => {
    const c = setup({ settings: { autoPause: true } });
    await flush();
    c.play(2.9, 3.05);
    await flush();
    c.at(3.05, false);

    await c.video.play();
    c.play(3.1, 3.5);

    expect(c.shadow.querySelector(".source")!.textContent).toBe("");
    expect(c.video.pause).toHaveBeenCalledOnce();
  });

  it("H03: in native video fullscreen there is no auto-pause and R is left alone", async () => {
    const c = setup({ settings: { autoPause: true } });
    await flush();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: c.video });
    document.dispatchEvent(new Event("fullscreenchange"));

    c.play(2.9, 3.1);
    await flush();

    expect(c.video.pause).not.toHaveBeenCalled();
    expect(c.press("r").defaultPrevented).toBe(false);
    expect(c.track.mode).toBe("showing");
  });

  it("leaves keys alone while the layer is disabled", () => {
    const c = setup();
    c.at(1.5);
    c.change("enabled", false);

    expect(c.press("d").defaultPrevented).toBe(false);
  });
});

describe("H02: ownership and cleanup", () => {
  it("destroy restores tracks and removes the UI and every listener", async () => {
    const c = setup();
    c.at(1.5);
    expect(c.track.mode).toBe("hidden");

    overlay!.destroy();
    overlay = null;

    expect(c.track.mode).toBe("showing");
    expect(document.querySelector("[data-streamfluent-timed]")).toBeNull();
    expect(c.press("r").defaultPrevented).toBe(false);
    await flush();
    expect(c.worker.storage.phrases ?? []).toEqual([]);
  });

  it("a new owner leaves exactly one router: D moves five seconds, not ten", async () => {
    const routers = new Set<EventListenerOrEventListenerObject>();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "keydown" && options === true && listener) routers.add(listener);
      add(type, listener, options);
    });
    vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, options) => {
      if (type === "keydown" && options === true && listener) routers.delete(listener);
      remove(type, listener, options);
    });
    const c = setup();
    c.at(1.5);
    expect(routers.size).toBe(1);

    // The previous instance is destroyed by the new one.
    overlay = createTimedSubtitles();
    c.setState({});
    const shadow = document.querySelector<HTMLElement>("[data-streamfluent-timed]")!.shadowRoot!;
    const source = shadow.querySelector<HTMLSelectElement>('[data-control="source"]')!;
    source.value = "0";
    source.dispatchEvent(new Event("change"));
    const enabled = shadow.querySelector<HTMLInputElement>('[data-control="enabled"]')!;
    enabled.checked = true;
    enabled.dispatchEvent(new Event("change"));

    c.press("d");
    await flush();

    expect(document.querySelectorAll("[data-streamfluent-timed]")).toHaveLength(1);
    expect(routers.size).toBe(1);
    expect(c.video.currentTime).toBe(6.5);

    overlay!.destroy();
    overlay = null;
    expect(routers.size).toBe(0);
    vi.restoreAllMocks();
  });

  it("a new episode drops the retained line and pending lookups", async () => {
    const c = setup({ settings: { autoPause: true } });
    await flush();
    c.play(2.9, 3.05);
    await flush();

    c.setState({ sessionKey: "ep2", currentTime: 0 });

    expect(c.shadow.querySelector(".source")!.textContent).toBe("");
    expect(c.press("r").defaultPrevented).toBe(false);
  });
});

describe("frames and focus", () => {
  it("listens in the document that holds the video, not the top one", async () => {
    installStudyWorker();
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const video = frame.contentDocument!.createElement("video");
    Object.defineProperty(video, "duration", { configurable: true, value: 60 });
    frame.contentDocument!.body.appendChild(video);
    video.currentTime = 1.5;
    const track = { kind: "subtitles", mode: "showing", language: "en", label: "English", cues: [{ startTime: 1, endTime: 3, text: "Inside the frame" }] } as unknown as TextTrack;
    overlay = createTimedSubtitles();
    overlay.updatePlayer({ video, sessionKey: "frame", currentTime: 1.5, paused: true, seeking: false, playbackRate: 1, tracks: [track], status: "ready" });
    const shadow = frame.contentDocument!.querySelector<HTMLElement>("[data-streamfluent-timed]")!.shadowRoot!;
    const source = shadow.querySelector<HTMLSelectElement>('[data-control="source"]')!;
    source.value = "0";
    source.dispatchEvent(new Event("change"));
    const enabled = shadow.querySelector<HTMLInputElement>('[data-control="enabled"]')!;
    enabled.checked = true;
    enabled.dispatchEvent(new Event("change"));

    const press = (target: Document) => {
      const event = new (target.defaultView as typeof window).KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true });
      target.body.dispatchEvent(event);
      return event;
    };

    expect(press(document).defaultPrevented).toBe(false);
    expect(press(frame.contentDocument!).defaultPrevented).toBe(true);
    await flush();
    expect(video.currentTime).toBe(6.5);
  });
});

describe("HTML5 controls placement", () => {
  it("fades the SF button while the mouse rests and keeps clicks from the player", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const c = setup();
    const fab = c.shadow.querySelector<HTMLButtonElement>(".fab")!;
    vi.advanceTimersByTime(3000);
    expect(fab.classList.contains("sf-idle")).toBe(true);

    document.dispatchEvent(new MouseEvent("mousemove"));
    expect(fab.classList.contains("sf-idle")).toBe(false);

    const playerClick = vi.fn();
    document.body.addEventListener("click", playerClick);
    fab.click();
    expect(playerClick).not.toHaveBeenCalled();
    document.body.removeEventListener("click", playerClick);
    vi.useRealTimers();
  });
});
