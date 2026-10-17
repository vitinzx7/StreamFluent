/**
 * Seeking Netflix from the extension.
 *
 * Netflix's player errors out (M7375) when the <video> element's time is set
 * directly; a seek has to go through Netflix's own player object, which exists
 * only in the page's JavaScript world. Content scripts run in an isolated
 * world, so the two sides talk through DOM events: src/content/netflix-main.ts
 * runs in the page world (manifest "world": "MAIN") and performs the seek.
 * Only strings cross between the two worlds intact, hence the JSON payloads.
 */
export const SEEK_REQUEST_EVENT = "streamfluent:netflix-seek";
export const SEEK_RESULT_EVENT = "streamfluent:netflix-seek-result";

export interface SeekRequest {
  id: number;
  ms: number;
}

export interface SeekResult {
  id: number;
  ok: boolean;
}

function parseObject(detail: unknown): Record<string, unknown> | null {
  if (typeof detail !== "string") return null;
  try {
    const value: unknown = JSON.parse(detail);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Requests come through the page's DOM, so anything could send one: validate. */
export function decodeSeekRequest(detail: unknown): SeekRequest | null {
  const value = parseObject(detail);
  if (!value) return null;
  const { id, ms } = value;
  if (typeof id !== "number" || typeof ms !== "number") return null;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return { id, ms };
}

export function decodeSeekResult(detail: unknown): SeekResult | null {
  const value = parseObject(detail);
  if (!value) return null;
  const { id, ok } = value;
  if (typeof id !== "number" || typeof ok !== "boolean") return null;
  return { id, ok };
}

let nextId = 0;

/**
 * Content-script side. Resolves false when the page-world script did not
 * answer (not loaded) or could not reach Netflix's player. Never falls back to
 * setting the video's time directly: that is exactly what crashes Netflix.
 */
export function requestNetflixSeek(seconds: number, timeoutMs = 1000): Promise<boolean> {
  if (!Number.isFinite(seconds) || seconds < 0) return Promise.resolve(false);
  const id = ++nextId;

  return new Promise((resolve) => {
    const finish = (ok: boolean): void => {
      document.removeEventListener(SEEK_RESULT_EVENT, onResult);
      clearTimeout(timer);
      resolve(ok);
    };
    const onResult = (event: Event): void => {
      const result = decodeSeekResult((event as CustomEvent).detail);
      if (result?.id === id) finish(result.ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    document.addEventListener(SEEK_RESULT_EVENT, onResult);
    document.dispatchEvent(
      new CustomEvent(SEEK_REQUEST_EVENT, {
        detail: JSON.stringify({ id, ms: Math.round(seconds * 1000) }),
      })
    );
  });
}

interface NetflixPlayer {
  seek(ms: number): void;
}

interface NetflixVideoPlayerApi {
  getAllPlayerSessionIds?(): unknown;
  getVideoPlayerBySessionId?(id: string): unknown;
}

interface NetflixGlobal {
  appContext?: {
    state?: { playerApp?: { getAPI?(): { videoPlayer?: NetflixVideoPlayerApi } | undefined } };
  };
}

/** Netflix's undocumented player API: any missing piece means "cannot seek". */
function findNetflixPlayer(win: Window): NetflixPlayer | null {
  const netflix = (win as Window & { netflix?: NetflixGlobal }).netflix;
  const api = netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const ids = api?.getAllPlayerSessionIds?.();
  if (!api || !Array.isArray(ids)) return null;

  const sessions = ids.filter((id): id is string => typeof id === "string");
  // The playing title's session is named "watch-…"; others are previews.
  const id = sessions.find((session) => session.startsWith("watch")) ?? sessions[0];
  if (!id) return null;

  const player = api.getVideoPlayerBySessionId?.(id) as Partial<NetflixPlayer> | undefined;
  return typeof player?.seek === "function" ? (player as NetflixPlayer) : null;
}

/**
 * Page-world side, installed by src/content/netflix-main.ts. It has no
 * extension privileges and does one thing — seek Netflix's player on request —
 * which any script on the page could already do.
 */
export function handleNetflixSeekRequests(win: Window): () => void {
  const doc = win.document;
  const onRequest = (event: Event): void => {
    const request = decodeSeekRequest((event as CustomEvent).detail);
    if (!request) return;

    let ok = false;
    try {
      const player = findNetflixPlayer(win);
      if (player) {
        player.seek(Math.round(request.ms));
        ok = true;
      }
    } catch {
      ok = false;
    }
    doc.dispatchEvent(
      new CustomEvent(SEEK_RESULT_EVENT, { detail: JSON.stringify({ id: request.id, ok }) })
    );
  };

  doc.addEventListener(SEEK_REQUEST_EVENT, onRequest);
  return () => doc.removeEventListener(SEEK_REQUEST_EVENT, onRequest);
}
