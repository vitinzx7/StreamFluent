/** One identity for lookup, personal vocabulary and the bundled special list. */
export function wordKey(word: string): string {
  const normalized = word.normalize("NFC").toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, "");
  return /\p{L}/u.test(normalized) ? normalized : "";
}

export interface WordToken { text: string; key: string | null }

/** Lossless tokenization: punctuation and all spacing remain separate text. */
export function tokenizeWords(text: string): WordToken[] {
  const result: WordToken[] = [];
  const pattern = /[\p{L}\p{M}]+(?:['\u2018\u2019\u02bc\-\u2010\u2011][\p{L}\p{M}]+)*/gu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    if (index > cursor) result.push({ text: text.slice(cursor, index), key: null });
    result.push({ text: match[0], key: wordKey(match[0]) || null });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), key: null });
  return result;
}
