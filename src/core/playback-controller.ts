import { PRE_ROLL } from "./line-timeline.ts";
import type { StudySnapshot } from "./study-context.ts";
export interface PlaybackDriver {
  getVideo(): HTMLVideoElement | null;
  getSessionId(): string;
  seekTo(seconds: number): Promise<boolean>;
  play(): Promise<boolean>;
  pause(): Promise<boolean>;
}
export interface PlaybackResult { ok: boolean; error?: string }
const fail = (error: string): PlaybackResult => ({ ok: false, error });
const success: PlaybackResult = { ok: true };

/** Constrain to the currently reachable interval, never bridge seekable gaps. */
export function seekTarget(video: HTMLVideoElement, desired: number, current = video.currentTime): number | null {
  if (!Number.isFinite(desired) || !Number.isFinite(current)) return null;
  const ranges = video.seekable;
  if (ranges?.length) {
    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i), end = ranges.end(i);
      if (Number.isFinite(start) && Number.isFinite(end) && current >= start && current <= end) return Math.max(start, Math.min(end, desired));
    }
    return null;
  }
  return Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, Math.min(video.duration, desired)) : null;
}
export function createHtml5Driver(getVideo: () => HTMLVideoElement | null, getSessionId: () => string): PlaybackDriver {
  return { getVideo, getSessionId,
    async seekTo(seconds) { const video = getVideo(); if (!video || !Number.isFinite(seconds) || seconds < 0) return false; try { video.currentTime = seconds; return true; } catch { return false; } },
    async play() { try { const video = getVideo(); if (!video) return false; await video.play(); return !video.paused; } catch { return false; } },
    async pause() { try { const video = getVideo(); if (!video) return false; video.pause(); return video.paused; } catch { return false; } },
  };
}
export function createPlaybackController(driver: PlaybackDriver, options: {
  backTarget?: (from: number) => number | null;
  onNavigate?: (action: "previous" | "forward" | "repeat" | "external") => void;
  onResume?: () => void;
  settleTimeoutMs?: number;
} = {}) {
  let queue: Promise<unknown> = Promise.resolve(), generation = 0, stopped = false, operation = 0;
  let video: HTMLVideoElement | null = null, session = "";
  let pending: { kind: string; target: number; at: number; id: number } | null = null;
  let ownTarget: number | null = null;
  let cancelSettle: (() => void) | null = null;
  const invalidate = () => { generation++; pending = null; ownTarget = null; cancelSettle?.(); cancelSettle = null; };
  const external = () => {
    if (ownTarget !== null && video && Math.abs(video.currentTime - ownTarget) < .5) return;
    invalidate(); options.onNavigate?.("external");
  };
  const resumed = () => options.onResume?.();
  const sync = () => {
    const current = driver.getVideo(), key = driver.getSessionId();
    if (video !== current || session !== key) {
      invalidate(); video?.removeEventListener("seeking", external); video?.removeEventListener("play", resumed);
      video = current; session = key;
      video?.addEventListener("seeking", external); video?.addEventListener("play", resumed);
    }
    return video;
  };
  const enqueue = (task: (current: HTMLVideoElement, valid: () => boolean) => Promise<PlaybackResult>) => {
    const current = sync(), token = generation, key = session;
    if (!current || stopped) return Promise.resolve(fail("Player indisponível."));
    const valid = () => !stopped && token === generation && driver.getVideo() === current && driver.getSessionId() === key;
    const result = queue.then(async () => valid() ? task(current, valid) : fail("A sessão mudou."));
    queue = result.catch(() => {});
    return result.catch(() => fail("Não foi possível controlar o player."));
  };
  const settled = (current: HTMLVideoElement, target: number, valid: () => boolean): Promise<boolean> => new Promise(resolve => {
    let done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; clearInterval(poll); clearTimeout(timeout); current.removeEventListener("seeked", check); if (cancelSettle === cancel) cancelSettle = null; resolve(ok); };
    const cancel = () => finish(false);
    const check = () => { if (!valid()) finish(false); else if (!current.seeking && Math.abs(current.currentTime - target) <= .35) finish(true); };
    const poll = setInterval(check, 40), timeout = setTimeout(() => finish(false), options.settleTimeoutMs ?? 2500);
    cancelSettle = cancel; current.addEventListener("seeked", check); check();
  });
  const seek = (kind: "previous" | "forward" | "repeat", target: number | null) => {
    const current = sync();
    if (!current || target === null) return Promise.resolve(fail("Posição de legenda indisponível."));
    const bounded = seekTarget(current, target);
    if (bounded === null) return Promise.resolve(fail("Não há um destino seguro neste player."));
    const id = ++operation; pending = { kind, target: bounded, at: Date.now(), id };
    options.onNavigate?.(kind);
    return enqueue(async (playing, valid) => {
      ownTarget = bounded;
      try {
        if (!await driver.seekTo(bounded) || !valid()) return fail("O player recusou o salto.");
        if (!await settled(playing, bounded, valid)) return fail("O player não confirmou a posição.");
        if (kind === "repeat") {
          if (!valid() || !await driver.play() || !valid()) return fail("Não foi possível reproduzir a fala.");
          options.onResume?.();
        }
        return success;
      } finally { ownTarget = null; if (pending?.id === id) pending = null; }
    });
  };
  const from = (kind: string, current: HTMLVideoElement) => pending?.kind === kind && Date.now() - pending.at < 1500 ? pending.target : current.currentTime;
  return {
    sync,
    canPrevious() { const current = sync(); return !!current && options.backTarget?.(from("previous", current)) != null; },
    canForward() { const current = sync(); return !!current && seekTarget(current, current.currentTime + 5) !== null; },
    previous() { const current = sync(); return seek("previous", current ? options.backTarget?.(from("previous", current)) ?? null : null); },
    forward() { const current = sync(); return seek("forward", current ? from("forward", current) + 5 : null); },
    repeat(snapshot: StudySnapshot | null) {
      const start = snapshot?.start;
      if (start === undefined || !Number.isFinite(start)) return Promise.resolve(fail("Nenhuma fala para repetir."));
      return seek("repeat", Math.max(0, start - PRE_ROLL, snapshot?.previousEnd ?? 0));
    },
    toggle() { return enqueue(async (current, valid) => {
      const resume = current.paused;
      const ok = resume ? await driver.play() : await driver.pause();
      if (!ok || !valid()) return fail("Não foi possível alterar a reprodução.");
      if (resume) options.onResume?.(); return success;
    }); },
    pause() { return enqueue(async (_, valid) => await driver.pause() && valid() ? success : fail("Não foi possível pausar.")); },
    invalidate,
    stop() { stopped = true; invalidate(); video?.removeEventListener("seeking", external); video?.removeEventListener("play", resumed); video = null; },
  };
}
