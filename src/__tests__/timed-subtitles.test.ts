/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimedSubtitleController, type TimedSubtitleView } from "../core/subtitles.ts";
import { createTimedSubtitles } from "../core/ui/timed-subtitles.ts";
import type { PlayerSnapshot } from "../core/player-types.ts";
import { translateSentence } from "../core/translation.ts";

vi.mock("../core/translation.ts", () => ({ translateSentence: vi.fn(async () => "Olá") }));
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const cue = { start: 1, end: 3, text: "Hello" };

function controller(translator = vi.fn(async (_text: string) => "Olá")) {
  let view: TimedSubtitleView = { source: "", translation: "", state: "idle" };
  const engine = new TimedSubtitleController(translator, (next) => { view = next; });
  engine.setSession("episode-1");
  engine.setSource([cue, { start: 5, end: 7, text: "Bye" }], "en");
  return { engine, translator, view: () => view };
}

describe("timed subtitle lifecycle", () => {
  it("requires both overlay and translation opt-in and only sends the active line", async () => {
    const c = controller();
    c.engine.tick(1);
    expect(c.view().source).toBe("");
    c.engine.setEnabled(true);
    await flush();
    expect(c.view().source).toBe("Hello");
    expect(c.translator).not.toHaveBeenCalled();
    c.engine.setTranslation(true);
    await flush();
    expect(c.translator).toHaveBeenCalledExactlyOnceWith("Hello");
    expect(c.view().translation).toBe("Olá");
    for (const time of [1, 1, 1.5, 2.99]) c.engine.tick(time);
    await flush();
    expect(c.translator).toHaveBeenCalledTimes(1);
    c.engine.tick(3);
    expect(c.view().source).toBe("");
  });

  it("follows seek in either direction and offset while preserving original timestamps", () => {
    const c = controller();
    c.engine.setEnabled(true);
    c.engine.tick(6);
    expect(c.view().source).toBe("Bye");
    c.engine.tick(1);
    expect(c.view().source).toBe("Hello");
    c.engine.setOffset(0.5);
    expect(c.view().source).toBe("");
    c.engine.tick(1.5);
    expect(c.view().source).toBe("Hello");
    expect(cue).toEqual({ start: 1, end: 3, text: "Hello" });
  });

  it.each(["session", "source", "disable", "destroy", "seek"])("discards pending replies after %s even when the text is identical", async (change) => {
    const pending: ((value: string) => void)[] = [];
    const c = controller(vi.fn((_text: string) => new Promise<string>((resolve) => pending.push(resolve))));
    c.engine.setEnabled(true);
    c.engine.setTranslation(true);
    c.engine.tick(1);
    await flush();
    expect(pending).toHaveLength(1);
    if (change === "session") { c.engine.setSession("episode-2"); c.engine.setSource([cue], "en"); }
    if (change === "source") c.engine.setSource([{ ...cue }], "en");
    if (change === "disable") c.engine.setTranslation(false);
    if (change === "destroy") c.engine.destroy();
    if (change === "seek") { c.engine.tick(4); c.engine.tick(1); }
    await flush();
    pending[0]("OLD TRANSLATION");
    await flush();
    expect(c.view().translation).not.toBe("OLD TRANSLATION");
    if (pending[1]) { pending[1]("Nova"); await flush(); expect(c.view().translation).toBe("Nova"); }
  });

  it("does not send a queued request after consent is withdrawn", async () => {
    const c = controller();
    c.engine.setEnabled(true);
    c.engine.tick(1);
    c.engine.setTranslation(true);
    c.engine.setTranslation(false);
    await flush();
    expect(c.translator).not.toHaveBeenCalled();
  });

  it("reports failure, keeps the original, and retries only on demand", async () => {
    const c = controller(vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("Olá"));
    c.engine.setEnabled(true);
    c.engine.setTranslation(true);
    c.engine.tick(1);
    await flush();
    expect(c.view()).toEqual({ source: "Hello", translation: "", state: "error" });
    c.engine.tick(1.5);
    await flush();
    expect(c.translator).toHaveBeenCalledTimes(1);
    c.engine.retry();
    await flush();
    expect(c.view().state).toBe("ready");
    expect(c.translator).toHaveBeenCalledTimes(2);
  });

  it("never translates a Portuguese source and clears source/offset on episode change", async () => {
    const c = controller();
    c.engine.setEnabled(true);
    c.engine.setTranslation(true);
    c.engine.setSource([{ ...cue, text: "Olá" }], "pt");
    c.engine.setOffset(5);
    c.engine.tick(6);
    await flush();
    expect(c.view().source).toBe("Olá");
    expect(c.translator).not.toHaveBeenCalled();
    c.engine.setSession("new");
    expect(c.view().source).toBe("");
    c.engine.setSource([cue], "pt");
    c.engine.tick(1);
    expect(c.view().source).toBe("Hello");
  });
});

