import { getAdapter } from "../adapters/registry.ts";
import { startCinetaroTop, startEmbeddedPlayer } from "./cinetaro-session.ts";
import { isCinetaroUrl, isEmbeddedPlayerUrl } from "../core/frame-messages.ts";
import { createSubtitleOverlay } from "../core/ui/subtitle-overlay.ts";
import { PhraseRepository } from "../core/storage.ts";
import { SettingsRepository, DIRECTION_LABELS, getLangPair } from "../core/settings.ts";
import { createVocabularyStore, wordKey, type WordStatus } from "../core/vocabulary.ts";
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

  // Words are coloured per source language: "new" means first appearance ever,
  // computed once when the line arrives so a re-render keeps the same colours.
  const vocabulary = createVocabularyStore();
  let newWords = new Set<string>();
  const sourceLanguage = (): string => getLangPair(settings.direction).source;
  const wordStatus = (word: string): WordStatus | null => {
    const mark = vocabulary.getMark(word, sourceLanguage());
    if (mark) return mark;
    return settings.highlightNewWords && newWords.has(wordKey(word)) ? "new" : null;
  };

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
    getWordStatus: wordStatus,
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
      const language = getLangPair(direction).source;
      const mark = vocabulary.getMark(word, language);
      const onMark = (next: typeof mark): void => {
        if (disposed) return;
        vocabulary.setMark(word, language, next);
        overlay.refreshWordStatuses();
      };

      overlay.showCard(
        {
          word,
          translation: "",
          definition: "",
          sentence,
          sentenceTranslation: "",
          directionLabel,
          state: "loading",
          mark,
        },
        () => {},
        onMark,
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
          // Re-read: the user may have marked it while the lookup was in flight.
          mark: vocabulary.getMark(word, language),
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
        onMark,
      );
    },
  });

  // Marks and words recorded by another tab (or before storage finished
  // loading) show up on the line already on screen.
  const stopVocabulary = vocabulary.onChange(() => overlay.refreshWordStatuses());
  void vocabulary.ready.then(() => {
    if (!disposed && generation === bootGeneration) overlay.refreshWordStatuses();
  });

  unsubscribe = SettingsRepository.onChange((next) => {
    const wasOff = !settings.showTranslation;
    const directionChanged = settings.direction !== next.direction;
    const highlightChanged = settings.highlightNewWords !== next.highlightNewWords;
    if (directionChanged || settings.showTranslation !== next.showTranslation) lineRequestId++;
    settings = next;
    overlay.applySettings(next);
    if (highlightChanged) overlay.refreshWordStatuses();
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
    newWords = text ? vocabulary.observeLine(text, sourceLanguage()) : new Set();
    overlay.update(text);

    if (!text || !settings.showTranslation) return;
    showLineTranslation(text);
  });

  stopContent = () => {
    lineRequestId++;
    lookupId++;
    stopObserving();
    unsubscribe();
    stopVocabulary();
    vocabulary.dispose();
    overlay.destroy();
  };
}

void boot().catch(() => cleanup());
