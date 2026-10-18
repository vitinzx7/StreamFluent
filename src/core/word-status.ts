import { isSpecialWord } from "./special-words.ts";
import { wordKey } from "./word-normalization.ts";
import type { DisplayStatus, PersonalMark } from "./types.ts";
import type { Settings } from "./settings.ts";
export function resolveWordStatus(word: string, language: string, mark: PersonalMark | null, freshKeys: ReadonlySet<string>, settings: Pick<Settings, "highlightNewWords" | "highlightSpecialWords">): DisplayStatus {
  if (mark) return mark;
  if (settings.highlightSpecialWords && isSpecialWord(word, language)) return "special";
  if (settings.highlightNewWords && freshKeys.has(wordKey(word))) return "new";
  return "normal";
}
