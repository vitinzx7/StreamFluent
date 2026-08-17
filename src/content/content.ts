import { getAdapter } from "../adapters/registry.ts";
import { createSubtitleOverlay } from "../core/ui/subtitle-overlay.ts";
import { PhraseRepository } from "../core/storage.ts";
import { translateWord } from "../core/translation.ts";
import type { MediaMetadata } from "../core/types.ts";

function boot(): void {
  const adapter = getAdapter();
  if (!adapter) return;
  if (!adapter.isSupportedPage()) return;

  const overlay = createSubtitleOverlay(async (word, sentence) => {
    const getMetadata = (): MediaMetadata | null => adapter.getMediaMetadata();

    const buildSaveFn = (translation: string) => async () => {
      const metadata = getMetadata();
      await PhraseRepository.save({
        sentence,
        selectedWord: word,
        translation,
        platform: adapter.name,
        mediaTitle: metadata?.title || "Unknown",
        season: metadata?.season ?? null,
        episode: metadata?.episode ?? null,
      });
    };

    overlay.showCard(word, "Loading...", sentence, await buildSaveFn(""));

    const result = await translateWord(word);
    const display = result.definition
      ? `${result.phonetic ? result.phonetic + " " : ""}${result.definition}${result.example ? ` e.g. "${result.example}"` : ""}`
      : "No definition found.";

    overlay.showCard(word, display, sentence, await buildSaveFn(display));
  });

  adapter.observeSubtitles((cue) => {
    overlay.update(cue?.text ?? null);
  });

  window.addEventListener("unload", () => {
    overlay.destroy();
  });
}

boot();
