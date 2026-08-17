import type { StreamingAdapter, SubtitleCue, MediaMetadata } from "../core/types.ts";

const SUBTITLE_CONTAINER_SELECTORS = [
  "[data-testid='player-subtitle']",
  ".subtitle-container",
  "[class*='subtitle']",
  "[class*='captions']",
  ".text-track-container",
];

const EPISODE_INFO_SELECTORS = [
  "[data-testid='content-detail']",
  ".episode-info",
  "[class*='episode']",
  "[class*='season']",
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
    const maxSuffix = title
      .replace(/\s*[-|]\s*Max\s*$/i, "")
      .replace(/\s*[-|]\s*HBO\s*Max\s*$/i, "")
      .trim();
    if (!maxSuffix) return null;

    let season: number | null = null;
    let episode: number | null = null;

    // Try title first
    const titleSE = parseSeasonEpisode(maxSuffix);
    season = titleSE.season;
    episode = titleSE.episode;

    // Try DOM elements
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

    let cleanTitle = maxSuffix;
    if (season !== null) {
      cleanTitle = cleanTitle.replace(/:\s*Season\s+\d+.*$/i, "").trim();
    }

    return { title: cleanTitle, season, episode };
  }
}
