import { PRE_ROLL } from "./line-timeline.ts";
import type { StudySnapshot } from "./study-context.ts";

/**
 * Player commands shared by the keyboard shortcuts, the panel buttons and
 * auto-pause: A (previous line), S (repeat), D (+5 s), Space and pause.
 * Times are seconds throughout; only the Netflix bridge converts to
 * milliseconds, at its own boundary.
 */

/** What a platform lets us do with its player. Each call reports whether it worked. */
export interface PlaybackDriver {
  getVideo(): HTMLVideoElement | null;
  /** Changes with the episode, the video element or the subtitle source. */
  getSessionId(): string;
  seekTo(seconds: number): Promise<boolean>;
  play(): Promise<boolean>;
  pause(): Promise<boolean>;
  /** False when play/pause are not known to work: Space is then left to the player. */
  canPlayPause?(): boolean;
}

export interface PlaybackResult {
  ok: boolean;
  error?: string;
}

export type SeekKind = "previous" | "forward" | "repeat";

/** D moves exactly this far — never to the next subtitle. */
export const FORWARD_SECONDS = 5;

/** A press within this long of the previous one continues from its pending target. */
const SEQUENCE_MS = 1500;
/** How close the video must get to a seek target to count as arrived. */
const SETTLE_TOLERANCE = 0.35;
const SETTLE_TIMEOUT_MS = 2500;
/** No driver call may hold the command queue longer than this. */
const DRIVER_TIMEOUT_MS = 3000;
/** How long play/pause may take to show up on the video element. */
const STATE_TIMEOUT_MS = 1000;
/** A seeking event this close to our own target is our seek, not someone else's. */
const OWN_SEEK_SLACK = 0.5;

const success: PlaybackResult = { ok: true };
const fail = (error: string): PlaybackResult => ({ ok: false, error });

/**
 * Where a seek to `desired` may safely land: inside the seekable range that
 * holds the current position, or within the media's duration. Never bridges a
 * gap to a distant range, never returns Infinity; null when nothing is safe.
 */
export function seekTarget(
  video: HTMLVideoElement,
  desired: number,
  current = video.currentTime
): number | null {
  if (!Number.isFinite(desired) || !Number.isFinite(current)) return null;

  const ranges = video.seekable;
  if (ranges?.length) {
    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (current >= start && current <= end) return Math.max(start, Math.min(end, desired));
    }
    return null;
  }

  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, Math.min(duration, desired));
}

/** Resolves to `fallback` if `action` throws, rejects or takes longer than `ms`. */
function bounded(action: () => Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    Promise.resolve()
      .then(action)
      .then(
        (ok) => resolve(ok === true),
        () => resolve(false)
      )
      .finally(() => clearTimeout(timer));
  });
}

/** Plain HTML5 players. Never used for Netflix, whose player breaks on currentTime writes. */
export function createHtml5Driver(
  getVideo: () => HTMLVideoElement | null,
  getSessionId: () => string
): PlaybackDriver {
  return {
    getVideo,
    getSessionId,
    async seekTo(seconds) {
      const video = getVideo();
      if (!video || !Number.isFinite(seconds) || seconds < 0) return false;
      try {
        video.currentTime = seconds;
        return true;
      } catch {
        return false;
      }
    },
    async play() {
      const video = getVideo();
      if (!video) return false;
      try {
        await video.play();
        return !video.paused;
      } catch {
        // Autoplay policy or a removed source: report it, do not retry.
        return false;
      }
    },
    async pause() {
      const video = getVideo();
      if (!video) return false;
      try {
        video.pause();
        return video.paused;
      } catch {
        return false;
      }
    },
    canPlayPause: () => !!getVideo(),
  };
}

