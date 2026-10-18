import { resolveWordStatus } from "../core/word-status.ts";
import { getAdapter } from "../adapters/registry.ts";
import { startCinetaroTop, startEmbeddedPlayer } from "./cinetaro-session.ts";
import { isCinetaroUrl, isEmbeddedPlayerUrl } from "../core/frame-messages.ts";
import { createSubtitleOverlay } from "../core/ui/subtitle-overlay.ts";
import { PhraseRepository } from "../core/storage.ts";
import { SettingsRepository, DIRECTION_LABELS, getLangPair } from "../core/settings.ts";
import { createVocabularyStore, type WordStatus } from "../core/vocabulary.ts";
import { createLineNavigation } from "../core/line-navigation.ts";
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
  let currentTranslation = "";
  let lineRequestId = 0;

  // Words are coloured per source language: "new" means first appearance ever,
  // computed once when the line arrives so a re-render keeps the same colours.
  const vocabulary = createVocabularyStore();
  let newWords = new Set<string>();
  let newWordsLanguage = "";
  let occurrenceId = 0;
  const sourceLanguage = (): string => getLangPair(settings.direction).source;
  const wordStatus = (word: string): WordStatus | null => {
    const mark = vocabulary.getMark(word, sourceLanguage());
    const status = resolveWordStatus(word, sourceLanguage(), mark, newWordsLanguage === sourceLanguage() ? newWords : new Set(), settings);
    return status === "normal" ? null : status;
  };

  const showLineTranslation = (line: string): void => {
    const id = ++lineRequestId;
    const page = location.href;
    void translateSentence(line, settings.direction).then((translation) => {
      if (!disposed && id === lineRequestId && page === location.href && settings.showTranslation && translation) {
        currentTranslation = translation;
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
      void SettingsRepository.save(patch).catch(() => overlay.showFeedback("Não foi possível salvar a preferência. Tente novamente."));
    },
    onOpenLibrary: (tab) => {
      void chrome.runtime.sendMessage({ type: "sf:open-library", ...(tab ? { tab } : {}) });
    },
    onCardClose: () => { lookupId++; },
    onWordDifficult: (word, sentence) => {
      const page = location.href, language = sourceLanguage(), metadata = adapter.getMediaMetadata();
      const previous = vocabulary.getMark(word, language);
      const context = { sentence, sentenceTranslation: currentLine === sentence ? currentTranslation : "", platform: adapter.name, mediaTitle: metadata?.title || "", season: metadata?.season ?? null, episode: metadata?.episode ?? null, sourceLanguage: language, targetLanguage: getLangPair(settings.direction).target, timeSeconds: adapter.getVideo?.()?.currentTime };
      overlay.showFeedback("Salvando…");
      void vocabulary.setMark(word, language, "difficult", { displayWord: word, context }).then(() => {
        if (!disposed && page === location.href) { overlay.refreshWordStatuses(); overlay.showFeedback(previous === "difficult" ? "Já está nas difíceis" : "Adicionada às difíceis"); }
      }).catch(() => { if (!disposed && page === location.href) overlay.showFeedback("Não foi possível salvar. Clique novamente para tentar."); });
    },
    onWordSelect: async (word, sentence) => {
      const direction = settings.direction;
      const directionLabel = DIRECTION_LABELS[direction];
      const id = ++lookupId;
      const page = location.href;
      const metadata = adapter.getMediaMetadata();
      const language = getLangPair(direction).source;
      const context = {
        sentence, sentenceTranslation: currentLine === sentence ? currentTranslation : "",
        platform: adapter.name, mediaTitle: metadata?.title || "", season: metadata?.season ?? null,
        episode: metadata?.episode ?? null, sourceLanguage: language, targetLanguage: getLangPair(direction).target,
        timeSeconds: adapter.getVideo?.()?.currentTime,
      };
      const video = adapter.getVideo?.();
      const valid = () => !disposed && id === lookupId && page === location.href && settings.direction === direction && video === adapter.getVideo?.();
      let translation = "", definition = "";
      const save = async () => {
        const result = await PhraseRepository.saveResult({ kind: "word", ...context, selectedWord: word, translation, definition });
        return result.duplicate ? "Já salvo" : "Salvo";
      };
      const onMark = async (next: "difficult" | "learned" | null): Promise<void> => {
        await vocabulary.setMark(word, language, next, { displayWord: word, context, translation, definition });
        if (valid()) overlay.refreshWordStatuses();
      };
      const show = (state: "loading" | "ready" | "error") => overlay.showCard({
        identity: String(id), word, translation, definition, sentence, sentenceTranslation: context.sentenceTranslation,
        directionLabel, state, mark: vocabulary.getMark(word, language),
      }, save, onMark);
      show("loading");
      const result = await translateWord(word, direction);
      if (!valid()) return;
      translation = result.translation; definition = formatDefinition(result);
      show(result.error ? "error" : "ready");
    },
  });

  // Marks and words recorded by another tab (or before storage finished
  // loading) show up on the line already on screen.
  const stopVocabulary = vocabulary.onChange(() => overlay.refreshWordStatuses());
  void vocabulary.ready.then(() => {
    if (!disposed && generation === bootGeneration) overlay.refreshWordStatuses();
  }).catch((error) => console.warn("StreamFluent: histórico indisponível.", error));

  unsubscribe = SettingsRepository.onChange((next) => {
    const wasOff = !settings.showTranslation;
    const directionChanged = settings.direction !== next.direction;
    const highlightChanged = settings.highlightNewWords !== next.highlightNewWords || settings.highlightSpecialWords !== next.highlightSpecialWords;
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

  // "A" jumps back to the previous subtitle line; it learns line times from
  // the same cues the overlay shows.
  const navigation = createLineNavigation(adapter);

  const stopObserving = adapter.observeSubtitles((cue) => {
    lineRequestId++;
    const text = cue?.text ?? null;
    const occurrence = ++occurrenceId;
    const page = location.href;
    const language = sourceLanguage();
    currentLine = text;
    currentTranslation = "";
    navigation.cueChanged(text);
    newWords = new Set();
    newWordsLanguage = language;
    overlay.update(text);
    if (text) {
      void vocabulary.observeLine(text, language, `${generation}:${occurrence}`).then((fresh) => {
        if (disposed || occurrence !== occurrenceId || page !== location.href || generation !== bootGeneration) return;
        newWords = fresh;
        overlay.refreshWordStatuses();
      }).catch(() => overlay.showFeedback("Não foi possível registrar o histórico desta fala."));
    }

    if (!text || !settings.showTranslation) return;
    showLineTranslation(text);
  });

  stopContent = () => {
    lineRequestId++;
    lookupId++;
    stopObserving();
    navigation.stop();
    unsubscribe();
    stopVocabulary();
    vocabulary.dispose();
    overlay.destroy();
  };
}

void boot().catch(() => cleanup());
