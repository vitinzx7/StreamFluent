/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createLineNavigation, type LineNavigation } from "../core/line-navigation.ts";
import { PRE_ROLL } from "../core/line-timeline.ts";
import { createPlaybackController, type PlaybackController } from "../core/playback-controller.ts";
import { installShortcuts } from "../core/keyboard-shortcuts.ts";

let navigation: LineNavigation | undefined;
let controller: PlaybackController | undefined;
let uninstall: (() => void) | undefined;

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
  Object.defineProperty(video, "duration", { configurable: true, value: 600 });
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

/**
 * The A key as the extension wires it: the central shortcut router, the shared
 * playback controller, and the line timeline that knows where "previous" is.
 */
function setup() {
  const player = fakeVideo();
  // Lands where asked, the way a cooperative player does.
  const seekTo = vi.fn(async (seconds: number) => {
    player.seek(seconds);
    return true;
  });
  const adapter = { getVideo: () => player.video, seekTo };
  navigation = createLineNavigation(adapter);
  controller = createPlaybackController(
    { ...adapter, getSessionId: () => location.pathname, play: async () => true, pause: async () => true },
    { backTarget: (from) => navigation!.backTarget(from) }
  );
  const commands = controller;
  uninstall = installShortcuts(window, {
    isActive: () => true,
    canRun: (command) => command === "previous" && commands.canPrevious(),
    run: () => void commands.previous(),
  });

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

/** Lets queued seeks run and land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

const scene: Array<[string, number, number]> = [
  ["Hello there", 1, 3],
  ["I am student in TI", 3.5, 5.5],
  ["and you", 6, 8],
];

afterEach(() => {
  uninstall?.();
  controller?.stop();
  navigation?.stop();
  uninstall = undefined;
  controller = undefined;
  navigation = undefined;
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
});

describe("the A key", () => {
  it("goes from 'and you' straight back to 'I am student in TI'", async () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    pressA();
    await settle();

    expect(seekTo).toHaveBeenCalledWith(3.5 - PRE_ROLL);
  });

  it("keeps the player from also handling the key when it jumps", () => {
    const { watch } = setup();
    watch(scene, 6.5);

    expect(pressA().defaultPrevented).toBe(true);
  });

  it("steps back one more line on a quick second press, before the first seek lands", async () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    pressA();
    pressA();
    await settle();

    expect(seekTo.mock.calls).toEqual([[3.5 - PRE_ROLL], [1 - PRE_ROLL]]);
  });

  it("steps from the real position once the seek has landed", async () => {
    const { seekTo, watch, playTo } = setup();
    watch(scene, 6.5);
    pressA();
    await settle();
    playTo(4);

    pressA();
    await settle();

    expect(seekTo).toHaveBeenLastCalledWith(1 - PRE_ROLL);
  });

  it("lets the key through when there is nothing to go back to", async () => {
    const { seekTo } = setup();

    const event = pressA();
    await settle();

    expect(seekTo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not jump back across a stretch that was skipped", async () => {
    const { seekTo, watch, seek, playTo } = setup();
    watch(scene.slice(0, 1), 4);
    seek(100);
    playTo(100.5);
    navigation!.cueChanged("Much later");
    playTo(101);

    pressA();
    await settle();

    // Restarts the line on screen rather than leaping back 96 seconds.
    expect(seekTo).toHaveBeenCalledWith(100.5 - PRE_ROLL);
  });
});

describe("when the key is not for us", () => {
  it("ignores it while typing in a field", async () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);
    const input = document.createElement("input");
    document.body.append(input);

    pressA(input);
    await settle();

    expect(seekTo).not.toHaveBeenCalled();
  });

  it("ignores it with Ctrl, Alt or Meta, and when held down", async () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    pressA(document.body, { ctrlKey: true });
    pressA(document.body, { altKey: true });
    pressA(document.body, { metaKey: true });
    pressA(document.body, { repeat: true });
    await settle();

    expect(seekTo).not.toHaveBeenCalled();
  });

  it("forgets the lines of the previous episode", async () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    window.history.replaceState({}, "", "/watch/next-episode");
    pressA();
    await settle();

    expect(seekTo).not.toHaveBeenCalled();
  });

  it("stops listening when stopped", async () => {
    const { seekTo, watch } = setup();
    watch(scene, 6.5);

    uninstall?.();
    navigation!.stop();
    pressA();
    await settle();

    expect(seekTo).not.toHaveBeenCalled();
  });

  it("does nothing on a platform that cannot seek", () => {
    const blind = createLineNavigation({});

    expect(() => blind.cueChanged("Hello")).not.toThrow();
    expect(blind.backTarget()).toBeNull();
  });

  it("installs no keyboard listener of its own", async () => {
    const player = fakeVideo();
    const seekTo = vi.fn(async () => true);
    navigation = createLineNavigation({ getVideo: () => player.video, seekTo });
    player.playTo(1);
    navigation.cueChanged("Hello there");
    player.playTo(4);

    const event = pressA();
    await settle();

    expect(seekTo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("reports the line on screen and the end of the line before it, for S", () => {
    const { watch } = setup();
    watch(scene, 4);

    expect(navigation!.current()).toEqual({ start: 3.5, end: null, previousEnd: 3 });
  });
});
