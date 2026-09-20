import { getAdapter } from "../adapters/registry.ts";
import { startCinetaroTop, startEmbeddedPlayer } from "./cinetaro-session.ts";
import { isCinetaroUrl, isEmbeddedPlayerUrl } from "../core/frame-messages.ts";
import { createSubtitleOverlay } from "../core/ui/subtitle-overlay.ts";
import { PhraseRepository } from "../core/storage.ts";
import { SettingsRepository, DIRECTION_LABELS } from "../core/settings.ts";
import {
  translateWord,
  translateSentence,
  type TranslationResult,
} from "../core/translation.ts";

/** Phonetic + definition + example, collapsed into the card's second line. */
function formatDefinition(result: TranslationResult): string {
  if (!result.definition) return "";
  const phonetic = result.phonetic ? `${result.phonetic} ` : "";
  const example = result.example ? ` e.g. "${result.example}"` : "";
  return `${phonetic}${result.definition}${example}`;
}

const lifecycle = globalThis as typeof globalThis & { __streamfluentCleanup?: () => void };
lifecycle.__streamfluentCleanup?.();
let disposed = false;
let bootGeneration = 0;
let stopContent = () => {};
function cleanup(): void {
  if (disposed) return;
  disposed = true;
  bootGeneration++;
  stopContent();
  window.removeEventListener("pagehide", cleanup);
}
const resume = (event: PageTransitionEvent): void => {
  if (!event.persisted || !disposed) return;
  disposed = false;
  window.addEventListener("pagehide", cleanup);
  void boot().catch(() => cleanup());
};
lifecycle.__streamfluentCleanup = () => {
  cleanup();
  window.removeEventListener("pageshow", resume);
};
window.addEventListener("pagehide", cleanup);
window.addEventListener("pageshow", resume);

async function boot(): Promise<void> {
  const generation = ++bootGeneration;
  if (isCinetaroUrl(location.href) && window === window.top) {
    stopContent = startCinetaroTop();
    return;
  }
  if (isEmbeddedPlayerUrl(location.href)) {
    if (window !== window.top) stopContent = startEmbeddedPlayer();
    return;
  }
  const adapter = getAdapter();
  if (!adapter) return;
  if (!adapter.isSupportedPage()) return;

  let settings = await SettingsRepository.get();
  if (disposed || generation !== bootGeneration) return;
  let unsubscribe = () => {};
  let currentLine: string | null = null;
  let lineRequestId = 0;

  const showLineTranslation = (line: string): void => {
    const id = ++lineRequestId;
    const page = location.href;
    void translateSentence(line, settings.direction).then((translation) => {
      if (!disposed && id === lineRequestId && page === location.href && settings.showTranslation && translation) {
        overlay.setTranslation(line, translation);
      }
    });
  };

  // Clicking a second word while the first is still in flight must not let the
  // slower response overwrite the newer card.
  let lookupId = 0;

  const overlay = createSubtitleOverlay({
    settings,
    onSettingsChange: (patch) => {
      // Storage is the source of truth: the write comes back through
      // onChange below, which refreshes `settings` and the panel controls.
      void SettingsRepository.save(patch);
    },
    onOpenLibrary: () => {
      void chrome.runtime.sendMessage({ type: "sf:open-library" });
    },
    onWordSelect: async (word, sentence) => {
      const direction = settings.direction;
      const directionLabel = DIRECTION_LABELS[direction];
      const id = ++lookupId;
      const page = location.href;
      const metadata = adapter.getMediaMetadata();

      overlay.showCard(
        {
          word,
          translation: "",
          definition: "",
          sentence,
          sentenceTranslation: "",
          directionLabel,
          state: "loading",
        },
        () => {},
      );

      // Already resolved and cached for the line on screen, so this is free.
      const [result, sentenceTranslation] = await Promise.all([
        translateWord(word, direction),
        translateSentence(sentence, direction),
      ]);
      if (disposed || id !== lookupId || page !== location.href) return;

      const definition = formatDefinition(result);

      overlay.showCard(
        {
          word: result.word,
          translation: result.translation,
          definition,
          sentence,
          sentenceTranslation,
          directionLabel,
          state: result.error ? "error" : "ready",
        },
        async () => {
          if (disposed || page !== location.href) return;
          await PhraseRepository.save({
            sentence,
            sentenceTranslation,
            selectedWord: word,
            translation: result.translation,
            definition,
            platform: adapter.name,
            mediaTitle: metadata?.title || "Unknown",
            season: metadata?.season ?? null,
            episode: metadata?.episode ?? null,
          });
        },
      );
    },
  });

  unsubscribe = SettingsRepository.onChange((next) => {
    const wasOff = !settings.showTranslation;
    const directionChanged = settings.direction !== next.direction;
    if (directionChanged || settings.showTranslation !== next.showTranslation) lineRequestId++;
    settings = next;
    overlay.applySettings(next);
    if (directionChanged) {
      lookupId++;
      overlay.hideCard();
      overlay.update(currentLine);
    }

    // Turning the option on mid-line should fill it in, not wait for the next cue.
    if ((wasOff || directionChanged) && next.showTranslation && currentLine) showLineTranslation(currentLine);
  });

  const stopObserving = adapter.observeSubtitles((cue) => {
    lineRequestId++;
    const text = cue?.text ?? null;
    currentLine = text;
    overlay.update(text);

    if (!text || !settings.showTranslation) return;
    showLineTranslation(text);
  });

  stopContent = () => {
    lineRequestId++;
    lookupId++;
    stopObserving();
    unsubscribe();
    overlay.destroy();
  };
}

void boot().catch(() => cleanup());
