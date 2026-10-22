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

/**
 * Walks text nodes rather than elements. Both players nest their cue markup
 * (`<span><span>text</span></span>`), and an element's textContent already
 * contains its descendants' — collecting per element therefore yielded every
 * word once per level of nesting, which showed up as a doubled subtitle.
 */
export function extractSubtitleText(container: HTMLElement): string | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      // Never read back the overlay we injected ourselves.
      if (parent && isExtensionElement(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) parts.push(text);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

const NATIVE_HIDDEN_MARKER = "data-streamfluent-native-hidden";
const NATIVE_HIDDEN_STYLE_ID = "streamfluent-native-hidden";

function ensureNativeHiddenStyle(doc: Document): void {
  if (doc.getElementById(NATIVE_HIDDEN_STYLE_ID)) return;

  const style = doc.createElement("style");
  style.id = NATIVE_HIDDEN_STYLE_ID;
  style.setAttribute(EXTENSION_MARKER, "");
  // A stylesheet rule (not an inline style) because the players rewrite the
  // inline `style` of their cue containers on every cue, which would wipe the
  // hiding out again. `!important` on a stylesheet rule beats their inline
  // styles. Opacity rather than `display: none` so the cue container keeps its
  // box: the players measure it to position cues, and we still read its text.
  style.textContent = `[${NATIVE_HIDDEN_MARKER}] { opacity: 0 !important; pointer-events: none !important; }`;
  (doc.head || doc.documentElement).appendChild(style);
}

/**
 * Walks up from a matched cue container to the outermost ancestor that still
 * matches one of `selectors`. Players recreate the inner per-cue container on
 * every line, so hiding only that one leaves the next line visible for a frame;
 * the outer wrapper is created once and stays put.
 */
export function findSubtitleRoot(container: HTMLElement, selectors: string[]): HTMLElement {
  let root = container;
  for (let parent = root.parentElement; parent; parent = root.parentElement) {
    const candidate = parent;
    if (!selectors.some((sel) => candidate.matches(sel))) break;
    root = candidate;
  }
  return root;
}

/** Works in the container's own document: the HTML5 player can sit in a same-origin frame. */
export function hideNativeSubtitles(container: HTMLElement): void {
  ensureNativeHiddenStyle(container.ownerDocument);
  if (!container.hasAttribute(NATIVE_HIDDEN_MARKER)) container.setAttribute(NATIVE_HIDDEN_MARKER, "");
}

export function restoreNativeSubtitles(doc: Document = document): void {
  doc.querySelectorAll(`[${NATIVE_HIDDEN_MARKER}]`).forEach((el) => {
    el.removeAttribute(NATIVE_HIDDEN_MARKER);
  });
  doc.getElementById(NATIVE_HIDDEN_STYLE_ID)?.remove();
}

export function findElement(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

export function createDebouncedCallback(fn: () => void, delay: number): (() => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const callback = () => {
    cancel();
    timer = setTimeout(() => { timer = null; fn(); }, delay);
  };
  return Object.assign(callback, { cancel });
}
