export interface SavedPhrase {
  id: string;
  sentence: string;
  selectedWord: string;
  translation: string;
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
