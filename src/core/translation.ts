export interface TranslationResult {
  word: string;
  phonetic: string;
  definition: string;
  example: string;
}

const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";

export async function translateWord(word: string): Promise<TranslationResult> {
  const clean = word.toLowerCase().replace(/[^a-z'-]/g, "");
  if (!clean) {
    return { word, phonetic: "", definition: "", example: "" };
  }

  try {
    const res = await fetch(`${DICT_API}/${encodeURIComponent(clean)}`);
    if (!res.ok) {
      return { word, phonetic: "", definition: "No definition found.", example: "" };
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { word, phonetic: "", definition: "No definition found.", example: "" };
    }

    const entry = data[0];
    const phonetic = entry.phonetic || "";
    const meanings = entry.meanings || [];

    let definition = "";
    let example = "";

    for (const meaning of meanings) {
      const defs = meaning.definitions || [];
      if (defs.length > 0 && !definition) {
        definition = defs[0].definition || "";
        example = defs[0].example || "";
      }
      if (definition) break;
    }

    return {
      word: entry.word || word,
      phonetic,
      definition: definition || "No definition found.",
      example,
    };
  } catch {
    return { word, phonetic: "", definition: "Failed to fetch definition.", example: "" };
  }
}
