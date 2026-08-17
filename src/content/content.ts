import { getAdapter } from "../adapters/registry.ts";
import { createSubtitleOverlay } from "../core/ui/subtitle-overlay.ts";
import { PhraseRepository } from "../core/storage.ts";

function boot(): void {
  const adapter = getAdapter();
  if (!adapter) return;

  console.log(`[StreamFluent] detected: ${adapter.name}`);

  if (!adapter.isSupportedPage()) return;

  console.log("[StreamFluent] active on this page");

  const overlay = createSubtitleOverlay((word, sentence) => {
    console.log(`[StreamFluent] selected: "${word}" in "${sentence}"`);
    overlay.showCard(word, "", sentence, async () => {
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
  });

  adapter.observeSubtitles((cue) => {
    overlay.update(cue?.text ?? null);
  });

  window.addEventListener("unload", () => {
    overlay.destroy();
  });
}

boot();
