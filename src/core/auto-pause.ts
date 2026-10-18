import type { PlaybackResult } from "./playback-controller.ts";
import type { StudySnapshot } from "./study-context.ts";

/**
 * Auto-pause: pause once at the end of each subtitle line and keep that line
 * on screen for study. Two detectors share one pause request:
 *
 * - DOM subtitles (Netflix/Max) carry no times, so the end is noticed when
 *   the line disappears or is replaced — approximately, after the adapter's
 *   debounce. Nothing is estimated and nothing seeks back to compensate.
 * - Timed sources (TextTracks, SRT/VTT) cross `end + offset` on the video's
 *   own clock, read on each tick; never a wall-clock timer of the line's length.
 *
 * Only the preference is persisted. Everything here belongs to one session.
 */
export interface PauseHost {
  enabled(): boolean;
  /** Resolves once the player really paused, or with the reason it did not. */
  pause(): Promise<PlaybackResult>;
  /** The decided line stays on screen while the pause is in flight. */
  hold(snapshot: StudySnapshot): void;
  /** The pause was confirmed: `snapshot` becomes the retained study line. */
  retain(snapshot: StudySnapshot): void;
  /** The pause did not happen: back to the live line, and say so. */
  failed(snapshot: StudySnapshot, error: string): void;
}

/**
 * One request at a time. The decision is recorded before awaiting the player,
 * and a reply from before a reset (seek, episode, language) is ignored.
 */
function createPauseRequest(host: PauseHost) {
  let generation = 0;
  let pending = false;
  return {
    get pending() {
      return pending;
    },
    request(snapshot: StudySnapshot): void {
      if (pending) return;
      pending = true;
      const token = generation;
      host.hold(snapshot);
      void host.pause().then(
        (result) => {
          if (token !== generation) return;
          pending = false;
          if (result.ok) host.retain(snapshot);
          else host.failed(snapshot, result.error ?? "Não foi possível pausar.");
        },
        () => {
          if (token !== generation) return;
          pending = false;
          host.failed(snapshot, "Não foi possível pausar.");
        }
      );
    },
    reset(): void {
      generation++;
      pending = false;
    },
  };
}

/** Line changes this soon after a seek are the seek's doing, not a line ending. */
export const JUMP_GRACE_MS = 700;
/** HAVE_FUTURE_DATA: below it the video is buffering, not playing normally. */
const PLAYING_READY_STATE = 3;
/** Occurrences remembered as already paused; older ones cannot come back anyway. */
const MAX_CONSUMED = 64;

export interface DomAutoPause {
  /** A line appeared. It can pause at its end only if no jump happens before. */
  lineShown(snapshot: StudySnapshot): void;
  /** `previous` disappeared or was replaced on screen. */
  lineEnded(previous: StudySnapshot, video: HTMLVideoElement | null): void;
  /** A seek started, by us or anyone else. */
  jumped(): void;
  /**
   * The seek landed. The subtitle DOM may still be catching up, so changes
   * just after it are not line ends either — but a line that appeared at the
   * destination stays armed.
   */
  landed(): void;
  /** Episode, video or language changed: forget everything, ignore late replies. */
  reset(): void;
}

export function createDomAutoPause(host: PauseHost, now: () => number = () => performance.now()): DomAutoPause {
  const pause = createPauseRequest(host);
  let jumps = 0;
  let jumpAt = -Infinity;
  /** The line on screen and the jump count when it appeared. */
  let armed: { occurrenceId: string; jumps: number } | null = null;
  let consumed: string[] = [];

  const playingNormally = (video: HTMLVideoElement | null): video is HTMLVideoElement =>
    !!video && !video.paused && !video.seeking && !video.ended && video.readyState >= PLAYING_READY_STATE;

  return {
    lineShown(snapshot) {
      armed = { occurrenceId: snapshot.occurrenceId, jumps };
    },

    lineEnded(previous, video) {
      const wasArmed = armed?.occurrenceId === previous.occurrenceId && armed.jumps === jumps;
      if (armed?.occurrenceId === previous.occurrenceId) armed = null;
      if (!host.enabled() || !wasArmed || pause.pending) return;
      // A line that was on screen across a seek did not end by being played.
      if (now() - jumpAt < JUMP_GRACE_MS) return;
      // Already paused, buffering, seeking or at the end: no second pause.
      if (!playingNormally(video)) return;
      if (consumed.includes(previous.occurrenceId)) return;

      consumed = [...consumed.slice(1 - MAX_CONSUMED), previous.occurrenceId];
      pause.request(previous);
    },

    jumped() {
      jumps++;
      jumpAt = now();
      pause.reset();
    },

    landed() {
      jumpAt = now();
    },

    reset() {
      jumps++;
      jumpAt = -Infinity;
      armed = null;
      consumed = [];
      pause.reset();
    },
  };
}

