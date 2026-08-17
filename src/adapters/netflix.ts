import type { StreamingAdapter, SubtitleCue, MediaMetadata } from "../core/types.ts";
import {
  parseSeasonEpisode,
  extractSubtitleText,
  findElement,
  createDebouncedCallback,
} from "../core/dom-utils.ts";

const SUBTITLE_SELECTORS = [
  "[data-testid='player-timedtext-text-container']",
  "[class*='timedtext']",
  ".player-timedtext",
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
    }, 50);

    this.observer = new MutationObserver(check);

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return cleanup;
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
