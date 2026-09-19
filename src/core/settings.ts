import type { StorageSchema } from "./types.ts";

/** Which way a word lookup goes: source language first, then target. */
export type LanguageDirection = "en-pt" | "pt-en";

export interface Settings {
  direction: LanguageDirection;
  /** Show the translated line under the original subtitle. */
  showTranslation: boolean;
  /** Vertical position of the subtitle, as a percentage from the bottom. */
  subtitleBottom: number;
}

export const SETTINGS_KEY: keyof StorageSchema = "settings";

export const DEFAULT_SETTINGS: Settings = {
  direction: "en-pt",
  showTranslation: true,
  subtitleBottom: 12,
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
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const { direction, showTranslation, subtitleBottom } = raw as {
    direction?: unknown;
    showTranslation?: unknown;
    subtitleBottom?: unknown;
  };
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
  };
}

export const SettingsRepository = {
  async get(): Promise<Settings> {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(result[SETTINGS_KEY]);
  },

  async save(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const next = normalizeSettings({ ...current, ...patch });
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
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
