import type { StorageSchema } from "./types.ts";
import { isCefrLevel, type CefrLevel } from "./cefr.ts";
import { requestStudy } from "./study-messages.ts";

/** Which way a word lookup goes: source language first, then target. */
export type LanguageDirection = "en-pt" | "pt-en";

export interface Settings {
  direction: LanguageDirection;
  /** Show the translated line under the original subtitle. */
  showTranslation: boolean;
  /** Vertical position of the subtitle, as a percentage from the bottom. */
  subtitleBottom: number;
  /** Colour words the first time they ever appear in a subtitle. */
  highlightNewWords: boolean;
  /** Lilac marks English words above `level` (or, with no level yet, only words above C2). */
  highlightSpecialWords: boolean;
  autoPause: boolean;
  /** The user's English level; null until asked. */
  level: CefrLevel | null;
}

export const SETTINGS_KEY: keyof StorageSchema = "settings";

export const DEFAULT_SETTINGS: Settings = {
  direction: "en-pt",
  showTranslation: true,
  subtitleBottom: 12,
  highlightNewWords: true,
  highlightSpecialWords: false,
  autoPause: false,
  level: null,
};

/** Keeps a dragged subtitle on screen whatever the storage said. */
export const MIN_SUBTITLE_BOTTOM = 2;
export const MAX_SUBTITLE_BOTTOM = 88;

export function clampSubtitleBottom(value: number): number {
  return Math.min(MAX_SUBTITLE_BOTTOM, Math.max(MIN_SUBTITLE_BOTTOM, value));
}

const LANG_PAIRS: Record<LanguageDirection, { source: string; target: string }> = {
  "en-pt": { source: "en", target: "pt-BR" },
  "pt-en": { source: "pt-BR", target: "en" },
};

export const DIRECTION_LABELS: Record<LanguageDirection, string> = {
  "en-pt": "EN → PT",
  "pt-en": "PT → EN",
};

export function isLanguageDirection(value: unknown): value is LanguageDirection {
  return value === "en-pt" || value === "pt-en";
}

export function getLangPair(direction: LanguageDirection): { source: string; target: string } {
  return LANG_PAIRS[direction];
}

/** Settings read back from storage are untrusted: fall back per-field. */
export function normalizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const own = (key: keyof Settings): unknown => Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key] : undefined;
  const direction = own("direction");
  const showTranslation = own("showTranslation");
  const subtitleBottom = own("subtitleBottom");
  const highlightNewWords = own("highlightNewWords");
  const highlightSpecialWords = own("highlightSpecialWords");
  const autoPause = own("autoPause");
  const level = own("level");
  return {
    direction: isLanguageDirection(direction) ? direction : DEFAULT_SETTINGS.direction,
    showTranslation:
      typeof showTranslation === "boolean"
        ? showTranslation
        : DEFAULT_SETTINGS.showTranslation,
    subtitleBottom:
      typeof subtitleBottom === "number" && Number.isFinite(subtitleBottom)
        ? clampSubtitleBottom(subtitleBottom)
        : DEFAULT_SETTINGS.subtitleBottom,
    highlightNewWords:
      typeof highlightNewWords === "boolean"
        ? highlightNewWords
        : DEFAULT_SETTINGS.highlightNewWords,
    highlightSpecialWords: typeof highlightSpecialWords === "boolean" ? highlightSpecialWords : false,
    autoPause: typeof autoPause === "boolean" ? autoPause : false,
    level: isCefrLevel(level) ? level : null,
  };
}

export const SettingsRepository = {
  async get(): Promise<Settings> {
    const result = await requestStudy<{ settings: Settings }>("read");
    return normalizeSettings(result.data.settings);
  },

  async save(patch: Partial<Settings>): Promise<Settings> {
    const result = await requestStudy<Settings>("patch-settings", { patch });
    return normalizeSettings(result.data);
  },

  async toggleAutoPause(): Promise<Settings> {
    const result = await requestStudy<Settings>("toggle-auto-pause");
    return normalizeSettings(result.data);
  },

  /** Lets an open player tab pick up a change made in the popup, no reload. */
  onChange(cb: (settings: Settings) => void): () => void {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== "local") return;
      const change = changes[SETTINGS_KEY];
      if (!change) return;
      cb(normalizeSettings(change.newValue));
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
};
