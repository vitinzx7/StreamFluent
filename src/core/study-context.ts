import { getLangPair, type LanguageDirection } from "./settings.ts";
import type { SavedPhraseInput, WordContext } from "./types.ts";

/**
 * One presentation of a subtitle line, frozen when it appeared. Shortcuts,
 * cards and saved phrases read these snapshots instead of whatever happens
 * to be on screen after an await.
 */
export interface StudySnapshot {
  /** Episode + video + source: anything older is ignored. */
  sessionId: string;
  sourceId: string;
  /** The unit in its source (a cue index, or a DOM line). */
  cueId: string;
  /** This presentation of it: a replay is a new occurrence with the same cueId. */
  occurrenceId: string;
  text: string;
  /** The translated line, only once it arrived for this very occurrence. */
  translation?: string;
  direction: LanguageDirection;
  /** Video seconds; absent when the source does not say. */
  start?: number;
  end?: number;
  /** End of the line before, when it ended no later than this one's start. */
  previousEnd?: number;
  platform: string;
  mediaTitle: string;
  season: number | null;
  episode: number | null;
  /** Words seen for the first time ever in this occurrence (blue). */
  freshKeys: ReadonlySet<string>;
}

export function copyStudy(value: StudySnapshot): StudySnapshot {
  return { ...value, freshKeys: new Set(value.freshKeys) };
}

/** The context stored with a word mark. */
export function wordContext(value: StudySnapshot): WordContext {
  const pair = getLangPair(value.direction);
  return {
    sentence: value.text,
    ...(value.translation ? { sentenceTranslation: value.translation } : {}),
    platform: value.platform,
    mediaTitle: value.mediaTitle,
    season: value.season,
    episode: value.episode,
    ...(value.start !== undefined && Number.isFinite(value.start) ? { timeSeconds: value.start } : {}),
    sourceLanguage: pair.source,
    targetLanguage: pair.target,
  };
}

/** R: the whole original line, with its translation only if it is already here. */
export function sentencePhrase(value: StudySnapshot): SavedPhraseInput {
  const pair = getLangPair(value.direction);
  return {
    kind: "sentence",
    sentence: value.text,
    ...(value.translation ? { sentenceTranslation: value.translation } : {}),
    sourceLanguage: pair.source,
    targetLanguage: pair.target,
    platform: value.platform,
    mediaTitle: value.mediaTitle,
    season: value.season,
    episode: value.episode,
    ...(value.start !== undefined && Number.isFinite(value.start) ? { timeSeconds: value.start } : {}),
  };
}

export interface StudyContext {
  /** What the subtitle source reports right now. */
  readonly live: StudySnapshot | null;
  /** A line kept on screen while auto-pause waits for the player to pause. */
  readonly held: StudySnapshot | null;
  /** The line kept on screen after auto-pause paused at its end. */
  readonly retained: StudySnapshot | null;
  /** What is shown and studied: retained, else held, else live. */
  readonly study: StudySnapshot | null;
  setLive(next: StudySnapshot | null): void;
  hold(snapshot: StudySnapshot): void;
  /** The pause was confirmed: keep `snapshot` until playback resumes. */
  retain(snapshot: StudySnapshot): void;
  /** Back to the live line. */
  release(): void;
  clear(): void;
  /** Attaches a translation to every copy of that occurrence. */
  translate(occurrenceId: string, translation: string): void;
  setFresh(occurrenceId: string, freshKeys: ReadonlySet<string>): void;
}

export function createStudyContext(): StudyContext {
  let live: StudySnapshot | null = null;
  let held: StudySnapshot | null = null;
  let retained: StudySnapshot | null = null;

  const patch = (occurrenceId: string, change: Partial<StudySnapshot>): void => {
    const apply = (value: StudySnapshot | null): StudySnapshot | null =>
      value?.occurrenceId === occurrenceId ? { ...value, ...change } : value;
    live = apply(live);
    held = apply(held);
    retained = apply(retained);
  };

  return {
    get live() {
      return live;
    },
    get held() {
      return held;
    },
    get retained() {
      return retained;
    },
    get study() {
      return retained ?? held ?? live;
    },
    setLive(next) {
      live = next ? copyStudy(next) : null;
    },
    hold(snapshot) {
      held = copyStudy(snapshot);
    },
    retain(snapshot) {
      retained = copyStudy(snapshot);
      held = null;
    },
    release() {
      held = null;
      retained = null;
    },
    clear() {
      live = null;
      held = null;
      retained = null;
    },
    translate(occurrenceId, translation) {
      patch(occurrenceId, { translation });
    },
    setFresh(occurrenceId, freshKeys) {
      patch(occurrenceId, { freshKeys: new Set(freshKeys) });
    },
  };
}
