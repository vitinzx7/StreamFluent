/** Only the page-world Netflix API controls playback; never write video.currentTime. */
export const SEEK_REQUEST_EVENT = "streamfluent:netflix-seek";
export const SEEK_RESULT_EVENT = "streamfluent:netflix-seek-result";
export type NetflixAction = "seek" | "play" | "pause";
export type SeekRequest = { id: number; path: string } & ({ action: "seek"; ms: number } | { action: "play" | "pause" });
export interface SeekResult { id: number; ok: boolean }
function parseObject(detail: unknown): Record<string, unknown> | null {
  if (typeof detail !== "string" || detail.length > 4096) return null;
  try { const value: unknown = JSON.parse(detail); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}
export function decodeSeekRequest(detail: unknown): SeekRequest | null {
  const value = parseObject(detail);
  if (!value || !Number.isSafeInteger(value.id) || (value.id as number) < 1 || typeof value.path !== "string" || !value.path.startsWith("/")) return null;
  if (Object.keys(value).some(key => !["id", "action", "ms", "path"].includes(key))) return null;
  const { id, path, action } = value as { id: number; path: string; action: unknown };
  if (action === "seek" && typeof value.ms === "number" && Number.isFinite(value.ms) && value.ms >= 0) return { id, path, action, ms: value.ms };
  if ((action === "play" || action === "pause") && !("ms" in value)) return { id, path, action };
  return null;
}
export function decodeSeekResult(detail: unknown): SeekResult | null {
  const value = parseObject(detail);
  return value && Number.isSafeInteger(value.id) && (value.id as number) >= 1 && typeof value.ok === "boolean" ? { id: value.id as number, ok: value.ok } : null;
}
let nextId = 0;
export function requestNetflixAction(action: NetflixAction, seconds?: number, timeoutMs = 1000): Promise<boolean> {
  if (action === "seek" && (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)) return Promise.resolve(false);
  const id = ++nextId, path = location.pathname;
  return new Promise(resolve => {
    const finish = (ok: boolean) => { document.removeEventListener(SEEK_RESULT_EVENT, onResult); clearTimeout(timer); resolve(ok && path === location.pathname); };
    const onResult = (event: Event) => { const result = decodeSeekResult((event as CustomEvent).detail); if (result?.id === id) finish(result.ok); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    document.addEventListener(SEEK_RESULT_EVENT, onResult);
    document.dispatchEvent(new CustomEvent(SEEK_REQUEST_EVENT, { detail: JSON.stringify({ id, path, action, ...(action === "seek" ? { ms: Math.round(seconds! * 1000) } : {}) }) }));
  });
}
export const requestNetflixSeek = (seconds: number, timeoutMs = 1000) => requestNetflixAction("seek", seconds, timeoutMs);
interface NetflixPlayer { seek?(ms: number): unknown; play?(): unknown; pause?(): unknown }
interface NetflixApi { getAllPlayerSessionIds?(): unknown; getVideoPlayerBySessionId?(id: string): unknown }
interface NetflixGlobal { appContext?: { state?: { playerApp?: { getAPI?(): { videoPlayer?: NetflixApi } | undefined } } } }
function findNetflixPlayer(win: Window): NetflixPlayer | null {
  const api = (win as Window & { netflix?: NetflixGlobal }).netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
  const ids = api?.getAllPlayerSessionIds?.(); if (!Array.isArray(ids)) return null;
  const id = ids.find((value: unknown) => typeof value === "string" && value.startsWith("watch"));
  if (!id) return null;
  const player = api?.getVideoPlayerBySessionId?.(id);
  return player && typeof player === "object" ? player as NetflixPlayer : null;
}
export function handleNetflixSeekRequests(win: Window): () => void {
  const doc = win.document;
  const onRequest = (event: Event) => {
    const request = decodeSeekRequest((event as CustomEvent).detail); if (!request) return;
    void (async () => {
      let ok = false;
      try {
        if (request.path === win.location.pathname) {
          const player = findNetflixPlayer(win);
          if (player) {
            if (request.action === "seek" && typeof player.seek === "function") { await player.seek(Math.round(request.ms)); ok = true; }
            else if (request.action === "play" && typeof player.play === "function") { await player.play(); ok = true; }
            else if (request.action === "pause" && typeof player.pause === "function") { await player.pause(); ok = true; }
          }
        }
      } catch { ok = false; }
      doc.dispatchEvent(new CustomEvent(SEEK_RESULT_EVENT, { detail: JSON.stringify({ id: request.id, ok: ok && request.path === win.location.pathname }) }));
    })();
  };
  doc.addEventListener(SEEK_REQUEST_EVENT, onRequest);
  return () => doc.removeEventListener(SEEK_REQUEST_EVENT, onRequest);
}
