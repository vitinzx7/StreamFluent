/**
 * Where each subtitle line sits on the video's timeline, learned by watching.
 * The Netflix/Max adapters only ever see the line currently on screen — never
 * the subtitle file — so times are recorded as lines appear and disappear.
 */

/**
 * Seek this far before a line's recorded start. Lines are recorded about 0.1s
 * late (the adapters debounce DOM changes), and a clipped first syllable is
 * worse than a few frames of silence.
 */
export const PRE_ROLL = 0.25;

/** Slack when comparing a playback position with recorded times. */
const TOLERANCE = 0.5;

/** A timeupdate step bigger than this is a jump, not playback (safe at 2x). */
const MAX_PLAYBACK_STEP = 2.5;

/** Slack when checking that a stretch of video was actually watched. */
const WATCHED_SLACK = 1;

/** With no recorded end, a line is assumed to last at most this long. */
const MAX_OPEN_LINE = 10;

/** The line on screen, as recorded. */
export interface CurrentLine {
  start: number;
  end: number | null;
  /** End of the line before, when it ended no later than this one started. */
  previousEnd?: number;
}

interface TimedLine {
  text: string;
  start: number;
  /** null while on screen, or when it was left mid-way by a jump. */
  end: number | null;
}

export interface LineTimeline {
  /** A line appeared on screen at `time` (video seconds). */
  lineShown(text: string, time: number): void;
  /** The line on screen went away at `time`. */
  lineHidden(time: number): void;
  /** Playback jumped (a seek): the line on screen is no longer being timed. */
  jumped(): void;
  /** Playback moved from `from` to `to`; only normal progress counts as watched. */
  played(from: number, to: number): void;
  /** Where "back one line" should land from `time`, or null when unknown. */
  backTarget(time: number): number | null;
  /** The line on screen, or null in silence or after a jump. */
  current(): CurrentLine | null;
  clear(): void;
  readonly size: number;
}

export function createLineTimeline(): LineTimeline {
  let lines: TimedLine[] = [];
  let showing: TimedLine | null = null;
  /** Sorted, merged stretches of video played without a jump. */
  let watched: Array<[number, number]> = [];

  const close = (time: number): void => {
    // Closed by going backwards means it was left mid-way: its end is unknown.
    if (showing && time >= showing.start) showing.end = time;
    showing = null;
  };

  /** The same line seen again — replayed after going back, or entered mid-way. */
  const findKnown = (text: string, time: number): TimedLine | undefined =>
    lines.find(
      (line) =>
        line.text === text &&
        time >= line.start - 2 * TOLERANCE &&
        time <= (line.end ?? line.start + MAX_OPEN_LINE) + TOLERANCE
    );

  const insert = (line: TimedLine): void => {
    let i = lines.length;
    while (i > 0 && lines[i - 1].start > line.start) i--;
    lines.splice(i, 0, line);
  };

  const addWatched = (from: number, to: number): void => {
    const all = [...watched, [from, to] as [number, number]].sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const [start, end] of all) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1] + 0.05) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    watched = merged;
  };

  /**
   * Going back to a line is only safe if everything between it and now was
   * watched: after skipping ahead, the "previous known line" could be minutes
   * back, with unseen lines in between.
   */
  const isWatched = (from: number, to: number): boolean => {
    const a = from + WATCHED_SLACK;
    const b = to - WATCHED_SLACK;
    if (a >= b) return true;
    return watched.some(([start, end]) => start <= a && end >= b);
  };

  const seekPoint = (line: TimedLine, before: TimedLine | undefined): number => {
    let target = line.start - PRE_ROLL;
    // Back-to-back lines: landing before this one's start would show the end
    // of the line before it instead — very visible when paused.
    if (before?.end != null && before.end <= line.start && before.end > target) {
      target = before.end;
    }
    return Math.max(0, target);
  };

  return {
    lineShown(text: string, time: number): void {
      if (showing?.text === text) return;
      close(time);
      const known = findKnown(text, time);
      if (known) {
        // Every sighting bounds the real start from above: a line first met
        // mid-way after a seek gets its earlier start once it is seen from before.
        if (time < known.start) {
          known.start = time;
          lines.splice(lines.indexOf(known), 1);
          insert(known);
        }
        showing = known;
        return;
      }
      const line: TimedLine = { text, start: time, end: null };
      insert(line);
      showing = line;
    },

    lineHidden(time: number): void {
      close(time);
    },

    jumped(): void {
      showing = null;
    },

    played(from: number, to: number): void {
      if (to > from && to - from <= MAX_PLAYBACK_STEP) addWatched(from, to);
    },

    backTarget(time: number): number | null {
      let index = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].start <= time + TOLERANCE) {
          index = i;
          break;
        }
      }
      if (index < 0) return null;

      const current = lines[index];
      // In the silence after a line, "back one" means that line itself — from
      // the moment it goes away: a press right after a line ends is someone
      // who just missed it and wants it again.
      const inGap = current.end !== null && time > current.end;
      const candidateIndex = inGap ? index : index - 1;
      const candidate = lines[candidateIndex];
      if (candidate && isWatched(candidate.start, time)) {
        return seekPoint(candidate, lines[candidateIndex - 1]);
      }

      // Nothing known right before (the episode just started, or the stretch
      // before was skipped): restart the line on screen instead.
      if (!inGap) return seekPoint(current, lines[index - 1]);
      return null;
    },

    current(): CurrentLine | null {
      if (!showing) return null;
      const before = lines[lines.indexOf(showing) - 1];
      const line: CurrentLine = { start: showing.start, end: showing.end };
      if (before?.end != null && before.end <= showing.start) line.previousEnd = before.end;
      return line;
    },

    clear(): void {
      lines = [];
      showing = null;
      watched = [];
    },

    get size(): number {
      return lines.length;
    },
  };
}
