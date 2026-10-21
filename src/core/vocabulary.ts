import { onStudyInvalidated } from "./study-notifications.ts";
import { normalizeVocabulary } from "./study-data.ts";
import { requestStudy } from "./study-messages.ts";
import { wordKey, tokenizeWords } from "./word-normalization.ts";
import type { PersonalMark, VocabularyV2, WordDetails } from "./types.ts";

export { wordKey } from "./word-normalization.ts";
export type WordMark = PersonalMark;
export type WordStatus = WordMark | "new" | "special";
export type VocabularyData = VocabularyV2;
export const VOCABULARY_KEY = "vocabulary";
export const isWordMark = (value: unknown): value is WordMark => value === "difficult" || value === "learned";

export interface VocabularyStore {
  readonly ready: Promise<void>;
  /** Await durable history; re-rendering the same occurrence reuses its result. */
  observeLine(line: string, language: string, occurrenceId?: string): Promise<Set<string>>;
  getMark(word: string, language: string): WordMark | null;
  /** Resolves after persistence. Until then getMark returns the confirmed mark. */
  setMark(word: string, language: string, mark: WordMark | null, details?: Partial<WordDetails>): Promise<void>;
  onChange(cb: () => void): () => void;
  dispose(): void;
}

/** Clients only keep confirmed snapshots; the worker serializes all mutations. */
export function createVocabularyStore(): VocabularyStore {
  let stored = normalizeVocabulary(undefined);
  let revision = -1;
  let changeSeq = 0;
  let disposed = false;
  let occurrenceSequence = 0;
  const listeners = new Set<() => void>();
  const occurrences = new Map<string, Promise<Set<string>>>();
  const failedHistory = new Map<string, { language: string; keys: string[]; occurrenceId: string }>();

  const apply = (value: unknown, nextRevision: number): void => {
    if (disposed || nextRevision < revision) return;
    stored = normalizeVocabulary(value);
    revision = nextRevision;
    listeners.forEach((callback) => callback());
  };
  const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (disposed || area !== "local" || !Object.prototype.hasOwnProperty.call(changes, VOCABULARY_KEY)) return;
    changeSeq++;
    const nextRevision = changes.studyRevision?.newValue;
    try {
      apply(changes[VOCABULARY_KEY].newValue, typeof nextRevision === "number" ? nextRevision : revision);
    } catch {
      // Unknown schemas must not replace the last known, confirmed snapshot.
    }
  };
  chrome.storage.onChanged.addListener(handleStorageChange);

  const load = async (): Promise<void> => {
    const seq = changeSeq;
    const response = await requestStudy<{ vocabulary: VocabularyV2 }>("read");
    if (seq === changeSeq) apply(response.data.vocabulary, response.revision);
  };
  const unsubscribe = onStudyInvalidated("vocabulary", () => { void load().catch(() => {}); });
  const ready = load();
  // A caller may attach its error UI later; keep initialization rejection handled.
  void ready.catch(() => {});

  const sendObservation = async (payload: { language: string; keys: string[]; occurrenceId: string }): Promise<Set<string>> => {
    const result = await requestStudy<{ freshKeys: string[] }>("observe", payload);
    return new Set(result.data.freshKeys);
  };

  return {
    ready,
    observeLine(line, language, occurrenceId = `local-${++occurrenceSequence}`) {
      const identity = JSON.stringify([language, occurrenceId]);
      const cached = occurrences.get(identity);
      if (cached) return cached;
      const payload = { language, keys: [...new Set(tokenizeWords(line).flatMap((token) => token.key ? [token.key] : []))], occurrenceId };
      const operation = (async () => {
        await ready.catch(() => load());
        // A useful later cue retries history without mislabelling the visible line.
        for (const [failedId, failed] of failedHistory) {
          if (failedId === identity) continue;
          try {
            await sendObservation(failed);
            failedHistory.delete(failedId);
          } catch { /* The visible occurrence still gets its own attempt below. */ }
        }
        const fresh = await sendObservation(payload);
        failedHistory.delete(identity);
        return fresh;
      })();
      occurrences.set(identity, operation);
      void operation.catch(() => {
        occurrences.delete(identity);
        failedHistory.set(identity, payload);
      });
      return operation;
    },
    getMark(word, language) {
      const key = wordKey(word);
      const entry = Object.prototype.hasOwnProperty.call(stored.languages, language) ? stored.languages[language] : undefined;
      return key && entry && Object.prototype.hasOwnProperty.call(entry.marks, key) ? entry.marks[key] : null;
    },
    async setMark(word, language, mark, details) {
      const key = wordKey(word);
      if (!key) throw new Error("Palavra inválida.");
      const response = await requestStudy<{ vocabulary: VocabularyV2; changed: boolean }>("set-mark", {
        word: key, language, mark, ...(details ? { details } : {}),
      });
      apply(response.data.vocabulary, response.revision);
    },
    onChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    dispose() {
      disposed = true;
      unsubscribe();
      chrome.storage.onChanged.removeListener(handleStorageChange);
      listeners.clear();
      occurrences.clear();
      failedHistory.clear();
    },
  };
}
