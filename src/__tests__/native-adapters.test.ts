/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetflixAdapter } from "../adapters/netflix.ts";
import { MaxAdapter } from "../adapters/max.ts";
import { SEEK_REQUEST_EVENT, SEEK_RESULT_EVENT } from "../core/netflix-bridge.ts";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe.each([
  { name: "Netflix", Adapter: NetflixAdapter, selector: "player-timedtext-text-container" },
  { name: "Max", Adapter: MaxAdapter, selector: "player-subtitle" },
])("$name DOM regression", ({ Adapter, selector }) => {
  it("reads nested multiline cues once and restores native captions on cleanup", async () => {
    vi.useFakeTimers();
    const onCue = vi.fn();
    stop = new Adapter().observeSubtitles(onCue);
    const cue = document.createElement("div");
    cue.setAttribute("data-testid", selector);
    cue.innerHTML = "<span><span>Hello</span></span><span>again</span>";
    document.body.append(cue);
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    expect(onCue).toHaveBeenLastCalledWith({ text: "Hello again", start: 0, end: 0 });
    expect(cue.hasAttribute("data-streamfluent-native-hidden")).toBe(true);
    cue.textContent = "Pending";
    await Promise.resolve();
    stop();
    expect(cue.hasAttribute("data-streamfluent-native-hidden")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(onCue).toHaveBeenCalledTimes(1);
  });
});

/** A <video> whose currentTime records writes, which jsdom does not implement. */
function trackedVideo() {
  const video = document.createElement("video");
  const writes: number[] = [];
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => writes[writes.length - 1] ?? 0,
    set: (value: number) => writes.push(value),
  });
  document.body.append(video);
  return { video, writes };
}

describe("seeking", () => {
  it("Netflix seeks through its own player and never writes the video's time", async () => {
    const { writes } = trackedVideo();
    const requests: string[] = [];
    const answer = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      requests.push(detail);
      const { id } = JSON.parse(detail) as { id: number };
      document.dispatchEvent(new CustomEvent(SEEK_RESULT_EVENT, { detail: JSON.stringify({ id, ok: true }) }));
    };
    document.addEventListener(SEEK_REQUEST_EVENT, answer);

    const ok = await new NetflixAdapter().seekTo(12.5);

    document.removeEventListener(SEEK_REQUEST_EVENT, answer);
    expect(ok).toBe(true);
    expect(JSON.parse(requests[0])).toMatchObject({ ms: 12500 });
    // Writing currentTime is what crashes Netflix's player (M7375).
    expect(writes).toEqual([]);
  });

  it("Max seeks the video element directly", async () => {
    const { writes } = trackedVideo();

    await expect(new MaxAdapter().seekTo(12.5)).resolves.toBe(true);
    expect(writes).toEqual([12.5]);
  });

  it("Max reports failure when there is no video", async () => {
    await expect(new MaxAdapter().seekTo(3)).resolves.toBe(false);
  });
});
