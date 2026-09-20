/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeHtml5Player } from "../adapters/html5-player.ts";
import type { PlayerSnapshot } from "../core/player-types.ts";

function mockTracks(tracks: TextTrack[] = []): TextTrackList {
  const list = new EventTarget();
  Object.defineProperty(list, "length", { get: () => tracks.length });
  Object.defineProperty(list, Symbol.iterator, { value: () => tracks[Symbol.iterator]() });
  return list as TextTrackList;
}

function makeVideo(width = 640, height = 360, doc = document): HTMLVideoElement {
  const video = doc.createElement("video");
  Object.defineProperty(video, "textTracks", { value: mockTracks(), configurable: true });
  Object.defineProperty(video, "paused", { value: true, writable: true });
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height,
    toJSON: () => ({}),
  });
  doc.body.append(video);
  return video;
}

function blockedFrame(source?: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  // Mock the DOM URL rather than navigating the fixture to an external resource.
  const getAttribute = frame.getAttribute.bind(frame);
  vi.spyOn(frame, "getAttribute").mockImplementation((name) =>
    name === "src" ? source ?? null : getAttribute(name));
  Object.defineProperty(frame, "contentDocument", { get: () => null });
  document.body.append(frame);
  return frame;
}

describe("HTML5 player observation", () => {
  let stop: (() => void) | undefined;
  let states: PlayerSnapshot[];
  const latest = (): PlayerSnapshot => states[states.length - 1];
  const start = (options?: { includeFrames?: boolean }): void => {
    stop = observeHtml5Player((state) => states.push(state), options);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    history.replaceState({}, "", "/watch/62560?ep=8");
    states = [];
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("discovers a dynamically inserted main video and ignores hidden players", () => {
    start();
    expect(latest().video).toBeNull();
    expect(latest().status).toContain("Aguardando");
    makeVideo(150, 100);
    const hidden = makeVideo(1200, 600);
    const wrapper = document.createElement("div");
    wrapper.style.display = "none";
    document.body.append(wrapper);
    wrapper.append(hidden);
    const main = makeVideo(800, 450);
    vi.advanceTimersByTime(500);
    expect(latest().video).toBe(main);
    expect(latest().status).toContain("conectado");
  });

  it("reports real seconds during playback, pause, seek and speed changes", () => {
    const video = makeVideo();
    start();
    Object.defineProperty(video, "paused", { value: false, writable: true });
    video.dispatchEvent(new Event("play"));
    expect(latest().paused).toBe(false);
    video.currentTime = 12.375;
    vi.advanceTimersByTime(50);
    expect(latest().currentTime).toBe(12.375);
    video.playbackRate = 1.5;
    video.dispatchEvent(new Event("ratechange"));
    expect(latest().playbackRate).toBe(1.5);
    video.currentTime = 2.5;
    video.dispatchEvent(new Event("seeking"));
    expect(latest().currentTime).toBe(2.5);
    Object.defineProperty(video, "paused", { value: true });
    video.dispatchEvent(new Event("pause"));
    expect(latest().paused).toBe(true);
    const count = states.length;
    vi.advanceTimersByTime(1000);
    expect(states).toHaveLength(count);
  });

  it("invalidates the session for query, hash, source and element changes", () => {
    const video = makeVideo();
    start();
    const keys = [latest().sessionKey];
    history.pushState({}, "", "/watch/62560?ep=9");
    vi.advanceTimersByTime(50);
    keys.push(latest().sessionKey);
    history.pushState({}, "", "/watch/62560?ep=9#alternate");
    vi.advanceTimersByTime(50);
    keys.push(latest().sessionKey);
    video.setAttribute("src", "/episode-9.mp4");
    video.dispatchEvent(new Event("emptied"));
    keys.push(latest().sessionKey);
    Object.defineProperty(video, "currentSrc", { value: "https://media.example/ep9.mp4" });
    video.dispatchEvent(new Event("loadedmetadata"));
    keys.push(latest().sessionKey);
    video.remove();
    makeVideo();
    vi.advanceTimersByTime(500);
    keys.push(latest().sessionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reads a same-origin frame player and invalidates a frame episode URL change", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const frameDoc = frame.contentDocument!;
    const video = makeVideo(640, 360, frameDoc);
    start();
    expect(latest().video).toBe(video);
    const key = latest().sessionKey;
    frameDoc.location.hash = "episode-2";
    vi.advanceTimersByTime(50);
    expect(latest().sessionKey).not.toBe(key);
    frame.remove();
    vi.advanceTimersByTime(500);
    expect(latest().video).toBeNull();
  });

  it("selects the local video and never reads descendant frames in document-only mode", () => {
    const localVideo = makeVideo(640, 360);
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const frameDoc = frame.contentDocument!;
    makeVideo(1200, 700, frameDoc);
    const readFrame = vi.fn(() => frameDoc);
    Object.defineProperty(frame, "contentDocument", { get: readFrame });
    start({ includeFrames: false });
    expect(latest().video).toBe(localVideo);
    expect(readFrame).not.toHaveBeenCalled();
    localVideo.currentTime = 4.5;
    localVideo.dispatchEvent(new Event("timeupdate"));
    expect(latest().currentTime).toBe(4.5);
    localVideo.remove();
    vi.advanceTimersByTime(500);
    expect(latest().video).toBeNull();
    expect(readFrame).not.toHaveBeenCalled();
    expect(latest().status).not.toContain("iframe inacessível");
  });

  it("does not discover descendant video when document-only mode has no local player", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    makeVideo(640, 360, frame.contentDocument!);
    const readFrame = vi.spyOn(frame, "contentDocument", "get");
    start({ includeFrames: false });
    vi.advanceTimersByTime(1000);
    expect(latest().video).toBeNull();
    expect(readFrame).not.toHaveBeenCalled();
  });

  it("cleans document-only media/track listeners and timers", () => {
    const localVideo = makeVideo();
    const track = new EventTarget() as TextTrack;
    Object.defineProperty(localVideo, "textTracks", { value: mockTracks([track]) });
    start({ includeFrames: false });
    const count = states.length;
    stop!();
    localVideo.currentTime = 20;
    localVideo.dispatchEvent(new Event("timeupdate"));
    localVideo.textTracks.dispatchEvent(new Event("change"));
    track.dispatchEvent(new Event("cuechange"));
    vi.advanceTimersByTime(1500);
    expect(states).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("explains inaccessible cross-origin frames without trying to fetch their URLs", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    Object.defineProperty(frame, "contentDocument", {
      get: () => { throw new DOMException("Blocked a frame", "SecurityError"); },
    });
    start();
    expect(latest().video).toBeNull();
    expect(latest().status).toContain("iframe inacessível (outro domínio, sandbox ou redirecionamento)");
  });

  it("reports only unique HTTP(S) origins, excluding credentials, paths, queries and fragments", () => {
    blockedFrame("https://alice:secret@player.example:8443/private-episode?token=sensitive#session");
    blockedFrame("https://player.example:8443/other?key=another-secret");
    blockedFrame("http://alternate.example/embed?auth=private");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    start();
    const status = latest().status;
    expect(status).toContain("Origens declaradas dos iframes inacessíveis: http://alternate.example, https://player.example:8443.");
    expect(status.match(/https:\/\/player\.example:8443/g)).toHaveLength(1);
    for (const value of ["alice", "secret", "private-episode", "token", "sensitive", "session", "auth", "?", "#"]) {
      expect(status).not.toContain(value);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not include origins of hidden frames or accessible frames", () => {
    const hidden = blockedFrame("https://hidden.example/embed");
    hidden.style.display = "none";
    const accessible = document.createElement("iframe");
    document.body.append(accessible);
    const getAttribute = accessible.getAttribute.bind(accessible);
    vi.spyOn(accessible, "getAttribute").mockImplementation((name) =>
      name === "src" ? "https://accessible.example/player" : getAttribute(name));
    blockedFrame("https://visible.example/embed");
    start();
    expect(latest().status).toContain("https://visible.example");
    expect(latest().status).not.toContain("hidden.example");
    expect(latest().status).not.toContain("accessible.example");
  });

  it.each([undefined, "", "   ", "about:blank", "data:text/html,private", "javascript:alert(1)",
    "blob:https://private.example/session", "file:///private/movie", "https://["])(
    "keeps the basic status for an absent, invalid or non-HTTP(S) frame source (%s)", (source) => {
      blockedFrame(source);
      start();
      expect(latest().status).toContain("iframe inacessível (outro domínio, sandbox ou redirecionamento)");
      expect(latest().status).not.toContain("Origens");
    },
  );

  it("keeps the basic status for srcdoc and an unreadable src", () => {
    const inline = blockedFrame("https://ignored.example/private");
    inline.setAttribute("srcdoc", "<p>Sandbox document</p>");
    const unreadable = blockedFrame("https://unreadable.example");
    vi.spyOn(unreadable, "getAttribute").mockImplementation(() => {
      throw new DOMException("Unavailable", "SecurityError");
    });
    start();
    expect(latest().status).toContain("iframe inacessível (outro domínio, sandbox ou redirecionamento)");
    expect(latest().status).not.toContain("Origens");
  });

  it("updates on track loading, additions, removals, mode changes and cue changes", () => {
    const video = makeVideo();
    const track = new EventTarget() as TextTrack;
    const tracks: TextTrack[] = [];
    const list = mockTracks(tracks);
    Object.defineProperty(video, "textTracks", { value: list });
    start();
    tracks.push(track);
    list.dispatchEvent(new Event("addtrack"));
    expect(latest().tracks).toEqual([track]);
    const count = states.length;
    track.dispatchEvent(new Event("cuechange"));
    list.dispatchEvent(new Event("change"));
    const trackElement = document.createElement("track");
    video.append(trackElement);
    trackElement.dispatchEvent(new Event("load"));
    expect(states).toHaveLength(count + 3);
    tracks.pop();
    list.dispatchEvent(new Event("removetrack"));
    expect(latest().tracks).toEqual([]);
    const removedCount = states.length;
    track.dispatchEvent(new Event("cuechange"));
    expect(states).toHaveLength(removedCount);
  });

  it("removes listeners from replaced players and cancels every timer on cleanup", () => {
    const oldVideo = makeVideo();
    const track = new EventTarget() as TextTrack;
    Object.defineProperty(oldVideo, "textTracks", { value: mockTracks([track]) });
    start();
    oldVideo.remove();
    const nextVideo = makeVideo();
    vi.advanceTimersByTime(500);
    const replacementCount = states.length;
    oldVideo.dispatchEvent(new Event("timeupdate"));
    track.dispatchEvent(new Event("cuechange"));
    expect(states).toHaveLength(replacementCount);
    stop!();
    nextVideo.currentTime = 10;
    nextVideo.dispatchEvent(new Event("timeupdate"));
    vi.advanceTimersByTime(2000);
    expect(states).toHaveLength(replacementCount);
    expect(vi.getTimerCount()).toBe(0);
  });
});
