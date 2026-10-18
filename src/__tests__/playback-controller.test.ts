/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybackController, seekTarget, type PlaybackDriver } from "../core/playback-controller.ts";
import type { StudySnapshot } from "../core/study-context.ts";
const controllers: ReturnType<typeof createPlaybackController>[] = [];
afterEach(() => { controllers.splice(0).forEach(controller => controller.stop()); vi.useRealTimers(); });
function fixture() {
  const video = document.createElement("video"); let paused = true, session = "one";
  Object.defineProperty(video, "duration", { configurable: true, value: 200 });
  Object.defineProperty(video, "paused", { get: () => paused }); video.currentTime = 120;
  const driver: PlaybackDriver = {
    getVideo: () => video, getSessionId: () => session,
    seekTo: vi.fn(async time => { video.currentTime = time; video.dispatchEvent(new Event("seeked")); return true; }),
    play: vi.fn(async () => { paused = false; video.dispatchEvent(new Event("play")); return true; }),
    pause: vi.fn(async () => { paused = true; return true; }),
  };
  const controller = createPlaybackController(driver, { backTarget: time => time - 10, settleTimeoutMs: 100 }); controllers.push(controller);
  return { video, driver, controller, session: (value: string) => { session = value; } };
}
const snapshot: StudySnapshot = { sessionId: "one", sourceId: "source", occurrenceId: "occurrence", cueId: "cue", text: "Hello", direction: "en-pt", start: 10, previousEnd: 9.9, platform: "Test", mediaTitle: "", season: null, episode: null, freshKeys: new Set() };
describe("serialized player commands", () => {
  it("accumulates two rapid D presses to +10 and preserves pause", async () => {
    const { controller, driver, video } = fixture();
    const results = await Promise.all([controller.forward(), controller.forward()]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(driver.seekTo).toHaveBeenNthCalledWith(1, 125); expect(driver.seekTo).toHaveBeenNthCalledWith(2, 130);
    expect(video.paused).toBe(true); expect(driver.play).not.toHaveBeenCalled();
  });
  it("clamps D at finite media end and uses only current seekable interval", async () => {
    const { controller, video } = fixture(); video.currentTime = 198; await controller.forward(); expect(video.currentTime).toBe(200);
    Object.defineProperty(video, "seekable", { value: { length: 2, start: (i: number) => i ? 100 : 10, end: (i: number) => i ? 150 : 20 } });
    video.currentTime = 19; expect(seekTarget(video, 25)).toBe(20);
    video.currentTime = 50; expect(seekTarget(video, 55)).toBeNull();
    expect(seekTarget(video, NaN)).toBeNull(); expect(seekTarget(video, Infinity)).toBeNull();
  });
  it("serializes Space intents against updated real state", async () => {
    const { controller, driver, video } = fixture();
    await Promise.all([controller.toggle(), controller.toggle()]);
    expect(driver.play).toHaveBeenCalledOnce(); expect(driver.pause).toHaveBeenCalledOnce(); expect(video.paused).toBe(true);
  });
  it("repeats with safe pre-roll and plays once after the accepted seek settles", async () => {
    const { controller, driver, video } = fixture();
    expect((await controller.repeat(snapshot)).ok).toBe(true);
    expect(driver.seekTo).toHaveBeenCalledWith(9.9); expect(driver.play).toHaveBeenCalledOnce(); expect(video.paused).toBe(false);
  });
  it("does not play when only bridge acknowledgement arrives without a settled position", async () => {
    const { controller, driver } = fixture(); vi.mocked(driver.seekTo).mockResolvedValue(true);
    expect((await controller.repeat(snapshot)).ok).toBe(false); expect(driver.play).not.toHaveBeenCalled();
  });
  it("does not play after rejected seeks or absent timing", async () => {
    const { controller, driver } = fixture(); vi.mocked(driver.seekTo).mockResolvedValue(false);
    expect((await controller.repeat(snapshot)).ok).toBe(false); expect((await controller.repeat(null)).ok).toBe(false);
    expect(driver.play).not.toHaveBeenCalled();
  });
  it("cancels old queued operations on session changes", async () => {
    const { controller, driver, session } = fixture();
    let finish!: (value: boolean) => void; vi.mocked(driver.seekTo).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = controller.repeat(snapshot), second = controller.forward();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function")); session("new"); finish(true);
    expect((await first).ok).toBe(false); expect((await second).ok).toBe(false); expect(driver.play).not.toHaveBeenCalled();
  });
  it("starts a new D sequence from real time after an external seek", async () => {
    const { controller, video, driver } = fixture(); await controller.forward();
    video.currentTime = 50; video.dispatchEvent(new Event("seeking")); await controller.forward();
    expect(driver.seekTo).toHaveBeenLastCalledWith(55);
  });
  it("reports rejected playback without throwing out of the command queue", async () => {
    const { controller, driver } = fixture(); vi.mocked(driver.play).mockRejectedValueOnce(new Error("denied"));
    expect((await controller.toggle()).ok).toBe(false); expect((await controller.toggle()).ok).toBe(true);
  });
});