let overlay: ReturnType<typeof createTimedSubtitles> | null = null;
afterEach(() => {
  overlay?.destroy();
  overlay = null;
  document.body.replaceChildren();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  vi.clearAllMocks();
});

function setup() {
  const video = document.createElement("video");
  document.body.appendChild(video);
  const track = { kind: "subtitles", mode: "showing", language: "en", label: "English", cues: [{ startTime: 1, endTime: 3, text: "Hello <img src=x onerror=alert(1)>" }] } as unknown as TextTrack;
  const state: PlayerSnapshot = { video, sessionKey: "ep1", currentTime: 1, paused: true, playbackRate: 1, tracks: [track], status: "ready" };
  overlay = createTimedSubtitles();
  overlay.updatePlayer(state);
  const host = document.querySelector<HTMLElement>("[data-streamfluent-timed]")!;
  const shadow = host.shadowRoot!;
  const get = <T extends HTMLElement>(name: string) => shadow.querySelector<T>(`[data-control="${name}"]`)!;
  const change = (name: string, value: boolean | string) => {
    const el = get<HTMLInputElement | HTMLSelectElement>(name);
    if (typeof value === "boolean") (el as HTMLInputElement).checked = value;
    else el.value = value;
    el.dispatchEvent(new Event("change"));
  };
  change("source", "0");
  return { state, track, host, shadow, get, change };
}

