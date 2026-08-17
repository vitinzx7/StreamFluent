import { getAdapter } from "../adapters/registry.ts";

function boot(): void {
  const adapter = getAdapter();
  if (!adapter) return;

  console.log(`[StreamFluent] detected: ${adapter.name}`);

  if (!adapter.isSupportedPage()) return;

  console.log("[StreamFluent] active on this page");

  const unsubscribe = adapter.observeSubtitles((cue) => {
    if (cue) {
      console.log("[StreamFluent] subtitle:", cue.text);
    }
  });

  // Disconnect when user navigates away
  window.addEventListener("unload", () => {
    unsubscribe();
  });
}

boot();
