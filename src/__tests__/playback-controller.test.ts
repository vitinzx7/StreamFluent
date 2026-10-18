/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHtml5Driver,
  createPlaybackController,
  seekTarget,
  type PlaybackController,
  type PlaybackDriver,
} from "../core/playback-controller.ts";
import type { StudySnapshot } from "../core/study-context.ts";

const controllers: PlaybackController[] = [];

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.stop());
  vi.useRealTimers();
});

/** A video plus a driver that moves it the way a cooperative player would. */
function fixture({
  paused: startPaused = true,
  backTarget = (time: number): number | null => time - 10,
} = {}) {
  const video = document.createElement("video");
  let paused = startPaused;
  let session = "one";
  Object.defineProperty(video, "duration", { configurable: true, value: 200 });
  Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
  video.currentTime = 120;

  const driver = {
    getVideo: () => video,
    getSessionId: () => session,
    seekTo: vi.fn(async (time: number) => {
      video.currentTime = time;
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
      return true;
    }),
    canPlayPause: vi.fn(() => true),
  } satisfies PlaybackDriver;

  const onNavigate = vi.fn();
  const controller = createPlaybackController(driver, { backTarget, onNavigate, settleTimeoutMs: 100 });
  controllers.push(controller);
  return {
    video,
    driver,
    controller,
    onNavigate,
    setSession: (value: string) => { session = value; },
  };
}

