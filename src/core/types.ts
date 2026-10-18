import type { Settings } from "./settings.ts";
export type PersonalMark = "difficult" | "learned";
export type DisplayStatus = "normal" | "new" | "special" | PersonalMark;

export interface WordContext {
  sentence: string;
  sentenceTranslation?: string;
  platform: string;
  mediaTitle: string;
  season: number | null;
  episode: number | null;
  timeSeconds?: number;
  sourceLanguage: string;
  targetLanguage?: string;
}

export interface WordDetails {
  displayWord: string;
  markedAt: string | null;
  updatedAt: string | null;
  context?: WordContext;
  translation?: string;
  definition?: string;
}

export interface LanguageVocabulary {
  seen: string[];
  marks: Record<string, PersonalMark>;
  details: Record<string, WordDetails>;
}

export interface VocabularyV2 {
  schemaVersion: 2;
  languages: Record<string, LanguageVocabulary>;
}

export interface SavedPhraseBase {
  id: string;
  kind: "word" | "sentence";
  sentence: string;
  sentenceTranslation?: string;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  platform: string;
  mediaTitle: string;
  season: number | null;
  episode: number | null;
  timeSeconds?: number;
  createdAt: string;
}

export type SavedPhrase =
  | (SavedPhraseBase & { kind: "word"; selectedWord: string; translation?: string; definition?: string })
  | (SavedPhraseBase & { kind: "sentence" });
export type SavedPhraseV2 = SavedPhrase;
type WithoutGenerated<T> = T extends unknown ? Omit<T, "id" | "createdAt"> : never;
export type SavedPhraseInput = WithoutGenerated<SavedPhrase>;

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
  /** The video element playing the episode, read for the playback position. */
  getVideo?(): HTMLVideoElement | null;
  /**
   * Moves playback to `seconds`. Resolves false when the platform did not take
   * it — and must never fall back to anything that can break its player.
   */
  seekTo?(seconds: number): Promise<boolean>;
  play?(): Promise<boolean>;
  pause?(): Promise<boolean>;
  /** Synchronous: whether play/pause are known to work right now. */
  canPlayPause?(): boolean;
}

export interface StorageSchema {
  phrases: SavedPhrase[];
  settings: Settings;
  vocabulary: VocabularyV2;
  studyRevision: number;
}
