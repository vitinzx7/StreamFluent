export function parseSeasonEpisode(text: string): { season: number | null; episode: number | null } {
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

export function extractSubtitleText(container: HTMLElement): string | null {
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

export function findElement(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

export function createDebouncedCallback(fn: () => void, delay: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}
