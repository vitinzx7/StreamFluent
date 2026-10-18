import { BEYOND_C2, isAboveLevel, wordRank } from "./word-levels.ts";
import { tokenizeWords } from "./word-normalization.ts";
import type { Settings } from "./settings.ts";

/**
 * Colours for the demo build (`npm run build:demo`), meant for recording a
 * video: white prevails, and the automatic colours show one at a time.
 *
 * - At most one automatic colour per line, then `whiteLines` lines stay white.
 * - Blue and lilac take turns when a line could show either.
 * - Lilac is the hardest word above the user's level; blue is the hardest word
 *   at or below it that appears for the first time **since the page loaded**,
 *   so every take starts the same way. Short words and words outside the
 *   level list (names, slang) are never blue.
 * - Personal marks are left to the caller: they show as they are made.
 *
 * Every colour shown is still true (the word is above the level, or new in
 * this take); the demo only shows fewer of them.
 */
export const DEMO_WHITE_LINES = 2;
const MIN_NEW_LENGTH = 4;

export interface DemoPick {
  key: string;
  status: "new" | "special";
}

type ColourSettings = Pick<Settings, "highlightNewWords" | "highlightSpecialWords" | "level">;

export function createDemoColors(whiteLines = DEMO_WHITE_LINES) {
  const seen = new Map<string, Set<string>>();
  /** One decision per occurrence: a re-render or a mark keeps the line's colours. */
  const picks = new Map<string, DemoPick | null>();
  let sinceColour = whiteLines;
  let last: DemoPick["status"] | null = null;

  return {
    pick(occurrenceId: string, text: string, language: string, settings: ColourSettings): DemoPick | null {
      const known = picks.get(occurrenceId);
      if (known !== undefined) return known;

      let seenWords = seen.get(language);
      if (!seenWords) seen.set(language, (seenWords = new Set()));
      let special: { key: string; rank: number } | null = null;
      let fresh: { key: string; rank: number } | null = null;
      for (const { text: word, key } of tokenizeWords(text)) {
        if (!key) continue;
        const rank = language === "en" ? wordRank(word) : 0;
        if (settings.highlightSpecialWords && isAboveLevel(word, language, settings.level)) {
          const value = rank ?? BEYOND_C2;
          if (!special || value > special.rank) special = { key, rank: value };
        } else if (settings.highlightNewWords && rank !== null && key.length >= MIN_NEW_LENGTH && !seenWords.has(key)) {
          if (!fresh || rank > fresh.rank) fresh = { key, rank };
        }
      }
      // Every word of a shown line counts as seen, coloured or not.
      for (const { key } of tokenizeWords(text)) if (key) seenWords.add(key);

      let result: DemoPick | null = null;
      if (sinceColour >= whiteLines && (special || fresh)) {
        const status = special && fresh ? (last === "special" ? "new" : "special") : special ? "special" : "new";
        result = { key: (status === "special" ? special : fresh)!.key, status };
        last = status;
        sinceColour = 0;
      } else {
        sinceColour++;
      }
      picks.set(occurrenceId, result);
      return result;
    },
  };
}
