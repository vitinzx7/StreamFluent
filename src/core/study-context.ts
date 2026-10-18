import { getLangPair, type LanguageDirection } from "./settings.ts";
import type { WordContext } from "./types.ts";
export interface StudySnapshot {
  sessionId: string; sourceId: string; cueId: string; occurrenceId: string;
  text: string; translation?: string; direction: LanguageDirection;
  start?: number; end?: number; previousEnd?: number; groupEnd?: number;
  platform: string; mediaTitle: string; season: number | null; episode: number | null;
  freshKeys: ReadonlySet<string>;
}
export function copyStudy(value: StudySnapshot): StudySnapshot { return { ...value, freshKeys: new Set(value.freshKeys) }; }
export function wordContext(value: StudySnapshot): WordContext {
  const pair = getLangPair(value.direction);
  return { sentence: value.text, ...(value.translation ? { sentenceTranslation: value.translation } : {}),
    sourceLanguage: pair.source, targetLanguage: pair.target, platform: value.platform, mediaTitle: value.mediaTitle,
    season: value.season, episode: value.episode, ...(value.start !== undefined ? { timeSeconds: value.start } : {}) };
}
export function createStudyContext() {
  let live: StudySnapshot | null = null, retained: StudySnapshot | null = null;
  return {
    get live() { return live; }, get retained() { return retained; }, get study() { return retained ?? live; },
    setLive(next: StudySnapshot | null) { live = next ? copyStudy(next) : null; },
    retain(snapshot: StudySnapshot) { retained = copyStudy(snapshot); },
    release() { retained = null; },
    clear() { live = null; retained = null; },
    translate(occurrenceId: string, translation: string) {
      if (live?.occurrenceId === occurrenceId) live = { ...live, translation };
      if (retained?.occurrenceId === occurrenceId) retained = { ...retained, translation };
    },
    setFresh(occurrenceId: string, freshKeys: Set<string>) {
      if (live?.occurrenceId === occurrenceId) live = { ...live, freshKeys: new Set(freshKeys) };
      if (retained?.occurrenceId === occurrenceId) retained = { ...retained, freshKeys: new Set(freshKeys) };
    },
  };
}
