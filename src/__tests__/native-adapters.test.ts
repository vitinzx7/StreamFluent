/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetflixAdapter } from "../adapters/netflix.ts";
import { MaxAdapter } from "../adapters/max.ts";

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
