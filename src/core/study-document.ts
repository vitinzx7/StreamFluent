import { normalizeSettings, DEFAULT_SETTINGS, type Settings } from "./settings.ts";
import { isRecord, newLanguageVocabulary, normalizePhrases, normalizeVocabulary, phraseIdentity, safeMap } from "./study-data.ts";
import type { SavedPhrase, VocabularyV2 } from "./types.ts";

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export interface StudyDocument { schemaVersion: 1; phrases: SavedPhrase[]; vocabulary: VocabularyV2; settings: Settings }
export interface Conflict { key: string; local: unknown; remote: unknown }
export type Choices = Record<string, "local" | "remote">;
export function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function emptyDocument(): StudyDocument {
  return { schemaVersion: 1, phrases: [], vocabulary: { schemaVersion: 2, languages: safeMap() }, settings: { ...DEFAULT_SETTINGS } };
}
/** Only explicit personal data is sent: never the history of unmarked words. */
export function studyDocument(raw: { phrases?: unknown; vocabulary?: unknown; settings?: unknown }): StudyDocument {
  const vocabulary = normalizeVocabulary(raw.vocabulary);
  for (const [language, entry] of Object.entries(vocabulary.languages)) {
    entry.seen = Object.keys(entry.marks).sort();
    if (!entry.seen.length) delete vocabulary.languages[language];
  }
  return { schemaVersion: 1, phrases: normalizePhrases(raw.phrases), vocabulary, settings: normalizeSettings(raw.settings) };
}
export function validateDocument(raw: unknown): StudyDocument {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.phrases) || !isRecord(raw.vocabulary) || raw.vocabulary.schemaVersion !== 2 || !isRecord(raw.settings)) {
    throw new Error("Formato ou versão de backup/conta não suportado. Dados preservados.");
  }
  if (new TextEncoder().encode(JSON.stringify(raw)).length > MAX_DOCUMENT_BYTES) throw new Error("O conjunto excede o limite de 4 MB.");
  const result = studyDocument(raw);
  // A document saved before a preference existed lacks it: the default fills in; any value present must already be normal.
  const expected = { ...raw, settings: { ...result.settings, ...raw.settings } };
  if (stable(result) !== stable(expected) || new Set(result.phrases.map(phraseIdentity)).size !== result.phrases.length) {
    throw new Error("Dados inválidos ou duplicados. A importação não foi aplicada.");
  }
  return result;
}
export function parseBackup(text: string): StudyDocument {
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES) throw new Error("Backup excede 4 MB.");
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || raw.format !== "streamfluent-backup" || raw.version !== 1) throw new Error("Backup incompatível.");
  // The library's backup (study-storage.ts) has the data at the top level, plus the seen history: normalized like storage, history dropped.
  if (!("data" in raw) && Object.keys(raw).every(k => ["format", "version", "exportedAt", "vocabulary", "phrases", "settings"].includes(k))) return studyDocument(raw);
  if (Object.keys(raw).some(k => !["format", "version", "exportedAt", "data"].includes(k))) throw new Error("Backup incompatível.");
  return validateDocument(raw.data);
}
export function makeBackup(document: StudyDocument): string {
  const text = JSON.stringify({ format: "streamfluent-backup", version: 1, exportedAt: new Date().toISOString(), data: document });
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES) throw new Error("O backup excede 4 MB. Reduza a biblioteca antes de exportar.");
  return text;
}
export function mergeDocuments(base: StudyDocument, local: StudyDocument, remote: StudyDocument, choices: Choices = {}): { document: StudyDocument; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  function select(key: string, b: unknown, l: unknown, r: unknown): unknown {
    if (stable(l) === stable(r) || stable(r) === stable(b)) return l;
    if (stable(l) === stable(b)) return r;
    const choice = Object.prototype.hasOwnProperty.call(choices, key) ? choices[key] : undefined;
    if (choice === "local") return l;
    if (choice === "remote") return r;
    conflicts.push({ key, local: l ?? null, remote: r ?? null });
    return l;
  }
  const document = emptyDocument();
  const phraseMaps = [base, local, remote].map(d => new Map(d.phrases.map(p => [phraseIdentity(p), p])));
  for (const key of new Set(phraseMaps.flatMap(m => [...m.keys()]))) {
    const [b, l, r] = phraseMaps.map(m => m.get(key));
    // Independently saved equivalent phrases use the remote ID/date if contents agree.
    const comparable = (p: SavedPhrase | undefined) => p ? { ...p, id: "", createdAt: "" } : p;
    const value = l && r && stable(comparable(l)) === stable(comparable(r)) ? r
      : select(`phrase:${key}`, b, l, r) as SavedPhrase | undefined;
    if (value) document.phrases.push(value);
  }
  for (const language of new Set([base, local, remote].flatMap(d => Object.keys(d.vocabulary.languages)))) {
    const entries = [base, local, remote].map(d => d.vocabulary.languages[language]);
    const entry = newLanguageVocabulary();
    for (const word of new Set(entries.flatMap(e => Object.keys(e?.marks ?? {})))) {
      const [b, l, r] = entries.map(e => e?.marks[word] ? { mark: e.marks[word], details: e.details[word] } : undefined);
      const value = select(`word:${language}:${word}`, b, l, r) as typeof l;
      if (value) { entry.marks[word] = value.mark; entry.details[word] = value.details; entry.seen.push(word); }
    }
    if (entry.seen.length) { entry.seen.sort(); document.vocabulary.languages[language] = entry; }
  }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    Object.assign(document.settings, { [key]: select(`setting:${key}`, base.settings[key], local.settings[key], remote.settings[key]) });
  }
  return { document: validateDocument(document), conflicts };
}
/** Import is additive. Conflicting existing entries/preferences stay local and are reported. */
export function importDocument(local: StudyDocument, incoming: StudyDocument, includeSettings: boolean) {
  return mergeDocuments(emptyDocument(), local, { ...incoming, settings: includeSettings ? incoming.settings : local.settings });
}
/** Remote marks replace personal marks; seen history remains local and is never uploaded. */
export function localVocabulary(raw: unknown, document: StudyDocument): VocabularyV2 {
  const previous = normalizeVocabulary(raw);
  const next = normalizeVocabulary(document.vocabulary);
  for (const [language, entry] of Object.entries(previous.languages)) {
    const target = next.languages[language] ??= newLanguageVocabulary();
    target.seen = [...new Set([...entry.seen, ...target.seen])];
  }
  return next;
}
