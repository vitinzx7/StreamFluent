import { getAdapter } from "../adapters/registry.ts";
import { createSubtitleOverlay } from "../core/ui/subtitle-overlay.ts";

function boot(): void {
  const adapter = getAdapter();
  if (!adapter) return;

  console.log(`[StreamFluent] detected: ${adapter.name}`);

  if (!adapter.isSupportedPage()) return;

  console.log("[StreamFluent] active on this page");

  const overlay = createSubtitleOverlay((word, sentence) => {
    console.log(`[StreamFluent] selected: "${word}" in "${sentence}"`);
    // Translation and save will be wired in Block 5 and Block 8
    overlay.showCard(word, "", sentence, () => {
      console.log(`[StreamFluent] save requested for: ${word}`);
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
