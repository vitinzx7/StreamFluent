import type { StreamingAdapter, SubtitleCue, MediaMetadata } from "../core/types.ts";

const SUBTITLE_CONTAINER_SELECTORS = [
  ".player-timedtext",
  "[class*='timedtext']",
  "[data-testid='player-timedtext-text-container']",
  ".text-container",
];

const EPISODE_INFO_SELECTORS = [
  "[data-testid='player-detail-text']",
  ".episode-title",
  "[class*='episode']",
  "[data-testid='ep-title']",
];

function findSubtitleContainer(): HTMLElement | null {
  for (const sel of SUBTITLE_CONTAINER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

function extractText(container: HTMLElement): string | null {
  const spans = container.querySelectorAll("span");
  if (spans.length === 0) {
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

function parseSeasonEpisode(text: string): { season: number | null; episode: number | null } {
  let season: number | null = null;
  let episode: number | null = null;

  // Pattern: "S2E4" or "S02E04" or "Season 2, Episode 4"
  const compactMatch = text.match(/S\s*(\d+)\s*E\s*(\d+)/i);
  if (compactMatch) {
    season = parseInt(compactMatch[1], 10);
    episode = parseInt(compactMatch[2], 10);
    return { season, episode };
  }

  const seasonMatch = text.match(/Season\s+(\d+)/i);
  const episodeMatch = text.match(/Episode\s+(\d+)/i);
  if (seasonMatch) season = parseInt(seasonMatch[1], 10);
  if (episodeMatch) episode = parseInt(episodeMatch[1], 10);

  return { season, episode };
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
        onCue({ text, start: 0, end: 0 });
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
    const title = document.title;
    const netflixSuffix = title.replace(/\s*\|\s*Netflix\s*$/i, "").trim();
    if (!netflixSuffix) return null;

    let season: number | null = null;
    let episode: number | null = null;

    // Try to extract from page title
    // Format: "Show Name: Season 2, Episode 4: Episode Title"
    const titleSE = parseSeasonEpisode(netflixSuffix);
    season = titleSE.season;
    episode = titleSE.episode;

    // If not found in title, try DOM elements
    if (season === null && episode === null) {
      for (const sel of EPISODE_INFO_SELECTORS) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          const epText = el.textContent || "";
          const domSE = parseSeasonEpisode(epText);
          if (domSE.season !== null) season = domSE.season;
          if (domSE.episode !== null) episode = domSE.episode;
          if (season !== null || episode !== null) break;
        }
      }
    }

    // Clean up title: remove season/episode info from the display title
    let cleanTitle = netflixSuffix;
    if (season !== null) {
      cleanTitle = cleanTitle.replace(/:\s*Season\s+\d+.*$/i, "").trim();
    }

    return { title: cleanTitle, season, episode };
  }
}
