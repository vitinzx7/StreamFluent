import { cleanWord } from "./translation.ts";
import type { StorageSchema } from "./types.ts";

/** A colour the user chose for a word from the lookup card. */
export type WordMark = "difficult" | "marked";

/** How a word is coloured on screen. A user mark wins over first appearance. */
export type WordStatus = WordMark | "new";

export const VOCABULARY_KEY: keyof StorageSchema = "vocabulary";

/**
 * Stored per source language, so "a" seen in English is not "a" seen in
 * Portuguese. Lives only in chrome.storage.local: none of it leaves the machine.
 */
export interface LanguageVocabulary {
  seen: string[];
  marks: Record<string, WordMark>;
}

export type VocabularyData = Record<string, LanguageVocabulary>;

interface LanguageState {
  seen: Set<string>;
  marks: Map<string, WordMark>;
}

type State = Map<string, LanguageState>;

export function isWordMark(value: unknown): value is WordMark {
  return value === "difficult" || value === "marked";
}

/** The key a word is stored under: the same normalisation as the lookups. */
export function wordKey(word: string): string {
  return cleanWord(word);
}

/** Storage contents are untrusted: keep what is well-formed, drop the rest. */
function readState(raw: unknown): State {
  const state: State = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return state;

  for (const [language, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const { seen, marks } = value as { seen?: unknown; marks?: unknown };
    const entry: LanguageState = { seen: new Set(), marks: new Map() };

    if (Array.isArray(seen)) {
      for (const word of seen) if (typeof word === "string" && word) entry.seen.add(word);
    }
    if (marks && typeof marks === "object" && !Array.isArray(marks)) {
      for (const [word, mark] of Object.entries(marks)) {
        if (word && isWordMark(mark)) entry.marks.set(word, mark);
      }
    }
    state.set(language, entry);
  }
  return state;
}

function toStorage(state: State): VocabularyData {
  const data: VocabularyData = {};
  for (const [language, entry] of state) {
    data[language] = { seen: [...entry.seen], marks: Object.fromEntries(entry.marks) };
  }
  return data;
}

function languageEntry(state: State, language: string): LanguageState {
  let entry = state.get(language);
  if (!entry) {
    entry = { seen: new Set(), marks: new Map() };
    state.set(language, entry);
  }
  return entry;
}

function nested<V>(map: Map<string, V>, language: string, create: () => V): V {
  let value = map.get(language);
  if (value === undefined) {
    value = create();
    map.set(language, value);
  }
  return value;
}

export interface VocabularyStore {
  /** Resolves once the stored vocabulary is loaded; until then nothing is new. */
  readonly ready: Promise<void>;
  /** Records a line's words as seen and returns the keys that were new. */
  observeLine(line: string, language: string): Set<string>;
  getMark(word: string, language: string): WordMark | null;
  setMark(word: string, language: string, mark: WordMark | null): void;
  /** Called whenever the stored vocabulary changes, from this tab or another. */
  onChange(cb: () => void): () => void;
  /** Writes anything still pending and stops listening. */
  dispose(): void;
}

/**
 * In memory, the vocabulary is the last stored state plus this tab's changes
 * not yet written. Writes are read-modify-write merges rather than overwrites,
 * so two open player tabs cannot erase each other's words or marks.
 */
export function createVocabularyStore(flushDelayMs = 1000): VocabularyStore {
  let stored: State = new Map();
  let loaded = false;
  let changeSeq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pendingSeen = new Map<string, Set<string>>();
  const pendingMarks = new Map<string, Map<string, WordMark | null>>();
  const listeners = new Set<() => void>();

  const isSeen = (language: string, key: string): boolean =>
    !!stored.get(language)?.seen.has(key) || !!pendingSeen.get(language)?.has(key);

  const markOf = (language: string, key: string): WordMark | null => {
    const pending = pendingMarks.get(language);
    if (pending?.has(key)) return pending.get(key) ?? null;
    return stored.get(language)?.marks.get(key) ?? null;
  };

  const flush = async (): Promise<void> => {
    timer = null;
    if (!pendingSeen.size && !pendingMarks.size) return;

    // Taken out before awaiting, so changes made meanwhile wait for the next flush.
    const seen = new Map(pendingSeen);
    const marks = new Map(pendingMarks);
    pendingSeen.clear();
    pendingMarks.clear();

    try {
      const result = await chrome.storage.local.get(VOCABULARY_KEY);
      const next = readState(result[VOCABULARY_KEY]);
      for (const [language, words] of seen) {
        const entry = languageEntry(next, language);
        for (const word of words) entry.seen.add(word);
      }
      for (const [language, changes] of marks) {
        const entry = languageEntry(next, language);
        for (const [word, mark] of changes) {
          if (mark) entry.marks.set(word, mark);
          else entry.marks.delete(word);
        }
      }
      await chrome.storage.local.set({ [VOCABULARY_KEY]: toStorage(next) });
      stored = next;
    } catch {
      // Put the changes back without overriding anything newer, to retry later.
      for (const [language, words] of seen) {
        const target = nested(pendingSeen, language, () => new Set<string>());
        for (const word of words) target.add(word);
      }
      for (const [language, changes] of marks) {
        const target = nested(pendingMarks, language, () => new Map<string, WordMark | null>());
        for (const [word, mark] of changes) if (!target.has(word)) target.set(word, mark);
      }
    }
  };

  const schedule = (): void => {
    if (timer === null) timer = setTimeout(() => void flush(), flushDelayMs);
  };

  const handleStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "local" || !(VOCABULARY_KEY in changes)) return;
    changeSeq++;
    stored = readState(changes[VOCABULARY_KEY].newValue);
    if (loaded) listeners.forEach((cb) => cb());
  };
  chrome.storage.onChanged.addListener(handleStorageChange);

  const ready = (async () => {
    const seq = changeSeq;
    try {
      const result = await chrome.storage.local.get(VOCABULARY_KEY);
      // A change event that arrived meanwhile already carries newer data.
      if (seq === changeSeq) stored = readState(result[VOCABULARY_KEY]);
    } catch {
      // Storage unavailable: keep going with an in-memory vocabulary.
    }
    loaded = true;
  })();

  return {
    ready,

    observeLine(line: string, language: string): Set<string> {
      const fresh = new Set<string>();
      // Before the stored words are known, every word would look new.
      if (!loaded) return fresh;

      for (const token of line.split(/\s+/)) {
        const key = wordKey(token);
        if (key && !isSeen(language, key)) fresh.add(key);
      }
      if (fresh.size) {
        const target = nested(pendingSeen, language, () => new Set<string>());
        for (const key of fresh) target.add(key);
        schedule();
      }
      return fresh;
    },

    getMark(word: string, language: string): WordMark | null {
      const key = wordKey(word);
      return key ? markOf(language, key) : null;
    },

    setMark(word: string, language: string, mark: WordMark | null): void {
      const key = wordKey(word);
      if (!key) return;
      nested(pendingMarks, language, () => new Map<string, WordMark | null>()).set(key, mark);
      schedule();
    },

    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    dispose(): void {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      listeners.clear();
      if (timer !== null) clearTimeout(timer);
      void flush();
    },
  };
}
