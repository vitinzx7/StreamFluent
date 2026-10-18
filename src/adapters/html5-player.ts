import type { PlayerSnapshot } from "../core/player-types.ts";

const MEDIA_EVENTS = [
  "play", "pause", "timeupdate", "seeking", "seeked", "ratechange",
  "loadedmetadata", "loadeddata", "emptied", "durationchange",
] as const;

function isHidden(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    if (current.hasAttribute("hidden") || style?.display === "none"
      || style?.visibility === "hidden" || style?.visibility === "collapse"
      || style?.opacity === "0") return true;
  }
  return false;
}

/** Keep diagnostic text free of embedded credentials, episode paths and tokens. */
function frameOrigin(frame: HTMLIFrameElement): string | null {
  try {
    if (frame.hasAttribute("srcdoc")) return null;
    const source = frame.getAttribute("src")?.trim();
    if (!source) return null;
    const url = new URL(source, frame.ownerDocument.baseURI);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Only inspect DOM that the browser permits us to read; never fetch frame URLs. */
function findVideos(root: Document, includeFrames: boolean): { videos: HTMLVideoElement[]; blockedFrame: boolean; blockedOrigins: string[] } {
  const videos: HTMLVideoElement[] = [];
  let blockedFrame = false;
  const blockedOrigins = new Set<string>();
  const recordBlocked = (frame: HTMLIFrameElement): void => {
    blockedFrame = true;
    const origin = frameOrigin(frame);
    if (origin) blockedOrigins.add(origin);
  };
  const visit = (doc: Document, depth: number): void => {
    for (const video of doc.querySelectorAll("video")) {
      if (!isHidden(video)) videos.push(video);
    }
    if (!includeFrames || depth >= 3) return;
    for (const frame of doc.querySelectorAll("iframe")) {
      if (isHidden(frame)) continue;
      try {
        const child = frame.contentDocument;
        if (child) visit(child, depth + 1);
        else recordBlocked(frame);
      } catch {
        recordBlocked(frame);
      }
    }
  };
  visit(root, 0);
  return { videos, blockedFrame, blockedOrigins: [...blockedOrigins].sort() };
}

function visibleArea(video: HTMLVideoElement): number {
  const rect = video.getBoundingClientRect();
  const view = video.ownerDocument.defaultView;
  if (!view) return 0;
  const width = Math.max(0, Math.min(rect.right, view.innerWidth) - Math.max(0, rect.left));
  const height = Math.max(0, Math.min(rect.bottom, view.innerHeight) - Math.max(0, rect.top));
  return width * height;
}

/**
 * A small HTML5 clock, independent of the Netflix/Max DOM subtitle adapters.
 * Polling also covers history.pushState, iframe navigation and video replacement
 * without patching site APIs or observing every subtitle/UI DOM mutation.
 */
export function observeHtml5Player(
  onChange: (state: PlayerSnapshot) => void,
  options: { includeFrames?: boolean } = {},
): () => void {
  let stopped = false;
  let video: HTMLVideoElement | null = null;
  let blockedFrame = false;
  let blockedOrigins: string[] = [];
  let videoIdentity = 0;
  let generation = 0;
  let signature = "";
  let sessionKey = "";
  let previous: PlayerSnapshot | null = null;
  let boundTracks: TextTrack[] = [];

  const readTracks = (): TextTrack[] => video ? Array.from(video.textTracks) : [];

  const emit = (force = false): void => {
    if (stopped) return;
    const source = video ? [
      video.ownerDocument.location?.href ?? "",
      video.getAttribute("src") ?? "",
      video.currentSrc,
      ...Array.from(video.querySelectorAll("source"), (item) => item.src),
    ] : [];
    const nextSignature = JSON.stringify([location.href, videoIdentity, source]);
    if (nextSignature !== signature) {
      signature = nextSignature;
      sessionKey = `${++generation}:${signature}`;
    }
    const state: PlayerSnapshot = {
      video,
      sessionKey,
      currentTime: video && Number.isFinite(video.currentTime) ? video.currentTime : 0,
      paused: video?.paused ?? true,
      seeking: video?.seeking ?? false,
      playbackRate: video && Number.isFinite(video.playbackRate) ? video.playbackRate : 1,
      tracks: readTracks(),
      status: video ? "Player HTML5 conectado." : blockedFrame
        ? "Nenhum vídeo acessível. Há um iframe inacessível (outro domínio, sandbox ou redirecionamento)."
          + (blockedOrigins.length ? ` Origens declaradas dos iframes inacessíveis: ${blockedOrigins.join(", ")}.` : "")
        : "Nenhum vídeo HTML5 acessível encontrado. Aguardando o player.",
    };
    if (!force && previous && previous.video === state.video
      && previous.sessionKey === state.sessionKey && previous.currentTime === state.currentTime
      && previous.paused === state.paused && previous.seeking === state.seeking
      && previous.playbackRate === state.playbackRate
      && previous.status === state.status && previous.tracks.length === state.tracks.length
      && previous.tracks.every((track, index) => track === state.tracks[index])) return;
    previous = state;
    onChange(state);
  };

  const onCueChange = (): void => emit(true);
  const syncTracks = (): void => {
    const tracks = readTracks();
    for (const track of boundTracks) {
      if (!tracks.includes(track)) track.removeEventListener("cuechange", onCueChange);
    }
    for (const track of tracks) {
      if (!boundTracks.includes(track)) track.addEventListener("cuechange", onCueChange);
    }
    boundTracks = tracks;
  };
  const onMediaChange = (): void => {
    syncTracks();
    emit(true);
  };
  const unbind = (): void => {
    if (video) {
      for (const event of MEDIA_EVENTS) video.removeEventListener(event, onMediaChange);
      for (const event of ["addtrack", "removetrack", "change"]) {
        video.textTracks.removeEventListener(event, onMediaChange);
      }
      video.removeEventListener("load", onMediaChange, true);
    }
    for (const track of boundTracks) track.removeEventListener("cuechange", onCueChange);
    boundTracks = [];
  };
  const discover = (): void => {
    if (stopped) return;
    const found = findVideos(document, options.includeFrames !== false);
    blockedFrame = found.blockedFrame;
    blockedOrigins = found.blockedOrigins;
    // Stable ordering keeps an equally sized secondary player from stealing the
    // session. Nonzero viewport area always wins over a zero-size placeholder.
    const candidates = found.videos.sort((a, b) => visibleArea(b) - visibleArea(a)
      || Number(b === video) - Number(a === video));
    const next = candidates[0] ?? null;
    if (next !== video) {
      unbind();
      video = next;
      videoIdentity++;
      if (video) {
        for (const event of MEDIA_EVENTS) video.addEventListener(event, onMediaChange);
        for (const event of ["addtrack", "removetrack", "change"]) {
          video.textTracks.addEventListener(event, onMediaChange);
        }
        // <track> load does not bubble; capture catches asynchronously loaded cues.
        video.addEventListener("load", onMediaChange, true);
      }
    }
    syncTracks();
    emit();
  };

  discover();
  const discoveryTimer = window.setInterval(discover, 500);
  const clockTimer = window.setInterval(() => emit(), 50);
  return () => {
    stopped = true;
    window.clearInterval(discoveryTimer);
    window.clearInterval(clockTimer);
    unbind();
    video = null;
    previous = null;
  };
}
