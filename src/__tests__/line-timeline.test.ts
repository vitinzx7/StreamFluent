import { describe, it, expect } from "vitest";
import { createLineTimeline, PRE_ROLL, type LineTimeline } from "../core/line-timeline.ts";

/** Normal playback from `from` to `to`, in timeupdate-sized steps. */
function play(timeline: LineTimeline, from: number, to: number, step = 0.25) {
  for (let t = from; t < to; t += step) timeline.played(t, Math.min(to, t + step));
}

/** Watches a run of lines from `from` to `to`, recording each as it shows and ends. */
function watch(
  timeline: LineTimeline,
  lines: Array<[text: string, start: number, end: number]>,
  from: number,
  to: number
) {
  play(timeline, from, to);
  for (const [text, start, end] of lines) {
    if (start > to) break;
    timeline.lineShown(text, start);
    if (end <= to) timeline.lineHidden(end);
  }
}

describe("back one line", () => {
  it("goes from 'and you' straight to the start of 'I am student in TI'", () => {
    const t = createLineTimeline();
    watch(t, [["Hello there", 1, 3], ["I am student in TI", 3.5, 5.5], ["and you", 6, 8]], 0, 6.5);

    expect(t.backTarget(6.5)).toBe(3.5 - PRE_ROLL);
  });

  it("in the silence after a line, goes back to that line", () => {
    const t = createLineTimeline();
    watch(t, [["I am student in TI", 3.5, 5.5], ["and you", 6, 8]], 0, 9);

    expect(t.backTarget(9)).toBe(6 - PRE_ROLL);
  });

  it("right after a line goes away, replays that line rather than the one before", () => {
    const t = createLineTimeline();
    watch(t, [["I am student in TI", 3.5, 5.5], ["and you", 6, 8]], 0, 8.2);

    expect(t.backTarget(8.2)).toBe(6 - PRE_ROLL);
  });

  it("stops at the end of the line before when lines are back to back", () => {
    const t = createLineTimeline();
    watch(t, [["one", 1, 3], ["two", 3, 5], ["three", 5, 7]], 0, 6);

    // 3 - PRE_ROLL would show the end of "one" first.
    expect(t.backTarget(6)).toBe(3);
  });

  it("steps back one more line when pressed again from where it landed", () => {
    const t = createLineTimeline();
    watch(t, [["one", 1, 3], ["two", 3, 5], ["three", 5, 7]], 0, 6);

    const first = t.backTarget(6)!;
    expect(t.backTarget(first)).toBe(1 - PRE_ROLL);
  });

  it("restarts the line on screen when nothing before it is known", () => {
    const t = createLineTimeline();
    watch(t, [["first line", 2, 4]], 2, 3);

    expect(t.backTarget(3)).toBe(2 - PRE_ROLL);
  });

  it("never lands before the start of the video", () => {
    const t = createLineTimeline();
    watch(t, [["right away", 0.1, 2]], 0, 1);

    expect(t.backTarget(1)).toBe(0);
  });

  it("returns nothing before any line was seen", () => {
    expect(createLineTimeline().backTarget(10)).toBeNull();
  });
});

describe("skipping ahead", () => {
  it("does not jump minutes back over a stretch that was never watched", () => {
    const t = createLineTimeline();
    watch(t, [["old line", 1, 3]], 0, 4);
    t.jumped();
    play(t, 100, 101);
    t.lineShown("new line", 100.5);

    // "old line" is the previous known line, but the unseen 96s lie between:
    // restart the line on screen instead.
    expect(t.backTarget(101)).toBe(100.5 - PRE_ROLL);
  });

  it("does nothing in a silence reached by skipping", () => {
    const t = createLineTimeline();
    watch(t, [["old line", 1, 3]], 0, 4);
    t.jumped();

    expect(t.backTarget(100)).toBeNull();
  });

  it("does not count a big step between two updates as watched", () => {
    const t = createLineTimeline();
    watch(t, [["old line", 1, 3]], 0, 4);
    t.played(4, 100);
    t.lineShown("new line", 100.5);

    expect(t.backTarget(101)).toBe(100.5 - PRE_ROLL);
  });
});

describe("recording", () => {
  it("does not duplicate a line replayed after going back", () => {
    const t = createLineTimeline();
    watch(t, [["a", 1, 3], ["b", 5, 7]], 0, 6);
    t.jumped();
    t.lineShown("a", 1.1); // replay
    t.lineHidden(3);
    t.lineShown("b", 5.05);

    expect(t.size).toBe(2);
    expect(t.backTarget(6)).toBe(1 - PRE_ROLL);
  });

  it("does not give a line an end before its start when playback went back", () => {
    const t = createLineTimeline();
    watch(t, [["a", 1, 3], ["b", 5, 7]], 0, 6);
    // No jumped() call: the earlier line reappearing must not close "b" at 1.0.
    t.lineShown("a", 1.0);
    t.lineHidden(3);
    t.lineShown("b", 5.1);

    expect(t.size).toBe(2);
    expect(t.backTarget(6)).toBe(1 - PRE_ROLL);
  });

  it("keeps the same words said at different moments as separate lines", () => {
    const t = createLineTimeline();
    watch(t, [["Yeah.", 1, 2], ["Yeah.", 50, 51]], 0, 52);

    expect(t.size).toBe(2);
  });

  it("forgets everything on clear", () => {
    const t = createLineTimeline();
    watch(t, [["a", 1, 3]], 0, 4);
    t.clear();

    expect(t.size).toBe(0);
    expect(t.backTarget(2)).toBeNull();
  });
});
