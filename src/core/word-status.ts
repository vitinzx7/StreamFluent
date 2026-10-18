import { isAboveLevel } from "./word-levels.ts";
import { wordKey } from "./word-normalization.ts";
import type { DisplayStatus, PersonalMark } from "./types.ts";
import type { Settings } from "./settings.ts";
export function resolveWordStatus(word: string, language: string, mark: PersonalMark | null, freshKeys: ReadonlySet<string>, settings: Pick<Settings, "highlightNewWords" | "highlightSpecialWords" | "level">): DisplayStatus {
  if (mark) return mark;
  // Lilac: above the user's English level. A personal mark always wins.
  if (settings.highlightSpecialWords && isAboveLevel(word, language, settings.level)) return "special";
  if (settings.highlightNewWords && freshKeys.has(wordKey(word))) return "new";
  return "normal";
}
