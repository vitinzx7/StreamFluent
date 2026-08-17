export const EXTENSION_MARKER = "data-streamfluent";

export function isExtensionElement(el: Node): boolean {
  if (el instanceof HTMLElement) {
    if (el.hasAttribute(EXTENSION_MARKER)) return true;
    if (el.closest(`[${EXTENSION_MARKER}]`)) return true;
  }
  return false;
}

export function mutationHasExtensionNode(mutations: MutationRecord[]): boolean {
  for (const m of mutations) {
    if (isExtensionElement(m.target)) return true;
    for (const node of Array.from(m.addedNodes)) {
      if (isExtensionElement(node)) return true;
    }
    for (const node of Array.from(m.removedNodes)) {
      if (isExtensionElement(node)) return true;
    }
  }
  return false;
}

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
  // Only get direct text spans, not nested extension elements
  const spans = container.querySelectorAll("span");
  if (spans.length === 0) {
    const text = container.textContent?.trim();
    return text || null;
  }

  const lines: string[] = [];
  for (const span of spans) {
    // Skip any spans that belong to our extension
    if (isExtensionElement(span)) continue;
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
