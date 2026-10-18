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

const SUBTITLE_SELECTORS = [
  "[data-testid='player-subtitle']",
  "[class*='subtitle']",
  "[class*='captions']",
  ".text-track-container",
];

const PLAYER_SELECTORS = [
  "[data-testid='player']",
  ".player-container",
  "[class*='player']",
];

const EPISODE_SELECTORS = [
  "[data-testid='content-detail']",
  "[class*='episode']",
  "[class*='season']",
];

export class MaxAdapter implements StreamingAdapter {
  name = "Max";
  private observer: MutationObserver | null = null;
  private lastText: string | null = null;

  isSupportedPage(): boolean {
    const host = location.hostname;
    return host.includes("max.com") || host.includes("hbomax.com");
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
      if (mutationHasExtensionNode(mutations)) return;
      check();
    });

    const player = findElement(PLAYER_SELECTORS);
    const target = player || document.body;

    this.observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });

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

      retryTimeout = setTimeout(() => clearInterval(retryInterval), 30000);
    }

    return cleanup;
  }

  getVideo(): HTMLVideoElement | null {
    return document.querySelector("video");
  }

  /** Assumes Max's player tolerates a direct seek — not verified on the real site. */
  async play(): Promise<boolean> { try { const video = this.getVideo(); if (!video) return false; await video.play(); return !video.paused; } catch { return false; } }
  async pause(): Promise<boolean> { try { const video = this.getVideo(); if (!video) return false; video.pause(); return video.paused; } catch { return false; } }

  async seekTo(seconds: number): Promise<boolean> {
    const video = this.getVideo();
    if (!video || !Number.isFinite(seconds)) return false;
    video.currentTime = Math.max(0, seconds);
    return true;
  }

  getMediaMetadata(): MediaMetadata | null {
    const title = document.title;
    const clean = title
      .replace(/\s*[-|]\s*Max\s*$/i, "")
      .replace(/\s*[-|]\s*HBO\s*Max\s*$/i, "")
      .trim();
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
