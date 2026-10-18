/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import {
  createDomAutoPause,
  createTimedAutoPause,
  overlapGroups,
  JUMP_GRACE_MS,
  type PauseHost,
} from "../core/auto-pause.ts";
import type { PlaybackResult } from "../core/playback-controller.ts";
import type { StudySnapshot } from "../core/study-context.ts";

function line(occurrenceId: string, text = occurrenceId): StudySnapshot {
  return {
    sessionId: "s",
    sourceId: "src",
    cueId: text,
    occurrenceId,
    text,
    direction: "en-pt",
    platform: "Test",
    mediaTitle: "",
    season: null,
    episode: null,
    freshKeys: new Set(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

type HostOverrides = Partial<Pick<PauseHost, "pause">>;

function host(overrides: HostOverrides = {}) {
  let enabled = true;
  const calls = {
    enabled: () => enabled,
    pause: vi.fn<PauseHost["pause"]>(overrides.pause ?? (async () => ({ ok: true }))),
    hold: vi.fn<PauseHost["hold"]>(),
    retain: vi.fn<PauseHost["retain"]>(),
    failed: vi.fn<PauseHost["failed"]>(),
  };
  return { host: calls, setEnabled: (value: boolean) => { enabled = value; } };
}

/** A video in normal playback, as the DOM detector checks it. */
function playingVideo() {
  const video = document.createElement("video");
  let paused = false;
  let readyState = 4;
  Object.defineProperty(video, "paused", { get: () => paused });
  Object.defineProperty(video, "readyState", { get: () => readyState });
  return {
    video,
    setPaused: (value: boolean) => { paused = value; },
    buffer: () => { readyState = 2; },
  };
}

describe("DOM subtitles (Netflix/Max): approximate pause", () => {
  function dom(overrides: HostOverrides = {}) {
    let clock = 10_000;
    const h = host(overrides);
    const pause = createDomAutoPause(h.host, () => clock);
    return { ...h, pause, advance: (ms: number) => { clock += ms; } };
  }

  it("A02: pauses when the line is replaced, holding it, and retains it once paused", async () => {
    const { pause, host: h } = dom();
    const { video } = playingVideo();
    const first = line("1", "Where were you?");
    pause.lineShown(first);

    pause.lineEnded(first, video);

    expect(h.hold).toHaveBeenCalledWith(first);
    expect(h.pause).toHaveBeenCalledOnce();
    await flush();
    expect(h.retain).toHaveBeenCalledExactlyOnceWith(first);
  });

  it("pauses when the line just disappears into silence", () => {
    const { pause, host: h } = dom();
    pause.lineShown(line("1"));

    pause.lineEnded(line("1"), playingVideo().video);

    expect(h.pause).toHaveBeenCalledOnce();
  });

  it("does nothing while switched off", () => {
    const { pause, host: h, setEnabled } = dom();
    setEnabled(false);
    pause.lineShown(line("1"));

    pause.lineEnded(line("1"), playingVideo().video);

    expect(h.pause).not.toHaveBeenCalled();
  });

  it("does not pause a video that is already paused, buffering or missing", () => {
    const { pause, host: h } = dom();
    const paused = playingVideo();
    paused.setPaused(true);
    const buffering = playingVideo();
    buffering.buffer();

    for (const [id, video] of [["1", paused.video], ["2", buffering.video], ["3", null]] as const) {
      pause.lineShown(line(id));
      pause.lineEnded(line(id), video);
    }

    expect(h.pause).not.toHaveBeenCalled();
  });

  it("A05: does not count a line change caused by a seek", () => {
    const { pause, host: h, advance } = dom();
    pause.lineShown(line("1"));

    pause.jumped();
    advance(100);
    pause.lineEnded(line("1"), playingVideo().video);

    expect(h.pause).not.toHaveBeenCalled();
  });

  it("arms the line shown at the seek's destination, once the seek's own changes are over", () => {
    const { pause, host: h, advance } = dom();
    pause.jumped();
    advance(150);
    pause.lineShown(line("2"));
    advance(JUMP_GRACE_MS + 2000);

    pause.lineEnded(line("2"), playingVideo().video);

    expect(h.pause).toHaveBeenCalledOnce();
  });

  it("asks the player once even if the same end is reported twice", () => {
    const { pause, host: h } = dom({ pause: vi.fn(() => new Promise<PlaybackResult>(() => {})) });
    pause.lineShown(line("1"));

    pause.lineEnded(line("1"), playingVideo().video);
    pause.lineEnded(line("1"), playingVideo().video);

    expect(h.pause).toHaveBeenCalledOnce();
  });

  it("A03: after resuming, the next line can pause, never the one already consumed", async () => {
    const { pause, host: h } = dom();
    const { video } = playingVideo();
    pause.lineShown(line("1"));
    pause.lineEnded(line("1"), video);
    await flush();

    pause.lineShown(line("1"));
    pause.lineEnded(line("1"), video);
    pause.lineShown(line("2"));
    pause.lineEnded(line("2"), video);

    expect(h.pause).toHaveBeenCalledTimes(2);
  });

  it("reports a refused pause instead of pretending it paused", async () => {
    const { pause, host: h } = dom({ pause: vi.fn(async () => ({ ok: false, error: "Não foi possível pausar." })) });
    pause.lineShown(line("1"));

    pause.lineEnded(line("1"), playingVideo().video);
    await flush();

    expect(h.retain).not.toHaveBeenCalled();
    expect(h.failed).toHaveBeenCalledWith(line("1"), "Não foi possível pausar.");
  });

  it("A05: ignores the late answer of a pause asked for the previous episode", async () => {
    const answer = deferred<PlaybackResult>();
    const { pause, host: h } = dom({ pause: vi.fn(() => answer.promise) });
    pause.lineShown(line("1"));
    pause.lineEnded(line("1"), playingVideo().video);

    pause.reset();
    answer.resolve({ ok: true });
    await flush();

    expect(h.retain).not.toHaveBeenCalled();
  });
});

describe("overlap groups", () => {
  it("merges positive overlaps into one group ending at the latest end", () => {
    expect(overlapGroups([{ start: 1, end: 3 }, { start: 2, end: 5 }, { start: 4, end: 4.5 }])).toEqual([{ start: 1, end: 5 }]);
  });

  it("keeps lines that only touch separate", () => {
    expect(overlapGroups([{ start: 3, end: 5 }, { start: 1, end: 3 }])).toEqual([{ start: 1, end: 3 }, { start: 3, end: 5 }]);
  });
});

describe("timed sources: end on the video clock", () => {
  const cues = [
    { start: 1, end: 3 },
    { start: 3, end: 5 },
    { start: 6, end: 8 },
    { start: 7, end: 9 },
  ];

  /** Plays from `from` to `to` in 50 ms ticks, showing whatever is active. */
  function timed(overrides: HostOverrides = {}) {
    const h = host(overrides);
    const pause = createTimedAutoPause(h.host);
    pause.setCues(cues);
    let offset = 0;
    let shownFrom: number | undefined;
    const tick = (time: number, playing = true) => {
      pause.observe({ time, offset, playing });
      const source = time - offset;
      const active = cues.filter((cue) => cue.start <= source && source < cue.end);
      const start = active.length ? Math.min(...active.map((cue) => cue.start)) : undefined;
      if (start !== shownFrom) {
        shownFrom = start;
        if (start !== undefined) pause.shown(line(`at-${start}`, active.map((cue) => String(cue.start)).join("+")), start);
      }
    };
    const play = (from: number, to: number) => {
      for (let time = from; time <= to + 1e-9; time += 0.05) tick(Math.round(time * 1000) / 1000);
    };
    return { ...h, pause, tick, play, setOffset: (value: number) => { offset = value; pause.jumped(); } };
  }

  it("A01: pauses once, at the first tick after the end", () => {
    const { play, host: h } = timed();

    play(0.5, 2.98);
    expect(h.pause).not.toHaveBeenCalled();
    play(3.0, 3.0);

    expect(h.pause).toHaveBeenCalledOnce();
    expect(h.hold).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "at-1" }));
  });

  it("gives a back-to-back line its own end", async () => {
    const { play, host: h } = timed();

    play(0.5, 3.0);
    await flush();
    play(3.05, 5.1);

    expect(h.hold.mock.calls.map(([snapshot]) => snapshot.occurrenceId)).toEqual(["at-1", "at-3"]);
  });

  it("pauses an overlapping pair once, at the later end, keeping the last composition shown", () => {
    const { play, host: h } = timed();

    play(5.5, 9.2);

    expect(h.pause).toHaveBeenCalledOnce();
    expect(h.hold.mock.calls[0][0].text).toBe("7");
  });

  it.each([
    [0.5, 3.5],
    [-0.5, 2.5],
  ])("applies an offset of %s s: the pause comes at %s s", (offset, at) => {
    const { play, host: h, setOffset } = timed();
    setOffset(offset);

    play(1.5 + offset, at - 0.02);
    expect(h.pause).not.toHaveBeenCalled();
    play(at, at);

    expect(h.pause).toHaveBeenCalledOnce();
  });

  it("follows the video clock whatever the speed", () => {
    const { tick, host: h } = timed();

    // 2x: 100 ms of video per 50 ms tick.
    for (let time = 1; time < 3.2; time += 0.1) tick(time);

    expect(h.pause).toHaveBeenCalledOnce();
  });

  it("A05: never pauses for ends crossed by a seek", () => {
    const { tick, pause, host: h } = timed();
    tick(1.5);

    pause.jumped();
    tick(7.5);
    tick(7.55);

    expect(h.pause).not.toHaveBeenCalled();
  });

  it("treats a big step between readings as a jump, not playback", () => {
    const { tick, host: h } = timed();
    tick(1.5);

    tick(5.5);

    expect(h.pause).not.toHaveBeenCalled();
  });

  it("does not pause while paused, and pauses right after resuming just before an end", () => {
    const { tick, host: h } = timed();
    tick(2.9);
    tick(2.95, false);
    tick(2.95, false);
    expect(h.pause).not.toHaveBeenCalled();

    tick(3.01);

    expect(h.pause).toHaveBeenCalledOnce();
  });

  it("A03: resuming after the pause does not pause again at the same end", async () => {
    const { tick, host: h } = timed();
    tick(2.98);
    tick(3.01);
    await flush();
    tick(3.01, false);

    tick(3.06);
    tick(3.11);

    expect(h.pause).toHaveBeenCalledOnce();
  });

  it("A04: S starts a new pass, so the repeated line can pause again", async () => {
    const { play, pause, host: h } = timed();
    play(2.9, 3.0);
    await flush();

    pause.jumped();
    play(0.75, 3.0);

    expect(h.pause).toHaveBeenCalledTimes(2);
  });

  it("does not pause for a line it never showed", () => {
    const h = host();
    const pause = createTimedAutoPause(h.host);
    pause.setCues(cues);

    pause.observe({ time: 2.98, offset: 0, playing: true });
    pause.observe({ time: 3.01, offset: 0, playing: true });

    expect(h.host.pause).not.toHaveBeenCalled();
  });

  it("A06-style: switched off, it never pauses", () => {
    const { play, host: h, setEnabled } = timed();
    setEnabled(false);

    play(0.5, 9.5);

    expect(h.pause).not.toHaveBeenCalled();
  });
});
