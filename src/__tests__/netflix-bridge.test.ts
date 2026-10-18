/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  SEEK_REQUEST_EVENT,
  SEEK_RESULT_EVENT,
  decodeSeekRequest,
  handleNetflixSeekRequests,
  requestNetflixSeek,
  requestNetflixAction,
} from "../core/netflix-bridge.ts";

type FakeWindow = Window & { netflix?: unknown };
const win = window as FakeWindow;
let uninstall: (() => void) | undefined;

/** Netflix's player API shape, as the page world exposes it. */
function fakeNetflix(sessions: string[] = ["watch-123"]) {
  const players = new Map(sessions.map((id) => [id, { seek: vi.fn() }]));
  win.netflix = {
    appContext: {
      state: {
        playerApp: {
          getAPI: () => ({
            videoPlayer: {
              getAllPlayerSessionIds: () => sessions,
              getVideoPlayerBySessionId: (id: string) => players.get(id),
            },
          }),
        },
      },
    },
  };
  return players;
}

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  delete win.netflix;
  vi.useRealTimers();
});

describe("seeking Netflix through its own player", () => {
  it("asks the page world to seek, in milliseconds, and reports success", async () => {
    const players = fakeNetflix();
    uninstall = handleNetflixSeekRequests(window);

    await expect(requestNetflixSeek(3.25)).resolves.toBe(true);
    expect(players.get("watch-123")!.seek).toHaveBeenCalledWith(3250);
  });

  it("seeks the playing title, not a preview session", async () => {
    const players = fakeNetflix(["preview-9", "watch-123"]);
    uninstall = handleNetflixSeekRequests(window);

    await requestNetflixSeek(10);

    expect(players.get("watch-123")!.seek).toHaveBeenCalledWith(10000);
    expect(players.get("preview-9")!.seek).not.toHaveBeenCalled();
  });

  it("reports failure when Netflix's player API is not there", async () => {
    uninstall = handleNetflixSeekRequests(window);

    await expect(requestNetflixSeek(3)).resolves.toBe(false);
  });

  it("reports failure when the player throws", async () => {
    const players = fakeNetflix();
    players.get("watch-123")!.seek.mockImplementation(() => {
      throw new Error("player not ready");
    });
    uninstall = handleNetflixSeekRequests(window);

    await expect(requestNetflixSeek(3)).resolves.toBe(false);
  });

  it("gives up when the page-world script never answers", async () => {
    vi.useFakeTimers();
    const result = requestNetflixSeek(3, 1000);
    vi.advanceTimersByTime(1000);

    await expect(result).resolves.toBe(false);
  });

  it("refuses an invalid time without asking the page", async () => {
    const heard = vi.fn();
    document.addEventListener(SEEK_REQUEST_EVENT, heard);

    await expect(requestNetflixSeek(Number.NaN)).resolves.toBe(false);
    await expect(requestNetflixSeek(-1)).resolves.toBe(false);

    document.removeEventListener(SEEK_REQUEST_EVENT, heard);
    expect(heard).not.toHaveBeenCalled();
  });

  it("ignores a malformed request instead of seeking", () => {
    const players = fakeNetflix();
    uninstall = handleNetflixSeekRequests(window);
    const answered = vi.fn();
    document.addEventListener(SEEK_RESULT_EVENT, answered);

    for (const detail of ["not json", '{"id":1}', '{"id":1,"ms":-5}', { id: 1, ms: 5 }]) {
      document.dispatchEvent(new CustomEvent(SEEK_REQUEST_EVENT, { detail }));
    }

    document.removeEventListener(SEEK_RESULT_EVENT, answered);
    expect(players.get("watch-123")!.seek).not.toHaveBeenCalled();
    expect(answered).not.toHaveBeenCalled();
  });

  it("decodes only well-formed requests", () => {
    expect(decodeSeekRequest('{"id":2,"action":"seek","path":"/","ms":1500}')).toEqual({ id: 2, action: "seek", path: "/", ms: 1500 });
    expect(decodeSeekRequest('{"id":"2","ms":1500}')).toBeNull();
    expect(decodeSeekRequest('{"id":2,"ms":null}')).toBeNull();
  });
});


describe("Netflix playback actions", () => {
  function withPlayback() {
    const players = fakeNetflix();
    const player = players.get("watch-123")! as { seek: ReturnType<typeof vi.fn>; play?: ReturnType<typeof vi.fn>; pause?: ReturnType<typeof vi.fn> };
    player.play = vi.fn();
    player.pause = vi.fn();
    uninstall = handleNetflixSeekRequests(window);
    return player;
  }

  it("plays and pauses through Netflix's own player", async () => {
    const player = withPlayback();

    expect(await requestNetflixAction("pause")).toBe(true);
    expect(await requestNetflixAction("play")).toBe(true);
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.play).toHaveBeenCalledOnce();
  });

  it("probes for play/pause without calling them", async () => {
    const player = withPlayback();

    expect(await requestNetflixAction("probe")).toBe(true);
    expect(player.play).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
  });

  it("fails safely when an undocumented method is missing", async () => {
    fakeNetflix();
    uninstall = handleNetflixSeekRequests(window);

    expect(await requestNetflixAction("probe")).toBe(false);
    expect(await requestNetflixAction("play")).toBe(false);
    expect(await requestNetflixAction("pause")).toBe(false);
  });

  it("rejects arbitrary methods and extra fields", () => {
    for (const value of [
      { id: 3, path: "/", action: "eval" },
      { id: 3, path: "/", action: "constructor" },
      { id: 3, path: "/", action: "play", ms: 4 },
      { id: 3, path: "/", action: "seek", ms: 5, code: "bad" },
      { id: 0, path: "/", action: "pause" },
      { id: 3, path: "relative", action: "pause" },
    ]) {
      expect(decodeSeekRequest(JSON.stringify(value))).toBeNull();
    }
  });

  it("ignores a request made for another episode", async () => {
    const player = withPlayback();
    const answers: string[] = [];
    const listen = (event: Event) => answers.push((event as CustomEvent<string>).detail);
    document.addEventListener(SEEK_RESULT_EVENT, listen);

    document.dispatchEvent(new CustomEvent(SEEK_REQUEST_EVENT, {
      detail: JSON.stringify({ id: 5, path: "/watch/obsolete", action: "seek", ms: 4000 }),
    }));
    await vi.waitFor(() => expect(answers).toHaveLength(1));

    document.removeEventListener(SEEK_RESULT_EVENT, listen);
    expect(player.seek).not.toHaveBeenCalled();
    expect(JSON.parse(answers[0])).toEqual({ id: 5, ok: false });
  });

  it("does not count an answer that arrives after the episode changed", async () => {
    withPlayback();
    window.history.replaceState({}, "", "/watch/1");
    const result = requestNetflixAction("pause");
    window.history.replaceState({}, "", "/watch/2");

    expect(await result).toBe(false);
    window.history.replaceState({}, "", "/");
  });
});
