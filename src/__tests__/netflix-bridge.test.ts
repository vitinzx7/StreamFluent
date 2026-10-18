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
  it("fails safely when an undocumented method is missing", async () => {
    fakeNetflix(); uninstall = handleNetflixSeekRequests(window);
    expect(await requestNetflixAction("play")).toBe(false);
    expect(await requestNetflixAction("pause")).toBe(false);
  });
  it("rejects arbitrary methods, extra fields and obsolete sessions", () => {
    const players = fakeNetflix(); uninstall = handleNetflixSeekRequests(window);
    for (const value of [{ id: 3, path: "/", action: "eval" }, { id: 3, path: "/", action: "play", ms: 4 }, { id: 3, path: "/", action: "seek", ms: 5, code: "bad" }]) expect(decodeSeekRequest(JSON.stringify(value))).toBeNull();
    document.dispatchEvent(new CustomEvent(SEEK_REQUEST_EVENT, { detail: JSON.stringify({ id: 5, path: "/obsolete", action: "seek", ms: 4000 }) }));
    expect(players.get("watch-123")!.seek).not.toHaveBeenCalled();
  });
});
