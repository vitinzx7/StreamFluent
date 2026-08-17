import type { StreamingAdapter, SubtitleCue, MediaMetadata } from "../core/types.ts";
import {
  parseSeasonEpisode,
  extractSubtitleText,
  findElement,
  createDebouncedCallback,
  mutationHasExtensionNode,
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
    const cleanup = () => {
      this.observer?.disconnect();
      this.observer = null;
      this.lastText = null;
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

      const text = extractSubtitleText(container);
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
      const retryInterval = setInterval(() => {
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

      setTimeout(() => clearInterval(retryInterval), 30000);
    }

    return cleanup;
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
