import { isCinetaroUrl, isEmbeddedPlayerUrl, isFrameDocumentId } from "./frame-messages.ts";
import { normalizeSettings, isLanguageDirection, type Settings } from "./settings.ts";
import { isCefrLevel } from "./cefr.ts";
import {
  dateValue, episodeValue, isRecord, newLanguageVocabulary, normalizeContext,
  normalizeDetails, normalizePhrases, normalizeVocabulary, own, phraseIdentity,
  textValue, timeValue, validLanguage,
} from "./study-data.ts";
import { STUDY_PREFIX, type StudyAction, type StudyReply } from "./study-messages.ts";
import type { PersonalMark, StorageSchema, WordDetails } from "./types.ts";
import { wordKey } from "./word-normalization.ts";
import { createIndexedDbSeenStore, type SeenStore } from "./seen-store.ts";

const KEYS = ["vocabulary", "phrases", "settings", "studyRevision"] as const;
const ACTIONS = new Set<StudyAction>([
  "read", "observe", "set-mark", "save-phrase", "remove-phrase", "clear-phrases",
  "patch-settings", "toggle-auto-pause", "export", "import", "reset-seen", "reset-all",
]);
/** Backups are plain JSON files the user keeps; this names and versions them. */
export const BACKUP_FORMAT = "streamfluent-backup";
const BACKUP_VERSION = 1;
const MAX_BACKUP_PHRASES = 200_000;
const SETTING_FIELDS = new Set(["direction", "showTranslation", "subtitleBottom", "highlightNewWords", "highlightSpecialWords", "autoPause", "level"]);
const INVALID = "Pedido de estudo inválido.";

