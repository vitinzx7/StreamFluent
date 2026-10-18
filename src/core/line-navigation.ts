import { createLineTimeline, type CurrentLine } from "./line-timeline.ts";
import type { StreamingAdapter } from "./types.ts";

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

/**
 * Behind the "A" key: back to the start of the previous subtitle line, instead
 * of the player's fixed 10-second rewind. Line times are learned while
 * watching. The key itself, and the seek, belong to the shortcut router and
 * the playback controller; this only knows where "previous" is.
 */
export function createLineNavigation(adapter: Seekable): LineNavigation {
  if (!adapter.getVideo || !adapter.seekTo) return NO_NAVIGATION;

  const timeline = createLineTimeline();
  let video: HTMLVideoElement | null = null;
  let path = location.pathname;
  let lastTime = 0;

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
    },

    stop(): void {
      unbind();
      timeline.clear();
    },
  };
}
