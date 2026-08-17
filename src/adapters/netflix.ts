import type { StreamingAdapter, SubtitleCue, MediaMetadata } from "../core/types.ts";

// Netflix renders subtitles in a container inside the player overlay.
// The DOM structure uses obfuscated class names that change across versions,
// so we rely on structural patterns and data attributes rather than class names.

const SUBTITLE_CONTAINER_SELECTORS = [
  ".player-timedtext",
  "[class*='timedtext']",
  "[data-testid='player-timedtext-text-container']",
  ".text-container",
];

function findSubtitleContainer(): HTMLElement | null {
  for (const sel of SUBTITLE_CONTAINER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

function extractText(container: HTMLElement): string | null {
  // Netflix puts subtitle text in <span> elements inside the container.
  // We join all spans to handle multi-line subtitles.
  const spans = container.querySelectorAll("span");
  if (spans.length === 0) {
    // Sometimes the text is directly in the container
    const text = container.textContent?.trim();
    return text || null;
  }

  const lines: string[] = [];
  for (const span of spans) {
    const t = span.textContent?.trim();
    if (t) lines.push(t);
  }

  return lines.length > 0 ? lines.join(" ") : null;
}

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

    // We observe the entire document body for subtitle container changes
    // because Netflix dynamically creates/destroys subtitle elements.
    this.observer = new MutationObserver(() => {
      const container = findSubtitleContainer();
      if (!container) {
        if (this.lastText !== null) {
          this.lastText = null;
          onCue(null);
        }
        return;
      }

      const text = extractText(container);
      if (text === this.lastText) return;

      this.lastText = text;

      if (text) {
        onCue({
          text,
          start: 0,
          end: 0,
        });
      } else {
        onCue(null);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return cleanup;
  }

  getMediaMetadata(): MediaMetadata | null {
    // Netflix stores metadata in the page title and URL
    const title = document.title;
    // Title format: "Show Name: Season X, Episode Y: Title | Netflix"
    // or "Movie Name | Netflix"
    const netflixSuffix = title.replace(/\s*\|\s*Netflix\s*$/i, "").trim();
    if (!netflixSuffix) return null;

    // Try to detect season/episode from page content
    let season: number | null = null;
    let episode: number | null = null;

    // Look for episode info in the player controls or metadata
    const episodeEl = document.querySelector(
      "[data-testid='player-detail-text'], .episode-title, [class*='episode']"
    );
    if (episodeEl) {
      const epText = episodeEl.textContent || "";
      const seasonMatch = epText.match(/S\s*(\d+)/i);
      const episodeMatch = epText.match(/E\s*(\d+)/i);
      if (seasonMatch) season = parseInt(seasonMatch[1], 10);
      if (episodeMatch) episode = parseInt(episodeMatch[1], 10);
    }

    return {
      title: netflixSuffix,
      season,
      episode,
    };
  }
}