describe("player subtitle UI", () => {
  it("restores native captions when the selected track becomes unreadable", () => {
    const c = setup();
    c.change("enabled", true);
    expect(c.track.mode).toBe("hidden");
    Object.defineProperty(c.track, "cues", { get: () => { throw new Error("unreadable"); } });
    overlay!.updatePlayer({ ...c.state, currentTime: 2 });
    expect(c.track.mode).toBe("showing");
    expect(c.shadow.querySelector(".source")?.textContent).toBe("");
  });

  it("does not offer metadata or chapter tracks as subtitles", () => {
    const c = setup();
    const metadata = { ...c.track, kind: "metadata", label: "Private chapter data" } as TextTrack;
    overlay!.updatePlayer({ ...c.state, tracks: [c.track, metadata] });
    expect(c.get<HTMLSelectElement>("source").options).toHaveLength(2);
    expect(c.get("source").textContent).not.toContain("Private chapter data");
  });

  it("imports local multiline text, keeps a valid source after errors, and drops stale file reads", async () => {
    const c = setup();
    c.change("enabled", true);
    const input = c.get<HTMLInputElement>("file");
    const bytes = (text: string) => new TextEncoder().encode(text).buffer;
    const load = (name: string, arrayBuffer: () => Promise<ArrayBuffer>) => {
      Object.defineProperty(input, "files", { configurable: true, value: [{ name, size: 100, arrayBuffer }] });
      input.dispatchEvent(new Event("change"));
    };
    load("example.srt", async () => bytes("1\n00:00:01,000 --> 00:00:03,000\nAção\nSegunda linha"));
    await flush();
    expect(c.get<HTMLSelectElement>("source").value).toBe("file");
    expect(c.shadow.querySelector(".source")?.textContent).toBe("Ação\nSegunda linha");
    load("broken.srt", async () => bytes("invalid"));
    await flush();
    expect(c.get("file-status").textContent).toContain("fonte anterior foi mantida");
    expect(c.shadow.querySelector(".source")?.textContent).toBe("Ação\nSegunda linha");
    let resolve!: (buffer: ArrayBuffer) => void;
    load("old.srt", () => new Promise((done) => { resolve = done; }));
    overlay!.updatePlayer({ ...c.state, sessionKey: "ep2" });
    resolve(bytes("1\n00:00:01,000 --> 00:00:03,000\nOld episode"));
    await flush();
    expect(c.get<HTMLSelectElement>("source").value).toBe("");
    expect(c.shadow.querySelector(".source")?.textContent).toBe("");
    expect(c.get("file-status").textContent).toBe("");
  });

  it("uses accessible track cues safely and restores native mode on disable/destroy", async () => {
    const c = setup();
    expect(c.track.mode).toBe("showing");
    c.change("enabled", true);
    expect(c.track.mode).toBe("hidden");
    expect(c.shadow.querySelector(".source")?.textContent).toBe("Hello <img src=x onerror=alert(1)>");
    expect(c.shadow.querySelector("img")).toBeNull();
    expect(translateSentence).not.toHaveBeenCalled();
    c.change("translate", true);
    await flush();
    expect(translateSentence).toHaveBeenCalledWith("Hello <img src=x onerror=alert(1)>", "en-pt");
    c.change("enabled", false);
    expect(c.track.mode).toBe("showing");
    c.change("enabled", true);
    overlay!.destroy();
    expect(c.track.mode).toBe("showing");
    expect(document.querySelector("[data-streamfluent-timed]")).toBeNull();
  });

  it("implements the labelled half-second controls and resets on episode transition", () => {
    const c = setup();
    c.change("enabled", true);
    c.get("later").click();
    expect(c.get("offset").textContent).toBe("Ajuste: +0,5 s");
    expect(c.shadow.querySelector(".source")?.textContent).toBe("");
    c.get("earlier").click();
    expect(c.shadow.querySelector(".source")?.textContent).toContain("Hello");
    c.get("earlier").click();
    expect(c.get("offset").textContent).toBe("Ajuste: -0,5 s");
    c.get("reset").click();
    expect(c.get("offset").textContent).toBe("Ajuste: 0,0 s");
    c.get("later").click();
    overlay!.updatePlayer({ ...c.state, sessionKey: "ep2" });
    expect(c.get("offset").textContent).toBe("Ajuste: 0,0 s");
    expect(c.get<HTMLSelectElement>("source").value).toBe("");
    expect(c.track.mode).toBe("showing");
    expect(c.shadow.querySelector(".source")?.textContent).toBe("");
  });

  it("mounts in container fullscreen, restores native subtitles for direct video fullscreen", () => {
    const c = setup();
    c.change("enabled", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.appendChild(c.state.video!);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: container });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(c.host.parentElement).toBe(container);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: c.state.video });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(c.track.mode).toBe("showing");
    expect(c.shadow.querySelector<HTMLElement>(".captions")?.hidden).toBe(true);
    expect(c.get("status").textContent).toContain("Tela cheia nativa");
  });

  it("moves into the video's same-origin document and prevents duplicate interfaces", () => {
    const c = setup();
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const frameDocument = frame.contentDocument!;
    const video = frameDocument.createElement("video");
    frameDocument.body.appendChild(video);
    overlay!.updatePlayer({ ...c.state, video, sessionKey: "frame" });
    expect(c.host.ownerDocument).toBe(frameDocument);
    expect(frameDocument.querySelectorAll("[data-streamfluent-timed]")).toHaveLength(1);
    overlay = createTimedSubtitles();
    expect(frameDocument.querySelectorAll("[data-streamfluent-timed]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-streamfluent-timed]")).toHaveLength(1);
  });
});