export interface PlaybackController {
  canPrevious(): boolean;
  canForward(): boolean;
  canRepeat(snapshot: StudySnapshot | null): boolean;
  canToggle(): boolean;
  /** A: back one subtitle line, keeping the play/pause state. */
  previous(): Promise<PlaybackResult>;
  /** D: exactly +5 s, accumulating over rapid presses, keeping the play/pause state. */
  forward(): Promise<PlaybackResult>;
  /** S: to the start of `snapshot`, then play once the seek has really landed. */
  repeat(snapshot: StudySnapshot | null): Promise<PlaybackResult>;
  /** Space: one real play/pause toggle per call, decided on the video's current state. */
  toggle(): Promise<PlaybackResult>;
  pause(): Promise<PlaybackResult>;
  /** Forgets pending targets and drops queued commands. */
  invalidate(): void;
  stop(): void;
}

export interface PlaybackOptions {
  /** Where "previous line" lands when starting from `from`, or null when unknown. */
  backTarget?: (from: number) => number | null;
  /** Our own seek is starting, or someone else's was seen on the video. */
  onNavigate?: (kind: SeekKind | "external") => void;
  settleTimeoutMs?: number;
}

export function createPlaybackController(
  driver: PlaybackDriver,
  options: PlaybackOptions = {}
): PlaybackController {
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let operation = 0;
  let stopped = false;
  let video: HTMLVideoElement | null = null;
  let session = "";
  /** The latest seek still on its way: rapid presses continue from it, not from currentTime. */
  let pending: { target: number; at: number; id: number } | null = null;
  /** Set while our own seek is in flight, so its seeking event is not mistaken for another. */
  let ownTarget: number | null = null;
  let cancelSettle: (() => void) | null = null;

  const invalidate = (): void => {
    generation++;
    pending = null;
    ownTarget = null;
    cancelSettle?.();
  };

  const onSeeking = (): void => {
    if (ownTarget !== null && video && Math.abs(video.currentTime - ownTarget) < OWN_SEEK_SLACK) return;
    // Someone else moved the video: a pending sequence no longer says where it is.
    invalidate();
    options.onNavigate?.("external");
  };

  /** Follows the platform's video; a new video or session drops everything pending. */
  const sync = (): HTMLVideoElement | null => {
    if (stopped) return null;
    const current = driver.getVideo();
    const key = driver.getSessionId();
    if (current !== video || key !== session) {
      invalidate();
      video?.removeEventListener("seeking", onSeeking);
      video = current;
      session = key;
      video?.addEventListener("seeking", onSeeking);
    }
    return video;
  };

  /** Commands run one at a time; one queued under an older session never runs. */
  const enqueue = (
    task: (current: HTMLVideoElement, valid: () => boolean) => Promise<PlaybackResult>
  ): Promise<PlaybackResult> => {
    const current = sync();
    if (!current) return Promise.resolve(fail("Player indisponível."));
    const token = generation;
    const key = session;
    const valid = (): boolean =>
      !stopped && token === generation && driver.getVideo() === current && driver.getSessionId() === key;

    const result = queue.then(() => (valid() ? task(current, valid) : fail("A sessão mudou.")));
    queue = result.catch(() => {});
    return result.catch(() => fail("Não foi possível controlar o player."));
  };

  /**
   * A driver saying "done" is not the video being there: Netflix's bridge only
   * acknowledges the request. Wait for the position itself, with a deadline.
   */
  const settled = (current: HTMLVideoElement, target: number, valid: () => boolean): Promise<boolean> =>
    new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(timeout);
        current.removeEventListener("seeked", check);
        if (cancelSettle === cancel) cancelSettle = null;
        resolve(ok);
      };
      const cancel = (): void => finish(false);
      const check = (): void => {
        if (!valid()) finish(false);
        else if (!current.seeking && Math.abs(current.currentTime - target) <= SETTLE_TOLERANCE) finish(true);
      };
      const poll = setInterval(check, 40);
      const timeout = setTimeout(cancel, options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS);
      cancelSettle = cancel;
      current.addEventListener("seeked", check);
      check();
    });

  /** Resolves once the video reports `paused`, or false after a short wait. */
  const reaches = (current: HTMLVideoElement, paused: boolean, valid: () => boolean): Promise<boolean> =>
    new Promise((resolve) => {
      const started = Date.now();
      const check = (): void => {
        if (!valid()) resolve(false);
        else if (current.paused === paused) resolve(true);
        else if (Date.now() - started >= STATE_TIMEOUT_MS) resolve(false);
        else setTimeout(check, 25);
      };
      check();
    });

  const call = (action: () => Promise<boolean>): Promise<boolean> => bounded(action, DRIVER_TIMEOUT_MS);

  const seek = (kind: SeekKind, desired: number | null): Promise<PlaybackResult> => {
    const current = sync();
    if (!current) return Promise.resolve(fail("Player indisponível."));
    if (desired === null) return Promise.resolve(fail("Posição da fala indisponível."));
    const target = seekTarget(current, desired);
    if (target === null) return Promise.resolve(fail("Não há um destino seguro neste vídeo."));

    const id = ++operation;
    pending = { target, at: Date.now(), id };
    options.onNavigate?.(kind);
    return enqueue(async (playing, valid) => {
      ownTarget = target;
      try {
        if (!(await call(() => driver.seekTo(target))) || !valid()) return fail("O player recusou o salto.");
        if (!(await settled(playing, target, valid))) return fail("O player não confirmou a posição.");
        if (kind === "repeat") {
          // Only after the seek really landed: playing earlier replays the wrong spot.
          if (!(await call(() => driver.play())) || !valid()) return fail("Não foi possível reproduzir a fala.");
        }
        return success;
      } finally {
        ownTarget = null;
        if (pending?.id === id) pending = null;
      }
    });
  };

  /** Rapid presses continue from where the previous seek is going. */
  const origin = (current: HTMLVideoElement): number =>
    pending && Date.now() - pending.at < SEQUENCE_MS ? pending.target : current.currentTime;

  const previousTarget = (current: HTMLVideoElement): number | null =>
    options.backTarget?.(origin(current)) ?? null;

  const repeatTarget = (snapshot: StudySnapshot | null): number | null => {
    const start = snapshot?.start;
    if (!snapshot || start === undefined || !Number.isFinite(start)) return null;
    // Same pre-roll as A, never back into the line before.
    return Math.max(0, start - PRE_ROLL, snapshot.previousEnd ?? 0);
  };

  return {
    canPrevious() {
      const current = sync();
      return !!current && previousTarget(current) !== null;
    },

    canForward() {
      const current = sync();
      return !!current && seekTarget(current, origin(current) + FORWARD_SECONDS) !== null;
    },

    canRepeat(snapshot) {
      const current = sync();
      return !!current && snapshot?.sessionId === session && repeatTarget(snapshot) !== null;
    },

    canToggle() {
      return !!sync() && (driver.canPlayPause?.() ?? true);
    },

    previous() {
      const current = sync();
      return seek("previous", current ? previousTarget(current) : null);
    },

    forward() {
      const current = sync();
      return seek("forward", current ? origin(current) + FORWARD_SECONDS : null);
    },

    repeat(snapshot) {
      sync();
      if (!snapshot || snapshot.sessionId !== session) return Promise.resolve(fail("Nenhuma fala para repetir."));
      const target = repeatTarget(snapshot);
      if (target === null) return Promise.resolve(fail("O início desta fala é desconhecido."));
      return seek("repeat", target);
    },

    toggle() {
      return enqueue(async (current, valid) => {
        // Decided now, on the real state: two quick presses are two toggles.
        const resume = current.paused;
        const ok = await call(() => (resume ? driver.play() : driver.pause()));
        if (!ok || !valid() || !(await reaches(current, !resume, valid))) {
          return fail("Não foi possível alterar a reprodução.");
        }
        return success;
      });
    },

    pause() {
      return enqueue(async (current, valid) => {
        if (current.paused) return success;
        const ok = await call(() => driver.pause());
        if (!ok || !valid() || !(await reaches(current, true, valid))) return fail("Não foi possível pausar.");
        return success;
      });
    },

    invalidate,

    stop() {
      stopped = true;
      invalidate();
      video?.removeEventListener("seeking", onSeeking);
      video = null;
    },
  };
}
