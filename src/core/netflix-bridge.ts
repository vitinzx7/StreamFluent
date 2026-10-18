/**
 * Controlling Netflix's player from the extension.
 *
 * Netflix's player errors out (M7375) when the <video> element's time is set
 * directly; a seek has to go through Netflix's own player object, which exists
 * only in the page's JavaScript world. Content scripts run in an isolated
 * world, so the two sides talk through DOM events: src/content/netflix-main.ts
 * runs in the page world (manifest "world": "MAIN") and performs the action.
 * Only strings cross between the two worlds intact, hence the JSON payloads.
 *
 * The actions are a closed set. No method name or code ever travels in a
 * message, and nothing here falls back to writing video.currentTime.
 */
export const SEEK_REQUEST_EVENT = "streamfluent:netflix-seek";
export const SEEK_RESULT_EVENT = "streamfluent:netflix-seek-result";

/** `probe` answers whether the player has play/pause, without calling them. */
export type NetflixAction = "seek" | "play" | "pause" | "probe";

export type SeekRequest = { id: number; path: string } & (
  | { action: "seek"; ms: number }
  | { action: "play" | "pause" | "probe" }
);

export interface SeekResult {
  id: number;
  ok: boolean;
}

const REQUEST_FIELDS = ["id", "action", "ms", "path"];
const MAX_DETAIL_LENGTH = 4096;

function parseObject(detail: unknown): Record<string, unknown> | null {
  if (typeof detail !== "string" || detail.length > MAX_DETAIL_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(detail);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const isRequestId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;

/** Requests come through the page's DOM, so anything could send one: validate. */
export function decodeSeekRequest(detail: unknown): SeekRequest | null {
  const value = parseObject(detail);
  if (!value || Object.keys(value).some((key) => !REQUEST_FIELDS.includes(key))) return null;
  const { id, path, action, ms } = value;
  if (!isRequestId(id) || typeof path !== "string" || !path.startsWith("/")) return null;

  if (action === "seek") {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
    return { id, path, action, ms };
  }
  if ((action === "play" || action === "pause" || action === "probe") && !("ms" in value)) {
    return { id, path, action };
  }
  return null;
}

export function decodeSeekResult(detail: unknown): SeekResult | null {
  const value = parseObject(detail);
  if (!value) return null;
  const { id, ok } = value;
  if (!isRequestId(id) || typeof ok !== "boolean") return null;
  return { id, ok };
}

let nextId = 0;

/**
 * Content-script side. Resolves false when the page-world script did not
 * answer (not loaded), could not reach Netflix's player, or the episode
 * changed meanwhile — an answer for an older page never counts as success.
 */
export function requestNetflixAction(action: NetflixAction, seconds?: number, timeoutMs = 1000): Promise<boolean> {
  if (action === "seek" && (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)) {
    return Promise.resolve(false);
  }
  const id = ++nextId;
  const path = location.pathname;

  return new Promise((resolve) => {
    const finish = (ok: boolean): void => {
      document.removeEventListener(SEEK_RESULT_EVENT, onResult);
      clearTimeout(timer);
      resolve(ok && path === location.pathname);
    };
    const onResult = (event: Event): void => {
      const result = decodeSeekResult((event as CustomEvent).detail);
      if (result?.id === id) finish(result.ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    document.addEventListener(SEEK_RESULT_EVENT, onResult);
    // Seconds everywhere else; milliseconds only here, as Netflix's API wants.
    const ms = action === "seek" ? { ms: Math.round(seconds! * 1000) } : {};
    document.dispatchEvent(
      new CustomEvent(SEEK_REQUEST_EVENT, { detail: JSON.stringify({ id, path, action, ...ms }) })
    );
  });
}

export function requestNetflixSeek(seconds: number, timeoutMs = 1000): Promise<boolean> {
  return requestNetflixAction("seek", seconds, timeoutMs);
}

interface NetflixPlayer {
  seek?(ms: number): unknown;
  play?(): unknown;
  pause?(): unknown;
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

/** Netflix's undocumented player API: any missing piece means "cannot do it". */
function findNetflixPlayer(win: Window): NetflixPlayer | null {
  const netflix = (win as Window & { netflix?: NetflixGlobal }).netflix;
  const api = netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const ids = api?.getAllPlayerSessionIds?.();
  if (!api || !Array.isArray(ids)) return null;

  const sessions = ids.filter((id): id is string => typeof id === "string");
  // The playing title's session is named "watch-…"; others are previews.
  const id = sessions.find((session) => session.startsWith("watch")) ?? sessions[0];
  if (!id) return null;

  const player = api.getVideoPlayerBySessionId?.(id);
  return player && typeof player === "object" ? (player as NetflixPlayer) : null;
}

/** Calls only the method named by the closed action; a missing one is a failure. */
async function perform(player: NetflixPlayer, request: SeekRequest): Promise<boolean> {
  switch (request.action) {
    case "seek":
      if (typeof player.seek !== "function") return false;
      await player.seek(Math.round(request.ms));
      return true;
    case "play":
      if (typeof player.play !== "function") return false;
      await player.play();
      return true;
    case "pause":
      if (typeof player.pause !== "function") return false;
      await player.pause();
      return true;
    case "probe":
      return typeof player.play === "function" && typeof player.pause === "function";
  }
}

/**
 * Page-world side, installed by src/content/netflix-main.ts. It has no
 * extension privileges and does only what any script on the page could
 * already do: seek, play or pause Netflix's player on request.
 */
export function handleNetflixSeekRequests(win: Window): () => void {
  const doc = win.document;
  const onRequest = (event: Event): void => {
    const request = decodeSeekRequest((event as CustomEvent).detail);
    if (!request) return;

    void (async () => {
      let ok = false;
      try {
        // A request made for another episode must not touch this one.
        const player = request.path === win.location.pathname ? findNetflixPlayer(win) : null;
        ok = player ? await perform(player, request) : false;
      } catch {
        ok = false;
      }
      const answer = { id: request.id, ok: ok && request.path === win.location.pathname };
      doc.dispatchEvent(new CustomEvent(SEEK_RESULT_EVENT, { detail: JSON.stringify(answer) }));
    })();
  };

  doc.addEventListener(SEEK_REQUEST_EVENT, onRequest);
  return () => doc.removeEventListener(SEEK_REQUEST_EVENT, onRequest);
}