function line(overrides: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    sessionId: "one",
    sourceId: "source",
    cueId: "cue",
    occurrenceId: "occurrence",
    text: "Hello",
    direction: "en-pt",
    start: 10,
    previousEnd: 9.9,
    platform: "Test",
    mediaTitle: "",
    season: null,
    episode: null,
    freshKeys: new Set(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("D: forward five seconds", () => {
  it("goes from 120 s to exactly 125 s and keeps a paused video paused", async () => {
    const { controller, driver, video } = fixture();

    expect(await controller.forward()).toEqual({ ok: true });

    expect(driver.seekTo).toHaveBeenCalledExactlyOnceWith(125);
    expect(video.currentTime).toBe(125);
    expect(driver.play).not.toHaveBeenCalled();
    expect(driver.pause).not.toHaveBeenCalled();
  });

  it("keeps a playing video playing", async () => {
    const { controller, driver, video } = fixture({ paused: false });

    await controller.forward();

    expect(video.paused).toBe(false);
    expect(driver.pause).not.toHaveBeenCalled();
  });

  it("adds two rapid presses from the pending target: 125 then 130", async () => {
    const { controller, driver } = fixture();

    const results = await Promise.all([controller.forward(), controller.forward()]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(driver.seekTo.mock.calls).toEqual([[125], [130]]);
  });

  it("does not let the first press's late answer pull the target back", async () => {
    const { controller, driver, video } = fixture();
    const first = deferred<boolean>();
    driver.seekTo.mockImplementationOnce(async (time) => {
      const ok = await first.promise;
      video.currentTime = time;
      video.dispatchEvent(new Event("seeking"));
      video.dispatchEvent(new Event("seeked"));
      return ok;
    });

    const one = controller.forward();
    const two = controller.forward();
    first.resolve(true);
    await Promise.all([one, two]);

    expect(driver.seekTo.mock.calls).toEqual([[125], [130]]);
    expect(video.currentTime).toBe(130);
  });

  it("is limited to the media's duration near the end", async () => {
    const { controller, video } = fixture();
    video.currentTime = 198;

    await controller.forward();

    expect(video.currentTime).toBe(200);
  });

  it("stays inside the current seekable range and never jumps a gap", () => {
    const { video } = fixture();
    Object.defineProperty(video, "seekable", {
      value: { length: 2, start: (i: number) => (i ? 100 : 10), end: (i: number) => (i ? 150 : 20) },
    });

    video.currentTime = 19;
    expect(seekTarget(video, 25)).toBe(20);
    video.currentTime = 50;
    expect(seekTarget(video, 55)).toBeNull();
  });

  it("refuses NaN, Infinity and media with no known length", async () => {
    const { controller, driver, video } = fixture();
    expect(seekTarget(video, Number.NaN)).toBeNull();
    expect(seekTarget(video, Infinity)).toBeNull();

    Object.defineProperty(video, "duration", { configurable: true, value: Infinity });
    expect(controller.canForward()).toBe(false);
    expect((await controller.forward()).ok).toBe(false);
    expect(driver.seekTo).not.toHaveBeenCalled();
  });

  it("starts a new sequence from the real time after an external seek", async () => {
    const { controller, video, driver, onNavigate } = fixture();
    await controller.forward();

    video.currentTime = 50;
    video.dispatchEvent(new Event("seeking"));
    await controller.forward();

    expect(onNavigate).toHaveBeenCalledWith("external");
    expect(driver.seekTo).toHaveBeenLastCalledWith(55);
  });
});

describe("A: previous line through the controller", () => {
  it("steps back from the pending target on a second rapid press", async () => {
    const backTarget = vi.fn((time: number) => time - 10);
    const { controller, driver } = fixture({ backTarget });

    await Promise.all([controller.previous(), controller.previous()]);

    expect(driver.seekTo.mock.calls).toEqual([[110], [100]]);
    expect(backTarget.mock.calls.map(([time]) => time)).toEqual([120, 110]);
  });

  it("does nothing, and says so, when no line is known", async () => {
    const { controller, driver } = fixture({ backTarget: () => null });

    expect(controller.canPrevious()).toBe(false);
    expect((await controller.previous()).ok).toBe(false);
    expect(driver.seekTo).not.toHaveBeenCalled();
  });
});

describe("S: repeat the study line", () => {
  it("seeks to the safe start of the line, then plays once even from paused", async () => {
    const { controller, driver, video } = fixture();

    expect((await controller.repeat(line())).ok).toBe(true);

    // 10 - 0.25 would cut into the line before, which ended at 9.9.
    expect(driver.seekTo).toHaveBeenCalledExactlyOnceWith(9.9);
    expect(driver.play).toHaveBeenCalledOnce();
    expect(video.paused).toBe(false);
  });

  it("applies the 0.25 s pre-roll when nothing ended right before", async () => {
    const { controller, driver } = fixture();

    await controller.repeat(line({ previousEnd: undefined }));

    expect(driver.seekTo).toHaveBeenCalledWith(9.75);
  });

  it("does not play when the bridge only acknowledged and the video never moved", async () => {
    const { controller, driver } = fixture();
    driver.seekTo.mockResolvedValue(true);

    expect((await controller.repeat(line())).ok).toBe(false);
    expect(driver.play).not.toHaveBeenCalled();
  });

  it("does not play after a refused seek, a missing line or an unknown start", async () => {
    const { controller, driver } = fixture();
    driver.seekTo.mockResolvedValue(false);

    expect((await controller.repeat(line())).ok).toBe(false);
    expect(await controller.repeat(null)).toEqual({ ok: false, error: "Nenhuma fala para repetir." });
    expect((await controller.repeat(line({ start: undefined }))).error).toBe("O início desta fala é desconhecido.");
    expect(driver.play).not.toHaveBeenCalled();
  });

  it("refuses a line from another session without seeking", async () => {
    const { controller, driver } = fixture();

    expect(controller.canRepeat(line({ sessionId: "old" }))).toBe(false);
    expect((await controller.repeat(line({ sessionId: "old" }))).ok).toBe(false);
    expect(driver.seekTo).not.toHaveBeenCalled();
  });

  it("reports a rejected play", async () => {
    const { controller, driver } = fixture();
    driver.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));

    expect(await controller.repeat(line())).toEqual({ ok: false, error: "Não foi possível reproduzir a fala." });
  });
});

describe("Space: play/pause", () => {
  it("turns two quick presses into two real toggles", async () => {
    const { controller, driver, video } = fixture();

    await Promise.all([controller.toggle(), controller.toggle()]);

    expect(driver.play).toHaveBeenCalledOnce();
    expect(driver.pause).toHaveBeenCalledOnce();
    expect(video.paused).toBe(true);
  });

  it("reports a rejected play and keeps the queue usable", async () => {
    const { controller, driver } = fixture();
    driver.play.mockRejectedValueOnce(new Error("denied"));

    expect((await controller.toggle()).ok).toBe(false);
    expect((await controller.toggle()).ok).toBe(true);
  });

  it("is not available until the platform says play/pause work", () => {
    const { controller, driver } = fixture();
    driver.canPlayPause.mockReturnValue(false);

    expect(controller.canToggle()).toBe(false);
  });

  it("pause() leaves an already paused video alone", async () => {
    const { controller, driver } = fixture();

    expect((await controller.pause()).ok).toBe(true);
    expect(driver.pause).not.toHaveBeenCalled();
  });
});

describe("sessions and stuck players", () => {
  it("drops commands queued under the old session", async () => {
    const { controller, driver, setSession } = fixture();
    const seek = deferred<boolean>();
    driver.seekTo.mockImplementationOnce(() => seek.promise);

    const first = controller.repeat(line());
    const second = controller.forward();
    await vi.waitFor(() => expect(driver.seekTo).toHaveBeenCalled());
    setSession("two");
    seek.resolve(true);

    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(false);
    expect(driver.seekTo).toHaveBeenCalledTimes(1);
    expect(driver.play).not.toHaveBeenCalled();
  });

  it("gives up on a driver that never answers and runs the next command", async () => {
    vi.useFakeTimers();
    const { controller, driver } = fixture();
    driver.seekTo.mockImplementationOnce(() => new Promise<boolean>(() => {}));

    const stuck = controller.forward();
    const next = controller.toggle();
    await vi.advanceTimersByTimeAsync(3000);

    expect((await stuck).ok).toBe(false);
    expect((await next).ok).toBe(true);
  });

  it("stop() ends a seek that is still waiting to land", async () => {
    const { controller, driver } = fixture();
    driver.seekTo.mockResolvedValue(true);

    const result = controller.forward();
    await vi.waitFor(() => expect(driver.seekTo).toHaveBeenCalled());
    controller.stop();

    expect((await result).ok).toBe(false);
  });
});

describe("HTML5 driver", () => {
  it("writes currentTime only for valid times and reports a refused play", async () => {
    const video = document.createElement("video");
    vi.spyOn(video, "play").mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    const driver = createHtml5Driver(() => video, () => "s");

    expect(await driver.seekTo(Number.NaN)).toBe(false);
    expect(await driver.seekTo(-1)).toBe(false);
    expect(await driver.seekTo(4)).toBe(true);
    expect(video.currentTime).toBe(4);
    expect(await driver.play()).toBe(false);
  });
});
