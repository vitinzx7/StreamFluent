import type { LanguageVocabulary, PersonalMark, SavedPhrase, VocabularyV2, WordContext, WordDetails } from "./types.ts";
import { wordKey } from "./word-normalization.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function own(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
export function safeMap<T>(): Record<string, T> { return Object.create(null) as Record<string, T>; }
export function validLanguage(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value);
}
export function textValue(value: unknown, maximum = 20000): string | undefined {
  return typeof value === "string" && value.length <= maximum ? value : undefined;
}
export function dateValue(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : null;
}
export function episodeValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function timeValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
export function normalizeContext(value: unknown): WordContext | undefined {
  if (!isRecord(value)) return undefined;
  const sentence = textValue(own(value, "sentence"));
  const sourceLanguage = own(value, "sourceLanguage");
  if (!sentence?.trim() || !validLanguage(sourceLanguage)) return undefined;
  const result: WordContext = {
    sentence, sourceLanguage,
    platform: textValue(own(value, "platform"), 200) ?? "",
    mediaTitle: textValue(own(value, "mediaTitle"), 1000) ?? "",
    season: episodeValue(own(value, "season")), episode: episodeValue(own(value, "episode")),
  };
  const translation = textValue(own(value, "sentenceTranslation"));
  const targetLanguage = own(value, "targetLanguage");
  const time = timeValue(own(value, "timeSeconds"));
  if (translation !== undefined) result.sentenceTranslation = translation;
  if (validLanguage(targetLanguage)) result.targetLanguage = targetLanguage;
  if (time !== undefined) result.timeSeconds = time;
  return result;
}
export function normalizeDetails(value: unknown, key: string): WordDetails {
  const raw = isRecord(value) ? value : {};
  const result: WordDetails = {
    displayWord: textValue(own(raw, "displayWord"), 500)?.trim() || key,
    markedAt: dateValue(own(raw, "markedAt")), updatedAt: dateValue(own(raw, "updatedAt")),
  };
  const context = normalizeContext(own(raw, "context"));
  const translation = textValue(own(raw, "translation"));
  const definition = textValue(own(raw, "definition"));
  if (context) result.context = context;
  if (translation !== undefined) result.translation = translation;
  if (definition !== undefined) result.definition = definition;
  return result;
}
export function newLanguageVocabulary(): LanguageVocabulary {
  return { seen: [], marks: safeMap<PersonalMark>(), details: safeMap<WordDetails>() };
}

/** Pure migration: never mutate the original object, even when a later write fails. */
export function normalizeVocabulary(raw: unknown): VocabularyV2 {
  const result: VocabularyV2 = { schemaVersion: 2, languages: safeMap<LanguageVocabulary>() };
  if (!isRecord(raw)) return result;
  const schema = own(raw, "schemaVersion");
  if (Object.prototype.hasOwnProperty.call(raw, "schemaVersion") && schema !== 2) {
    throw new Error("Versão de vocabulário não suportada. Os dados foram preservados.");
  }
  const languages = schema === 2 ? own(raw, "languages") : raw;
  if (!isRecord(languages)) return result;
  for (const [language, value] of Object.entries(languages)) {
    if (!validLanguage(language) || !isRecord(value)) continue;
    const entry = newLanguageVocabulary();
    const seen = new Set<string>();
    const rawSeen = own(value, "seen");
    if (Array.isArray(rawSeen)) {
      for (const item of rawSeen) {
        if (typeof item !== "string" || item.length > 500) continue;
        const key = wordKey(item);
        if (key) seen.add(key);
      }
    }
    const marks = own(value, "marks");
    const details = own(value, "details");
    if (isRecord(marks)) {
      for (const [word, rawMark] of Object.entries(marks)) {
        const key = word.length <= 500 ? wordKey(word) : "";
        const mark = rawMark === "marked" ? "learned" : rawMark;
        if (!key || (mark !== "difficult" && mark !== "learned")) continue;
        seen.add(key);
        // The difficult mark and its details win normalization collisions.
        if (entry.marks[key] === "difficult") continue;
        entry.marks[key] = mark;
        entry.details[key] = normalizeDetails(isRecord(details) ? own(details, word) : undefined, key);
      }
    }
    entry.seen = [...seen];
    result.languages[language] = entry;
  }
  return result;
}
export const normalizeVocabularyV2 = normalizeVocabulary;

function recoveryId(sentence: string, index: number): string {
  let hash = 2166136261;
  for (let i = 0; i < sentence.length; i++) hash = Math.imul(hash ^ sentence.charCodeAt(i), 16777619);
  return `legacy-${index}-${(hash >>> 0).toString(36)}`;
}
export function normalizePhrases(raw: unknown): SavedPhrase[] {
  if (!Array.isArray(raw)) return [];
  const result: SavedPhrase[] = [];
  for (const [index, value] of raw.entries()) {
    if (!isRecord(value)) continue;
    const sentence = textValue(own(value, "sentence"));
    if (!sentence?.trim()) continue;
    const selectedWord = textValue(own(value, "selectedWord"), 500);
    const rawKind = own(value, "kind");
    if (rawKind !== undefined && rawKind !== "word" && rawKind !== "sentence") continue;
    const kind = rawKind === "sentence" || !selectedWord || !wordKey(selectedWord) ? "sentence" : "word";
    const source = own(value, "sourceLanguage");
    const target = own(value, "targetLanguage");
    const base = {
      id: textValue(own(value, "id"), 200)?.trim() || recoveryId(sentence, index),
      sentence, sourceLanguage: validLanguage(source) ? source : null,
      targetLanguage: validLanguage(target) ? target : null,
      platform: textValue(own(value, "platform"), 200) ?? "",
      mediaTitle: textValue(own(value, "mediaTitle"), 1000) ?? "",
      season: episodeValue(own(value, "season")), episode: episodeValue(own(value, "episode")),
      // Empty means unknown, rather than inventing a historical date.
      createdAt: dateValue(own(value, "createdAt")) ?? "",
    };
    const phrase: SavedPhrase = kind === "word"
      ? { ...base, kind, selectedWord: selectedWord! } : { ...base, kind };
    const sentenceTranslation = textValue(own(value, "sentenceTranslation"));
    const time = timeValue(own(value, "timeSeconds"));
    if (sentenceTranslation !== undefined) phrase.sentenceTranslation = sentenceTranslation;
    if (time !== undefined) phrase.timeSeconds = time;
    if (phrase.kind === "word") {
      const translation = textValue(own(value, "translation"));
      const definition = textValue(own(value, "definition"));
      if (translation !== undefined) phrase.translation = translation;
      if (definition !== undefined) phrase.definition = definition;
    }
    result.push(phrase);
  }
  return result;
}

export function phraseIdentity(phrase: SavedPhrase): string {
  return JSON.stringify([
    phrase.kind, phrase.sourceLanguage, phrase.targetLanguage, phrase.platform,
    phrase.mediaTitle, phrase.season, phrase.episode, phrase.sentence.trim().replace(/\s+/g, " "),
    phrase.kind === "word" ? wordKey(phrase.selectedWord) : null,
  ]);
}
