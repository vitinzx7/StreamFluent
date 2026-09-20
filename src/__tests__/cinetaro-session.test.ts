/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerSnapshot } from "../core/player-types.ts";
import { startCinetaroTop, startEmbeddedPlayer } from "../content/cinetaro-session.ts";

const mocks = vi.hoisted(() => ({ observe: vi.fn(), create: vi.fn() }));
vi.mock("../adapters/html5-player.ts", () => ({ observeHtml5Player: mocks.observe }));
vi.mock("../core/ui/timed-subtitles.ts", () => ({ createTimedSubtitles: mocks.create }));

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) => boolean;
let listeners: Set<Listener>;
let emit: (state: PlayerSnapshot) => void;
let send: ReturnType<typeof vi.fn>;
let stopPlayer: ReturnType<typeof vi.fn>;
let overlays: { updatePlayer: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[];
let cleanup: (() => void) | undefined;
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const state = (video: HTMLVideoElement | null = null, sessionKey = "local-1"): PlayerSnapshot => ({
  video, sessionKey, currentTime: 1, paused: true, playbackRate: 1, tracks: [], status: "Aguardando player",
});
function message(value: unknown, sender: chrome.runtime.MessageSender = { id: "extension" }) {
  const reply = vi.fn();
  for (const listener of listeners) listener(value, sender, reply);
  return reply.mock.calls[0]?.[0];
}
const offer = (token = "one", documentId = "document-one", active = true) => ({
  type: "sf:frame-offer", token, documentId, active, frameId: 2,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  history.replaceState({}, "", "/watch/1?ep=1");
  listeners = new Set();
  overlays = [];
  stopPlayer = vi.fn();
  send = vi.fn().mockResolvedValue({ granted: true, sessionKey: "parent-1" });
  vi.stubGlobal("chrome", { runtime: {
    id: "extension", sendMessage: send,
    onMessage: { addListener: (listener: Listener) => listeners.add(listener), removeListener: (listener: Listener) => listeners.delete(listener) },
  } });
  mocks.observe.mockImplementation((callback: typeof emit) => { emit = callback; emit(state()); return stopPlayer; });
  mocks.create.mockImplementation(() => {
    const overlay = { updatePlayer: vi.fn(), destroy: vi.fn() };
    overlays.push(overlay);
    return overlay;
  });
});
afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await flush();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Cinetaro top coordination", () => {
  it("elects one exact frame document and restores the parent UI on release", () => {
    cleanup = startCinetaroTop();
    expect(overlays).toHaveLength(1);
    expect(message(offer())).toMatchObject({ granted: true });
    expect(overlays[0].destroy).toHaveBeenCalledTimes(1);
    expect(message(offer("other", "document-two"))).toMatchObject({ granted: false });
    message(offer("one", "wrong-document", false));
    expect(overlays).toHaveLength(1);
    message(offer("one", "document-one", false));
    expect(overlays).toHaveLength(2);
  });

  it("prefers an accessible local player and ignores untrusted senders", () => {
    cleanup = startCinetaroTop();
    expect(message(offer(), { id: "other-extension" })).toBeUndefined();
    expect(message(offer(), { id: "extension", tab: { id: 7 } as chrome.tabs.Tab })).toBeUndefined();
    emit(state(document.createElement("video")));
    expect(message(offer())).toMatchObject({ granted: false });
    expect(overlays[0].destroy).not.toHaveBeenCalled();
  });

  it("expires a vanished owner and does not let a late release evict its replacement", () => {
    cleanup = startCinetaroTop();
    message(offer());
    vi.advanceTimersByTime(2500);
    expect(overlays).toHaveLength(2);
    expect(message(offer("new", "document-two"))).toMatchObject({ granted: true });
    message(offer("one", "document-one", false));
    expect(overlays).toHaveLength(2);
    expect(message(offer("third", "document-three"))).toMatchObject({ granted: false });
  });

  it("pushes an opaque episode session to its exact owner and cleans resources", () => {
    cleanup = startCinetaroTop();
    const initial = message(offer());
    history.pushState({}, "", "/watch/1?ep=2&private=not-forwarded");
    emit(state(null, "local-2"));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "sf:frame-session", token: "one", frameId: 2, documentId: "document-one",
    }));
    expect(send.mock.calls[0][0].sessionKey).not.toBe(initial.sessionKey);
    expect(JSON.stringify(send.mock.calls)).not.toContain("private");
    cleanup();
    cleanup = undefined;
    expect(listeners.size).toBe(0);
    expect(stopPlayer).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("embedded cinextream player", () => {
  it("renders inside the frame only after the top grants ownership", async () => {
    cleanup = startEmbeddedPlayer();
    expect(mocks.observe).toHaveBeenCalledWith(expect.any(Function), { includeFrames: false });
    expect(overlays).toHaveLength(0);
    const video = document.createElement("video");
    emit(state(video));
    await flush();
    expect(overlays).toHaveLength(1);
    expect(overlays[0].updatePlayer).toHaveBeenLastCalledWith(expect.objectContaining({ video, sessionKey: "parent-1|local-1" }));
    emit({ ...state(video), currentTime: 6 });
    expect(overlays[0].updatePlayer).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 6 }));
  });

  it("does not show an interface when opened under an unsupported parent", async () => {
    send.mockResolvedValue({ granted: false, sessionKey: "" });
    cleanup = startEmbeddedPlayer();
    emit(state(document.createElement("video")));
    await flush();
    expect(overlays).toHaveLength(0);
  });

  it("invalidates subtitle state on an episode push and ignores the older lease reply", async () => {
    cleanup = startEmbeddedPlayer();
    emit(state(document.createElement("video")));
    await flush();
    const token = send.mock.calls.find(([msg]) => msg.active)?.[0].token;
    let resolve!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    vi.advanceTimersByTime(500);
    message({ type: "sf:frame-session", token, sessionKey: "parent-2" });
    expect(overlays[0].updatePlayer).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: "parent-2|local-1" }));
    resolve({ granted: true, sessionKey: "parent-1" });
    await flush();
    expect(overlays[0].updatePlayer).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: "parent-2|local-1" }));
  });

  it("drops an expired lease before the top may reassign it", async () => {
    cleanup = startEmbeddedPlayer();
    emit(state(document.createElement("video")));
    await flush();
    send.mockImplementation(() => new Promise(() => {}));
    vi.advanceTimersByTime(1500);
    await flush();
    expect(overlays[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects late grants after video replacement and after teardown", async () => {
    let resolve!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    cleanup = startEmbeddedPlayer();
    emit(state(document.createElement("video")));
    const oldToken = send.mock.calls[0][0].token;
    emit(state(document.createElement("video"), "local-2"));
    resolve({ granted: true, sessionKey: "old-parent" });
    await flush();
    expect(overlays).toHaveLength(0);
    expect(send).toHaveBeenCalledWith({ type: "sf:frame-lease", active: false, token: oldToken });
    cleanup();
    cleanup = undefined;
    expect(listeners.size).toBe(0);
    expect(stopPlayer).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not recreate the UI from a grant arriving after cleanup", async () => {
    let resolve!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    cleanup = startEmbeddedPlayer();
    emit(state(document.createElement("video")));
    cleanup();
    cleanup = undefined;
    resolve({ granted: true, sessionKey: "parent-1" });
    await flush();
    expect(overlays).toHaveLength(0);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores episode pushes with another token or content-script sender", async () => {
    cleanup = startEmbeddedPlayer();
    emit(state(document.createElement("video")));
    await flush();
    const token = send.mock.calls.find(([msg]) => msg.active)?.[0].token;
    message({ type: "sf:frame-session", token: "other-token", sessionKey: "forged" });
    message({ type: "sf:frame-session", token, sessionKey: "forged" }, { id: "extension", tab: { id: 7 } as chrome.tabs.Tab });
    expect(overlays[0].updatePlayer).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: "parent-1|local-1" }));
  });
});