/** Only our own UI and admitted content-script documents can use this protocol. */
export function isStudySender(sender: chrome.runtime.MessageSender): boolean {
  if (typeof chrome.runtime.id !== "string" || sender.id !== chrome.runtime.id || typeof sender.url !== "string") return false;
  try {
    const url = new URL(sender.url);
    if (url.protocol === "chrome-extension:" && url.hostname === chrome.runtime.id) {
      return (sender.frameId === undefined || sender.frameId === 0)
        && ["/popup.html", "/library.html", "/player-test.html", "/welcome.html"].includes(url.pathname);
    }
    if (!Number.isSafeInteger(sender.tab?.id) || (sender.tab?.id ?? -1) < 0 || url.username || url.password || url.port) return false;
    if (isEmbeddedPlayerUrl(sender.url)) {
      return Number.isSafeInteger(sender.frameId) && (sender.frameId ?? -1) >= 0
        && isFrameDocumentId(sender.documentId);
    }
    if (sender.frameId !== 0) return false;
    if (isCinetaroUrl(sender.url)) return true;
    return (url.protocol === "https:" || url.protocol === "http:")
      && ["netflix.com", "max.com", "hbomax.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

function assert(condition: unknown): asserts condition { if (!condition) throw new Error(INVALID); }
function onlyFields(value: Record<string, unknown>, fields: string[]): boolean {
  return Object.keys(value).every(key => fields.includes(key));
}
function optionalText(value: unknown, maximum = 20000): boolean { return value === undefined || textValue(value, maximum) !== undefined; }
function validateContext(raw: unknown, language: unknown): void {
  assert(isRecord(raw));
  assert(onlyFields(raw, ["sentence", "sentenceTranslation", "platform", "mediaTitle", "season", "episode", "timeSeconds", "sourceLanguage", "targetLanguage"]));
  assert(normalizeContext(raw) && own(raw, "sourceLanguage") === language);
  assert(textValue(own(raw, "platform"), 200) !== undefined && textValue(own(raw, "mediaTitle"), 1000) !== undefined);
  for (const field of ["season", "episode"]) assert(own(raw, field) === null || episodeValue(own(raw, field)) !== null);
  assert(optionalText(own(raw, "sentenceTranslation")));
  assert(own(raw, "timeSeconds") === undefined || timeValue(own(raw, "timeSeconds")) !== undefined);
  assert(own(raw, "targetLanguage") === undefined || validLanguage(own(raw, "targetLanguage")));
}
function validatePayload(action: StudyAction, value: unknown): Record<string, unknown> {
  const payload = value === undefined ? {} : value;
  assert(isRecord(payload));
  switch (action) {
    case "read": case "clear-phrases": case "toggle-auto-pause":
    case "export": case "reset-seen": case "reset-all":
      assert(Object.keys(payload).length === 0); break;
    case "import": {
      // The contents are normalized like storage; only the envelope is checked here.
      assert(onlyFields(payload, ["backup"]));
      const backup = own(payload, "backup");
      assert(isRecord(backup) && own(backup, "format") === BACKUP_FORMAT);
      if (own(backup, "version") !== BACKUP_VERSION) throw new Error("Versão de backup desconhecida; atualize a extensão.");
      const phrases = own(backup, "phrases");
      assert(phrases === undefined || (Array.isArray(phrases) && phrases.length <= MAX_BACKUP_PHRASES));
      break;
    }
    case "observe": {
      assert(onlyFields(payload, ["language", "keys", "occurrenceId"]));
      assert(validLanguage(own(payload, "language")));
      const keys = own(payload, "keys");
      assert(Array.isArray(keys) && keys.length <= 5000);
      assert(keys.every(key => typeof key === "string" && key.length <= 500 && !!wordKey(key)));
      assert(typeof own(payload, "occurrenceId") === "string" && !!textValue(own(payload, "occurrenceId"), 500)?.trim());
      break;
    }
    case "set-mark": {
      assert(onlyFields(payload, ["language", "word", "mark", "details"]));
      assert(validLanguage(own(payload, "language")));
      const word = own(payload, "word");
      assert(typeof word === "string" && word.length <= 500 && !!wordKey(word));
      const mark = own(payload, "mark");
      assert(mark === null || mark === "difficult" || mark === "learned");
      const details = own(payload, "details");
      if (details !== undefined) {
        assert(isRecord(details) && onlyFields(details, ["displayWord", "markedAt", "updatedAt", "context", "translation", "definition"]));
        assert(optionalText(own(details, "displayWord"), 500) && optionalText(own(details, "translation")) && optionalText(own(details, "definition")));
        for (const field of ["markedAt", "updatedAt"]) assert(own(details, field) === undefined || own(details, field) === null || dateValue(own(details, field)) !== null);
        if (own(details, "context") !== undefined) validateContext(own(details, "context"), own(payload, "language"));
      }
      break;
    }
    case "save-phrase": {
      assert(onlyFields(payload, ["phrase"]));
      const phrase = own(payload, "phrase");
      assert(isRecord(phrase));
      assert(onlyFields(phrase, ["kind", "sentence", "sentenceTranslation", "sourceLanguage", "targetLanguage", "platform", "mediaTitle", "season", "episode", "timeSeconds", "selectedWord", "translation", "definition"]));
      assert(own(phrase, "kind") === "word" || own(phrase, "kind") === "sentence");
      assert(textValue(own(phrase, "sentence"))?.trim());
      assert(optionalText(own(phrase, "sentenceTranslation")) && optionalText(own(phrase, "translation")) && optionalText(own(phrase, "definition")));
      assert(textValue(own(phrase, "platform"), 200) !== undefined && textValue(own(phrase, "mediaTitle"), 1000) !== undefined);
      for (const field of ["sourceLanguage", "targetLanguage"]) assert(own(phrase, field) === null || validLanguage(own(phrase, field)));
      for (const field of ["season", "episode"]) assert(own(phrase, field) === null || episodeValue(own(phrase, field)) !== null);
      assert(own(phrase, "timeSeconds") === undefined || timeValue(own(phrase, "timeSeconds")) !== undefined);
      if (own(phrase, "kind") === "word") {
        const word = own(phrase, "selectedWord");
        assert(typeof word === "string" && word.length <= 500 && !!wordKey(word));
      } else assert(own(phrase, "selectedWord") === undefined && own(phrase, "translation") === undefined && own(phrase, "definition") === undefined);
      break;
    }
    case "remove-phrase":
      assert(onlyFields(payload, ["id"]) && !!textValue(own(payload, "id"), 200)?.trim()); break;
    case "patch-settings": {
      assert(onlyFields(payload, ["patch"]));
      const patch = own(payload, "patch");
      assert(isRecord(patch) && Object.keys(patch).length > 0);
      for (const [key, value] of Object.entries(patch)) {
        assert(SETTING_FIELDS.has(key));
        if (key === "direction") assert(isLanguageDirection(value));
        else if (key === "level") assert(value === null || isCefrLevel(value));
        else if (key === "subtitleBottom") assert(typeof value === "number" && Number.isFinite(value));
        else assert(typeof value === "boolean");
      }
      break;
    }
  }
  return payload;
}

/** An ISO date later than another; a known date beats an unknown one. */
function newer(candidate: string | null | undefined, current: string | null | undefined): boolean {
  const a = candidate ? Date.parse(candidate) : NaN;
  const b = current ? Date.parse(current) : NaN;
  if (Number.isNaN(a)) return false;
  return Number.isNaN(b) || a > b;
}

export interface StudyStorageService {
  handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<StudyReply<unknown>>;
}
/**
 * The entire read/migrate/apply/write transaction is queued, including reads.
 * The seen-word history lives apart, in `seenWords` (IndexedDB in the
 * worker): once storage holds no legacy history, a subtitle line costs no
 * storage read or write at all, only new words are written.
 */
export function createStudyStorageService(
  storage: Pick<chrome.storage.LocalStorageArea, "get" | "set"> = chrome.storage.local,
  seenWords: SeenStore = createIndexedDbSeenStore(),
): StudyStorageService {
  let queue: Promise<void> = Promise.resolve();
  /** Storage was read, any legacy history moved out, and the result committed. */
  let migrated = false;
  let revision = 0;
  const observed = (payload: Record<string, unknown>): Promise<string[]> =>
    seenWords.add(payload.language as string, (payload.keys as string[]).map(wordKey));
  return {
    async handle(message, sender) {
      const requestId = isRecord(message) && typeof own(message, "requestId") === "string" ? own(message, "requestId") as string : "";
      const fail = (error: unknown): StudyReply<unknown> => ({ ok: false, requestId, error: error instanceof Error ? error.message : "Não foi possível salvar. Tente novamente." });
      let action: StudyAction;
      let payload: Record<string, unknown>;
      try {
        assert(isStudySender(sender));
        assert(isRecord(message) && onlyFields(message, ["type", "requestId", "payload"]));
        assert(requestId.trim() && requestId.length <= 200);
        const type = own(message, "type");
        assert(typeof type === "string" && type.startsWith(STUDY_PREFIX));
        action = type.slice(STUDY_PREFIX.length) as StudyAction;
        assert(ACTIONS.has(action));
        payload = validatePayload(action, own(message, "payload"));
      } catch (error) { return fail(error); }
      const result = queue.then(async (): Promise<StudyReply<unknown>> => {
        if (action === "observe" && migrated) {
          return { ok: true, requestId, revision, data: { freshKeys: await observed(payload) } };
        }
        const raw = await storage.get([...KEYS]);
        const state: StorageSchema = {
          vocabulary: normalizeVocabulary(raw.vocabulary), phrases: normalizePhrases(raw.phrases),
          settings: normalizeSettings(raw.settings),
          studyRevision: typeof raw.studyRevision === "number" && Number.isSafeInteger(raw.studyRevision) && raw.studyRevision >= 0 ? raw.studyRevision : 0,
        };
        // A history still inside `vocabulary` (older versions) moves to the seen
        // store: written there before it is dropped here, so a failure in
        // between only means migrating again — nothing is lost.
        for (const [language, entry] of Object.entries(state.vocabulary.languages)) {
          if (!entry.seen.length) continue;
          await seenWords.add(language, entry.seen);
          entry.seen = [];
        }
        let data: unknown;
        /** Work that must wait until storage has committed. */
        let afterWrite: (() => Promise<void>) | null = null;
        switch (action) {
          case "read": data = { vocabulary: state.vocabulary, phrases: state.phrases, settings: state.settings }; break;
          case "observe": data = { freshKeys: await observed(payload) }; break;
          case "set-mark": {
            const entry = state.vocabulary.languages[payload.language as string] ??= newLanguageVocabulary();
            const key = wordKey(payload.word as string);
            const mark = payload.mark as PersonalMark | null;
            const previous = entry.marks[key] ?? null;
            const changed = mark !== previous;
            if (changed) {
              if (mark === null) { delete entry.marks[key]; delete entry.details[key]; }
              else {
                const now = new Date().toISOString();
                const existing = entry.details[key];
                const incoming = isRecord(payload.details) ? payload.details : {};
                const details: WordDetails = normalizeDetails({ ...existing, ...incoming }, key);
                details.displayWord = textValue(own(incoming, "displayWord"), 500)?.trim() || existing?.displayWord || (payload.word as string);
                details.markedAt = existing ? existing.markedAt : now;
                details.updatedAt = now;
                entry.marks[key] = mark; entry.details[key] = details;
                // A marked word has been seen.
                await seenWords.add(payload.language as string, [key]);
              }
            }
            data = { vocabulary: state.vocabulary, changed }; break;
          }
          case "save-phrase": {
            const phrase = normalizePhrases([{ ...(payload.phrase as object), id: crypto.randomUUID(), createdAt: new Date().toISOString() }])[0];
            assert(phrase);
            const identity = phraseIdentity(phrase);
            const existing = state.phrases.find(item => phraseIdentity(item) === identity);
            if (existing) {
              if (!existing.sentenceTranslation && phrase.sentenceTranslation) existing.sentenceTranslation = phrase.sentenceTranslation;
              if (existing.kind === "word" && phrase.kind === "word") {
                if (!existing.translation && phrase.translation) existing.translation = phrase.translation;
                if (!existing.definition && phrase.definition) existing.definition = phrase.definition;
              }
            } else state.phrases.push(phrase);
            data = { phrase: existing ?? phrase, duplicate: !!existing }; break;
          }
          case "remove-phrase": {
            const before = state.phrases.length;
            state.phrases = state.phrases.filter(item => item.id !== payload.id);
            data = { removed: before !== state.phrases.length }; break;
          }
          case "clear-phrases": data = { removed: state.phrases.length }; state.phrases = []; break;
          case "patch-settings": state.settings = normalizeSettings({ ...state.settings, ...(payload.patch as Partial<Settings>) }); data = state.settings; break;
          case "toggle-auto-pause": state.settings = { ...state.settings, autoPause: !state.settings.autoPause }; data = state.settings; break;
          case "export": {
            // The seen history comes back into `vocabulary`, the shape older versions read.
            const vocabulary = structuredClone(state.vocabulary);
            for (const [language, words] of Object.entries(await seenWords.all())) {
              (vocabulary.languages[language] ??= newLanguageVocabulary()).seen = words;
            }
            data = {
              format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(),
              vocabulary, phrases: state.phrases, settings: state.settings,
            };
            break;
          }
          case "import": {
            const backup = payload.backup as Record<string, unknown>;
            const incoming = normalizeVocabulary(own(backup, "vocabulary"));
            let words = 0;
            let marks = 0;
            for (const [language, entry] of Object.entries(incoming.languages)) {
              words += (await seenWords.add(language, [...entry.seen, ...Object.keys(entry.marks)])).length;
              const local = state.vocabulary.languages[language] ??= newLanguageVocabulary();
              for (const [key, mark] of Object.entries(entry.marks)) {
                const theirs = entry.details[key];
                const mine = Object.prototype.hasOwnProperty.call(local.marks, key) ? local.details[key] : undefined;
                // The most recently updated choice wins; without dates, the one here stays.
                if (!Object.prototype.hasOwnProperty.call(local.marks, key) || newer(theirs?.updatedAt, mine?.updatedAt)) {
                  if (local.marks[key] !== mark || mine !== theirs) marks++;
                  local.marks[key] = mark;
                  local.details[key] = theirs ?? { displayWord: key, markedAt: null, updatedAt: null };
                }
              }
            }
            const known = new Set(state.phrases.map(phraseIdentity));
            const ids = new Set(state.phrases.map((item) => item.id));
            let added = 0;
            for (const phrase of normalizePhrases(own(backup, "phrases"))) {
              const identity = phraseIdentity(phrase);
              if (known.has(identity)) continue;
              known.add(identity);
              const id = ids.has(phrase.id) ? crypto.randomUUID() : phrase.id;
              ids.add(id);
              state.phrases.push({ ...phrase, id });
              added++;
            }
            // A backup is a restore: its preferences, including the level, come back.
            if (own(backup, "settings") !== undefined) state.settings = normalizeSettings(own(backup, "settings"));
            data = { words, marks, phrases: added };
            break;
          }
          case "reset-seen": await seenWords.clear(); data = { cleared: "seen" }; break;
          case "reset-all":
            // Marks and phrases go first; the history is cleared only once that is committed.
            state.vocabulary = normalizeVocabulary(undefined);
            state.phrases = [];
            afterWrite = () => seenWords.clear();
            data = { cleared: "all" };
            break;
        }
        const changes: Partial<StorageSchema> = {};
        for (const key of ["vocabulary", "phrases", "settings"] as const) {
          if (JSON.stringify(raw[key]) !== JSON.stringify(state[key])) Object.assign(changes, { [key]: state[key] });
        }
        if (Object.keys(changes).length || raw.studyRevision !== state.studyRevision) {
          assert(state.studyRevision < Number.MAX_SAFE_INTEGER);
          changes.studyRevision = ++state.studyRevision;
          await storage.set(changes);
        }
        await afterWrite?.();
        revision = state.studyRevision;
        migrated = true;
        return { ok: true, requestId, revision: state.studyRevision, data };
      });
      queue = result.then(() => undefined, () => undefined);
      try { return await result; } catch (error) { return fail(error); }
    },
  };
}
