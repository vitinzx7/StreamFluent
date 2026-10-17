import type { Settings } from "./settings.ts";
import type { VocabularyData } from "./vocabulary.ts";

export interface SavedPhrase {
  id: string;
  sentence: string;
  /** The whole subtitle line translated, for review context in the library. */
  sentenceTranslation?: string;
  selectedWord: string;
  translation: string;
  /** Dictionary definition, only available when looking up English words. */
  definition?: string;
  platform: string;
  mediaTitle: string;
  season: number | null;
  episode: number | null;
  createdAt: string;
}

export interface MediaMetadata {
  title: string;
  season: number | null;
  episode: number | null;
}

export interface SubtitleCue {
  text: string;
  start: number;
  end: number;
}

export interface StreamingAdapter {
  name: string;
  isSupportedPage(): boolean;
  observeSubtitles(onCue: (cue: SubtitleCue | null) => void): () => void;
  getMediaMetadata(): MediaMetadata | null;
}

export interface StorageSchema {
  phrases: SavedPhrase[];
  settings: Settings;
  vocabulary: VocabularyData;
}
