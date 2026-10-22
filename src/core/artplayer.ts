import { hideNativeSubtitles } from "./dom-utils.ts";

/**
 * Artplayer, the player inside the cinextream.cc frame (5.2.1 on 21/10/2026),
 * loads the subtitle chosen in its own menu as a `<track kind="metadata">`
 * (label "Artplayer") on its `video.art-video` and draws the active cues
 * itself in `.art-subtitle`. Choosing another language in that menu replaces
 * the `<track>` element, so the TextTrack object changes too; so does the video
 * entering its own fullscreen, which recreates it as `kind="subtitles"`. The
 * template starts with an empty one before any subtitle has loaded.
 */
const ARTPLAYER_VIDEO = "video.art-video";
const ARTPLAYER_LINE = ".art-subtitle";

/**
 * Only a track that a `<track>` element of an Artplayer video loads: other
 * metadata (hls.js ID3, chapters, thumbnails) is not a subtitle.
 */
export function isArtplayerSubtitleTrack(video: HTMLVideoElement | null, track: TextTrack): boolean {
  if (!video?.matches(ARTPLAYER_VIDEO) || (track.kind !== "metadata" && track.kind !== "subtitles")) return false;
  return Array.from(video.querySelectorAll("track"), (element) => element.track).includes(track);
}

/** The line Artplayer draws would sit right under ours. Undone by `restoreNativeSubtitles(doc)`. */
export function hideArtplayerLine(doc: Document): void {
  const line = doc.querySelector<HTMLElement>(ARTPLAYER_LINE);
  if (line) hideNativeSubtitles(line);
}
