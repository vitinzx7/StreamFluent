import { DEFAULT_SETTINGS, getLangPair, type LanguageDirection } from "./settings.ts";
import { requestProviderJson } from "./translation-request.ts";
import { wordKey } from "./word-normalization.ts";

export interface TranslationResult {
  word: string;
  /** Word rendered in the target language. Empty when the lookup came back with nothing. */
  translation: string;
  /** Dictionary extras, only filled in when the source language is English. */
  phonetic: string;
  definition: string;
  example: string;
  /** Set when nothing at all could be resolved. */
  error: string | null;
}

const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";
const GOOGLE_API = "https://clients5.google.com/translate_a/t";
const MYMEMORY_API = "https://api.mymemory.translated.net/get";

const NO_TRANSLATION = "Translation unavailable.";

/** Repeat clicks on the same word are common; the free APIs are rate limited. */
const cache = new Map<string, TranslationResult>();
const CACHE_LIMIT = 200;

/** Keeps accented letters so Portuguese words survive; drops surrounding punctuation. */
export function cleanWord(word: string): string {
  return wordKey(word);
}

interface DictionaryEntry {
  word: string;
  phonetic: string;
  definition: string;
  example: string;
}

async function fetchDefinition(word: string): Promise<DictionaryEntry | null> {
  const data = await requestProviderJson(`${DICT_API}/${encodeURIComponent(word)}`);
  if (!Array.isArray(data) || data.length === 0) return null;

  const entry = data[0];
  const meanings = entry.meanings || [];

  let definition = "";
  let example = "";
  for (const meaning of meanings) {
    const defs = meaning.definitions || [];
    if (defs.length > 0) {
      definition = defs[0].definition || "";
      example = defs[0].example || "";
    }
    if (definition) break;
  }

  if (!definition) return null;

  return {
    word: entry.word || word,
    phonetic: entry.phonetic || "",
    definition,
    example,
  };
}

/** The endpoint replies with strings nested at varying depths; flatten them all. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
}

/**
 * Undocumented endpoint with no availability or quota guarantee.
 * Requests may fail or change shape; MyMemory is the existing fallback.
 */
async function fetchGoogleTranslation(
  text: string,
  direction: LanguageDirection
): Promise<string> {
  const { source, target } = getLangPair(direction);
  const params = new URLSearchParams({
    client: "dict-chrome-ex",
    sl: source,
    tl: target,
    q: text,
  });

  const parts: string[] = [];
  collectStrings(await requestProviderJson(`${GOOGLE_API}?${params}`), parts);

  return parts.join("").replace(/\s+/g, " ").trim();
}

/** Official and documented, but the anonymous daily quota is small. */
async function fetchMyMemoryTranslation(
  text: string,
  direction: LanguageDirection
): Promise<string> {
  const { source, target } = getLangPair(direction);
  const langpair = encodeURIComponent(`${source}|${target}`);
  const data = await requestProviderJson(`${MYMEMORY_API}?q=${encodeURIComponent(text)}&langpair=${langpair}`) as {
    responseStatus?: unknown;
    responseData?: { translatedText?: unknown };
  } | null;
  if (Number(data?.responseStatus) !== 200) return "";

  const value = data?.responseData?.translatedText;
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  // MyMemory reports quota and validation problems *inside* translatedText.
  if (/^(MYMEMORY WARNING|INVALID|PLEASE SELECT|QUERY LENGTH LIMIT)/i.test(trimmed)) return "";

  return trimmed;
}

/**
 * Google is preferred, but it can hang for seconds. Past this, MyMemory is
 * asked too and the first useful answer wins; a Google failure asks MyMemory
 * at once instead of waiting for its 10 s timeout. MyMemory's anonymous quota
 * is small, so it is not asked for lines Google answers quickly.
 */
export const HEDGE_MS = 1200;

function fetchTranslation(text: string, direction: LanguageDirection): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    let pending = 0;
    let fallbackStarted = false;
    const finish = (value: string): void => {
      if (settled) return;
      pending--;
      // Done on the first translation, or once every provider asked came back empty.
      if (value || (pending === 0 && fallbackStarted)) {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
    };
    const fallback = (): void => {
      if (fallbackStarted || settled) return;
      fallbackStarted = true;
      pending++;
      void fetchMyMemoryTranslation(text, direction).catch(() => "").then(finish);
    };
    pending++;
    void fetchGoogleTranslation(text, direction).catch(() => "").then((google) => {
      if (!google) fallback();
      finish(google);
    });
    const timer = setTimeout(fallback, HEDGE_MS);
  });
}

function remember(key: string, result: TranslationResult): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result);
}

export function clearTranslationCache(): void {
  cacheGeneration++;
  cache.clear();
  sentenceCache.clear();
  pendingSentences.clear();
}

/** One entry per subtitle line; an episode is well under this. */
const sentenceCache = new Map<string, string>();
const pendingSentences = new Map<string, Promise<string>>();
let cacheGeneration = 0;
const SENTENCE_CACHE_LIMIT = 1000;

/**
 * Whole-line translation shown under the original subtitle. Separate cache from
 * the per-word one: lines repeat across an episode ("Yeah.", "Come on!"), and a
 * cache hit is what keeps this to roughly one request per distinct line.
 */
export async function translateSentence(
  text: string,
  direction: LanguageDirection = DEFAULT_SETTINGS.direction
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const key = `${direction}:${trimmed}`;
  const cached = sentenceCache.get(key);
  if (cached !== undefined) return cached;
  const pending = pendingSentences.get(key);
  if (pending) return pending;

  const generation = cacheGeneration;
  const request = fetchTranslation(trimmed, direction).then((translation) => {
    if (!translation || generation !== cacheGeneration) return translation;
    if (sentenceCache.size >= SENTENCE_CACHE_LIMIT) {
      const oldest = sentenceCache.keys().next().value;
      if (oldest !== undefined) sentenceCache.delete(oldest);
    }
    sentenceCache.set(key, translation);
    return translation;
  }).finally(() => {
    if (pendingSentences.get(key) === request) pendingSentences.delete(key);
  });
  pendingSentences.set(key, request);
  return request;
}

export async function translateWord(
  word: string,
  direction: LanguageDirection = DEFAULT_SETTINGS.direction
): Promise<TranslationResult> {
  const clean = cleanWord(word);
  if (!clean) {
    return { word, translation: "", phonetic: "", definition: "", example: "", error: NO_TRANSLATION };
  }

  const key = `${direction}:${clean}`;
  const cached = cache.get(key);
  if (cached) return { ...cached, word };

  // dictionaryapi.dev is English-only, so it is worth calling for en->pt only.
  const wantsDefinition = getLangPair(direction).source === "en";

  const [translation, entry] = await Promise.all([
    fetchTranslation(clean, direction).catch(() => ""),
    wantsDefinition ? fetchDefinition(clean).catch(() => null) : Promise.resolve(null),
  ]);

  const result: TranslationResult = {
    word: entry?.word || word,
    translation,
    phonetic: entry?.phonetic || "",
    definition: entry?.definition || "",
    example: entry?.example || "",
    error: translation || entry ? null : NO_TRANSLATION,
  };

  // Never cache a failure: it is usually a transient network/quota problem.
  if (!result.error) remember(key, result);

  return result;
}
