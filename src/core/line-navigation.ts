import { createLineTimeline, type CurrentLine } from "./line-timeline.ts";
import type { StreamingAdapter } from "./types.ts";

/** Pressing it jumps to the start of the previous subtitle line. */
export const BACK_KEY = "a";

/**
 * A press within this long of the previous one steps back from where that
 * seek is going: the video's own time only catches up once the seek lands.
 */
const PENDING_SEEK_MS = 1500;

export interface LineNavigation {
  /** Every cue the adapter reports, so line times can be learned. */
  cueChanged(text: string | null): void;
  /** Where "previous line" lands from `from` (default: now), or null when unknown. */
  backTarget(from?: number): number | null;
  /** Recorded times of the line on screen, for repeating it. */
  current(): CurrentLine | null;
  reset(): void;
  stop(): void;
}

type Seekable = Pick<StreamingAdapter, "getVideo" | "seekTo">;

const NO_NAVIGATION: LineNavigation = {
  cueChanged() {},
  backTarget: () => null,
  current: () => null,
  reset() {},
  stop() {},
};

/** Typing an "a" in a search box or our own panel must stay an "a". */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The "A" key: back to the start of the previous subtitle line, instead of the
 * player's fixed 10-second rewind. Line times are learned while watching.
 *
 * With `keyboard: false` it only learns and answers `backTarget`, and the key
 * itself is left to a central shortcut router.
 */
export function createLineNavigation(adapter: Seekable, options: { keyboard?: boolean } = {}): LineNavigation {
  if (!adapter.getVideo || !adapter.seekTo) return NO_NAVIGATION;

  const timeline = createLineTimeline();
  let video: HTMLVideoElement | null = null;
  let path = location.pathname;
  let lastTime = 0;
  let pending: { target: number; at: number } | null = null;

  const onTimeUpdate = (): void => {
    if (!video) return;
    timeline.played(lastTime, video.currentTime);
    lastTime = video.currentTime;
  };
  const onSeeking = (): void => {
    timeline.jumped();
    if (video) lastTime = video.currentTime;
  };
  const onSeeked = (): void => {
    pending = null;
    if (video) lastTime = video.currentTime;
  };

  const unbind = (): void => {
    video?.removeEventListener("timeupdate", onTimeUpdate);
    video?.removeEventListener("seeking", onSeeking);
    video?.removeEventListener("seeked", onSeeked);
    video = null;
  };

  /** Follows the platform's video; a new video or URL means a new episode. */
  const sync = (): HTMLVideoElement | null => {
    const current = adapter.getVideo?.() ?? null;
    if (current !== video || location.pathname !== path) {
      unbind();
      timeline.clear();
      pending = null;
      path = location.pathname;
      if (current) {
        video = current;
        lastTime = current.currentTime;
        current.addEventListener("timeupdate", onTimeUpdate);
        current.addEventListener("seeking", onSeeking);
        current.addEventListener("seeked", onSeeked);
      }
    }
    return video;
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() !== BACK_KEY || isTyping(event.target)) return;

    const current = sync();
    if (!current) return;
    const from =
      pending && Date.now() - pending.at < PENDING_SEEK_MS ? pending.target : current.currentTime;
    const target = timeline.backTarget(from);
    if (target === null) return;

    // Ours now: keep the player from also reacting to the key.
    event.preventDefault();
    event.stopPropagation();
    pending = { target, at: Date.now() };
    void adapter.seekTo?.(target).then((ok) => {
      if (!ok) pending = null;
    });
  };
  // Capture phase, so the player cannot swallow the key before we see it.
  if (options.keyboard !== false) window.addEventListener("keydown", handleKeydown, true);

  return {
    cueChanged(text: string | null): void {
      const current = sync();
      if (!current) return;
      if (text) timeline.lineShown(text, current.currentTime);
      else timeline.lineHidden(current.currentTime);
    },

    backTarget(from?: number): number | null {
      const current = sync();
      return current ? timeline.backTarget(from ?? current.currentTime) : null;
    },

    current(): CurrentLine | null {
      sync();
      return timeline.current();
    },

    reset(): void {
      timeline.clear();
      pending = null;
    },

    stop(): void {
      window.removeEventListener("keydown", handleKeydown, true);
      unbind();
      timeline.clear();
    },
  };
}