/** Source times, before the offset is applied. */
export interface TimedCue {
  start: number;
  end: number;
}

export interface CueGroup {
  start: number;
  end: number;
}

/**
 * Cues that overlap (positively) form one group that pauses once, at its
 * latest end. Cues that only touch — one ends exactly when the next starts —
 * stay separate: each line keeps its own end.
 */
export function overlapGroups(cues: readonly TimedCue[]): CueGroup[] {
  const sorted = cues
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const groups: CueGroup[] = [];
  for (const cue of sorted) {
    const last = groups[groups.length - 1];
    if (last && cue.start < last.end) last.end = Math.max(last.end, cue.end);
    else groups.push({ start: cue.start, end: cue.end });
  }
  return groups;
}

/** A clock reading, in video seconds. */
export interface ClockReading {
  time: number;
  offset: number;
  /** Playing normally: not paused, seeking or ended. */
  playing: boolean;
}

export interface TimedAutoPause {
  /**
   * The cues of the current source. The same source loading more cues keeps
   * any pause in flight; another source is a reset().
   */
  setCues(cues: readonly TimedCue[]): void;
  /**
   * What the layer shows, with the source time of its first cue. Called
   * before the display changes, so the line that ends is still known.
   */
  shown(snapshot: StudySnapshot | null, sourceStart?: number): void;
  /** Every tick of the video clock. */
  observe(reading: ClockReading): void;
  /** A seek or an offset change: no end is crossed by jumping, and a replay may pause again. */
  jumped(): void;
  reset(): void;
}

/** A forward step bigger than this between two readings is a jump (safe at 2x, background tabs). */
const MAX_PLAYBACK_STEP = 2.5;

export function createTimedAutoPause(host: PauseHost): TimedAutoPause {
  const pause = createPauseRequest(host);
  let groups: CueGroup[] = [];
  let previous: ClockReading | null = null;
  /** The last composition shown, by the source time of its first cue. */
  let lastShown: { start: number; snapshot: StudySnapshot } | null = null;
  /** Ends (source time) already paused at in this pass; a seek starts a new pass. */
  const consumed = new Set<number>();

  /** Index of the group holding source time `time`, or -1. */
  const groupAt = (time: number): number => {
    let low = 0;
    let high = groups.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const group = groups[middle];
      if (time < group.start) high = middle - 1;
      else if (time >= group.end) low = middle + 1;
      else return middle;
    }
    return -1;
  };

  /** The first group whose end lies in (from, to], or -1. Group ends increase with their index. */
  const endCrossed = (from: number, to: number): number => {
    let low = 0;
    let high = groups.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (groups[middle].end <= from) low = middle + 1;
      else high = middle;
    }
    return low < groups.length && groups[low].end <= to ? low : -1;
  };

  const forget = (): void => {
    previous = null;
    consumed.clear();
    pause.reset();
  };

  return {
    setCues(cues) {
      groups = overlapGroups(cues);
    },

    shown(snapshot, sourceStart) {
      if (!snapshot || sourceStart === undefined || !Number.isFinite(sourceStart)) return;
      lastShown = { start: sourceStart, snapshot };
    },

    observe(reading) {
      if (!Number.isFinite(reading.time) || !Number.isFinite(reading.offset)) {
        previous = null;
        return;
      }
      // A paused reading still counts as "before": resuming just ahead of an
      // end must pause there. Seeks reset it through jumped().
      const before = previous;
      previous = reading;
      if (!before || !reading.playing || before.offset !== reading.offset) return;

      const from = before.time - before.offset;
      const to = reading.time - reading.offset;
      const step = to - from;
      if (step <= 0 || step > MAX_PLAYBACK_STEP) return;

      const group = endCrossed(from, to);
      if (group < 0 || !host.enabled() || pause.pending) return;
      const end = groups[group].end;
      if (consumed.has(end)) return;
      // Only a line that was actually shown can be kept on screen.
      if (!lastShown || groupAt(lastShown.start) !== group) return;
      consumed.add(end);
      pause.request(lastShown.snapshot);
    },

    jumped() {
      forget();
    },

    reset() {
      lastShown = null;
      forget();
    },
  };
}
