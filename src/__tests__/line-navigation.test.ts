/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createLineNavigation, type LineNavigation } from "../core/line-navigation.ts";
import { PRE_ROLL } from "../core/line-timeline.ts";

let navigation: LineNavigation | undefined;

/** A <video> whose clock the test drives, firing the events a player would. */
function fakeVideo() {
  const video = document.createElement("video");
  let time = 0;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value;
    },
  });
  document.body.append(video);

  const playTo = (to: number) => {
    while (time < to - 1e-9) {
      time = Math.min(to, time + 0.25);
      video.dispatchEvent(new Event("timeupdate"));
    }
  };
  const seek = (to: number) => {
    time = to;
    video.dispatchEvent(new Event("seeking"));
    video.dispatchEvent(new Event("seeked"));
  };
  return { video, playTo, seek };
}

function setup() {
  const player = fakeVideo();
  const seekTo = vi.fn<(seconds: number) => Promise<boolean>>().mockResolvedValue(true);
  navigation = createLineNavigation({ getVideo: () => player.video, seekTo });

  /** Plays through `lines`, reporting each cue the way the adapter does. */
  const watch = (lines: Array<[string, number, number]>, until: number) => {
    for (const [text, start, end] of lines) {
      if (start > until) break;
      player.playTo(start);
      navigation!.cueChanged(text);
      if (end > until) break;
      player.playTo(end);
      navigation!.cueChanged(null);
    }
    player.playTo(until);
  };
  return { ...player, seekTo, watch };
}

function pressA(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const scene: Array<[string, number, number]> = [
  ["Hello there", 1, 3],
  ["I am student in TI", 3.5, 5.5],
  ["and you", 6, 8],
];

afterEach(() => {
  navigation?.stop();
  navigation = undefined;
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
});

describe("the A key", () => {
  it("goes from 'and you' straight back to 'I am student in TI'", () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    pressA();

    expect(seekTo).toHaveBeenCalledWith(3.5 - PRE_ROLL);
  });

  it("keeps the player from also handling the key when it jumps", () => {
    const { watch } = setup();
    watch(scene, 6.5);

    expect(pressA().defaultPrevented).toBe(true);
  });

  it("steps back one more line on a quick second press, before the first seek lands", () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    pressA();
    pressA();

    expect(seekTo).toHaveBeenLastCalledWith(1 - PRE_ROLL);
  });

  it("steps from the real position once the seek has landed", () => {
    const { seekTo, watch, seek, playTo } = setup();
    watch(scene, 6.5);
    pressA();
    seek(3.25);
    playTo(4);

    pressA();

    expect(seekTo).toHaveBeenLastCalledWith(1 - PRE_ROLL);
  });

  it("lets the key through when there is nothing to go back to", () => {
    const { seekTo } = setup();

    const event = pressA();

    expect(seekTo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not jump back across a stretch that was skipped", () => {
    const { seekTo, watch, seek, playTo } = setup();
    watch(scene.slice(0, 1), 4);
    seek(100);
    playTo(100.5);
    navigation!.cueChanged("Much later");
    playTo(101);

    pressA();

    // Restarts the line on screen rather than leaping back 96 seconds.
    expect(seekTo).toHaveBeenCalledWith(100.5 - PRE_ROLL);
  });
});

describe("when the key is not for us", () => {
  it("ignores it while typing in a field", () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);
    const input = document.createElement("input");
    document.body.append(input);

    pressA(input);

    expect(seekTo).not.toHaveBeenCalled();
  });

  it("ignores it with Ctrl, Alt or Meta, and when held down", () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    pressA(document.body, { ctrlKey: true });
    pressA(document.body, { altKey: true });
    pressA(document.body, { metaKey: true });
    pressA(document.body, { repeat: true });

    expect(seekTo).not.toHaveBeenCalled();
  });

  it("forgets the lines of the previous episode", () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    window.history.replaceState({}, "", "/watch/next-episode");
    pressA();

    expect(seekTo).not.toHaveBeenCalled();
  });

  it("stops listening when stopped", () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    navigation!.stop();
    pressA();

    expect(seekTo).not.toHaveBeenCalled();
  });

  it("does nothing on a platform that cannot seek", () => {
    navigation = createLineNavigation({});

    expect(() => navigation!.cueChanged("Hello")).not.toThrow();
    expect(pressA().defaultPrevented).toBe(false);
  });
});
