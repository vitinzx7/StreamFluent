import { getAdapter } from "../adapters/registry.ts";
import { createSubtitleOverlay } from "../core/ui/subtitle-overlay.ts";
import { PhraseRepository } from "../core/storage.ts";
import { translateWord } from "../core/translation.ts";

function boot(): void {
  const adapter = getAdapter();
  if (!adapter) return;

  console.log(`[StreamFluent] detected: ${adapter.name}`);

  if (!adapter.isSupportedPage()) return;

  console.log("[StreamFluent] active on this page");

  const overlay = createSubtitleOverlay(async (word, sentence) => {
    console.log(`[StreamFluent] selected: "${word}" in "${sentence}"`);

    // Show card immediately with loading state
    overlay.showCard(word, "Loading...", sentence, async () => {
      const metadata = adapter.getMediaMetadata();
      await PhraseRepository.save({
        sentence,
        selectedWord: word,
        translation: "",
        platform: adapter.name,
        mediaTitle: metadata?.title || "Unknown",
        season: metadata?.season ?? null,
        episode: metadata?.episode ?? null,
      });
      console.log(`[StreamFluent] phrase saved: ${word}`);
    });

    // Fetch translation
    const result = await translateWord(word);
    const display = result.definition
      ? `${result.phonetic ? result.phonetic + " " : ""}${result.definition}${result.example ? ` e.g. "${result.example}"` : ""}`
      : "No definition found.";

    // Update card with translation
    overlay.showCard(word, display, sentence, async () => {
      const metadata = adapter.getMediaMetadata();
      await PhraseRepository.save({
        sentence,
        selectedWord: word,
        translation: display,
        platform: adapter.name,
        mediaTitle: metadata?.title || "Unknown",
        season: metadata?.season ?? null,
        episode: metadata?.episode ?? null,
      });
      console.log(`[StreamFluent] phrase saved: ${word}`);
    });
  });

  adapter.observeSubtitles((cue) => {
    overlay.update(cue?.text ?? null);
  });

  window.addEventListener("unload", () => {
    overlay.destroy();
  });
}

boot();
