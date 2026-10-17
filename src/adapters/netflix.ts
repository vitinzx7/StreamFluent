import type { StreamingAdapter, SubtitleCue, MediaMetadata } from "../core/types.ts";
import {
  parseSeasonEpisode,
  extractSubtitleText,
  findElement,
  createDebouncedCallback,
  mutationHasExtensionNode,
  hideNativeSubtitles,
  restoreNativeSubtitles,
  findSubtitleRoot,
} from "../core/dom-utils.ts";
import { requestNetflixSeek } from "../core/netflix-bridge.ts";

const SUBTITLE_SELECTORS = [
  "[data-testid='player-timedtext-text-container']",
  "[class*='timedtext']",
  ".player-timedtext",
];

const PLAYER_SELECTORS = [
  ".netflix-player",
  ".PlayerContainer",
  "[data-testid='player']",
  "#netflix-player",
];

const EPISODE_SELECTORS = [
  "[data-testid='player-detail-text']",
  "[data-testid='ep-title']",
  "[class*='episode']",
];

export class NetflixAdapter implements StreamingAdapter {
  name = "Netflix";
  private observer: MutationObserver | null = null;
  private lastText: string | null = null;

  isSupportedPage(): boolean {
    return location.hostname.includes("netflix.com");
  }

  observeSubtitles(onCue: (cue: SubtitleCue | null) => void): () => void {
    let retryInterval: ReturnType<typeof setInterval> | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      check.cancel();
      clearInterval(retryInterval);
      clearTimeout(retryTimeout);
      this.observer?.disconnect();
      this.observer = null;
      this.lastText = null;
      restoreNativeSubtitles();
    };

    const check = createDebouncedCallback(() => {
      const container = findElement(SUBTITLE_SELECTORS);
      if (!container) {
        if (this.lastText !== null) {
          this.lastText = null;
          onCue(null);
        }
        return;
      }

      // Read from the same root we hide: a multi-line cue is split across sibling
      // containers, and findElement only ever returns the first of them.
      const root = findSubtitleRoot(container, SUBTITLE_SELECTORS);
      const text = extractSubtitleText(root);

      // Only hide the native cues once we know we can actually read them, so a
      // stale selector degrades to "extension does nothing" instead of "no
      // subtitles at all". Re-applied on every check (cheap, idempotent) so a
      // player that rebuilds its subtitle DOM gets re-hidden.
      if (text) hideNativeSubtitles(root);

      if (text === this.lastText) return;
      this.lastText = text;
      onCue(text ? { text, start: 0, end: 0 } : null);
    }, 100);

    this.observer = new MutationObserver((mutations) => {
      // Skip mutations that only involve our own extension elements
      if (mutationHasExtensionNode(mutations)) return;
      check();
    });

    // Try to observe the player container to reduce noise.
    // Fall back to document.body if player not found yet.
    const player = findElement(PLAYER_SELECTORS);
    const target = player || document.body;

    this.observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // If we fell back to body, retry finding the player periodically
    // and switch to it once available (reduces noise significantly).
    if (!player) {
      retryInterval = setInterval(() => {
        const p = findElement(PLAYER_SELECTORS);
        if (p && this.observer) {
          this.observer.disconnect();
          this.observer.observe(p, {
            childList: true,
            subtree: true,
            characterData: true,
          });
          clearInterval(retryInterval);
        }
      }, 1000);

      // Stop retrying after 30 seconds
      retryTimeout = setTimeout(() => clearInterval(retryInterval), 30000);
    }

    return cleanup;
  }

  getVideo(): HTMLVideoElement | null {
    return document.querySelector("video");
  }

  /**
   * Netflix's player errors out (M7375) when the <video> time is set directly,
   * so this goes through its own player API, reachable only from the page's
   * JavaScript world — see src/core/netflix-bridge.ts.
   */
  seekTo(seconds: number): Promise<boolean> {
    return requestNetflixSeek(seconds);
  }

  getMediaMetadata(): MediaMetadata | null {
    const title = document.title;
    const clean = title.replace(/\s*\|\s*Netflix\s*$/i, "").trim();
    if (!clean) return null;

    let { season, episode } = parseSeasonEpisode(clean);

    if (season === null && episode === null) {
      const el = findElement(EPISODE_SELECTORS);
      if (el) {
        const se = parseSeasonEpisode(el.textContent || "");
        if (se.season !== null) season = se.season;
        if (se.episode !== null) episode = se.episode;
      }
    }

    let displayTitle = clean;
    if (season !== null) {
      displayTitle = displayTitle.replace(/:\s*Season\s+\d+.*$/i, "").trim();
    }

    return { title: displayTitle, season, episode };
  }
}
