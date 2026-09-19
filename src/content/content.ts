import { getAdapter } from "../adapters/registry.ts";
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

async function boot(): Promise<void> {
  const adapter = getAdapter();
  if (!adapter) return;
  if (!adapter.isSupportedPage()) return;

  let settings = await SettingsRepository.get();
  let unsubscribe = () => {};
  let currentLine: string | null = null;

  const showLineTranslation = (line: string): void => {
    void translateSentence(line, settings.direction).then((translation) => {
      // The overlay drops the result if the line already changed.
      if (translation) overlay.setTranslation(line, translation);
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
      chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
    },
    onWordSelect: async (word, sentence) => {
      const direction = settings.direction;
      const directionLabel = DIRECTION_LABELS[direction];
      const id = ++lookupId;

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
      if (id !== lookupId) return;

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
          const metadata = adapter.getMediaMetadata();
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
    settings = next;
    overlay.applySettings(next);

    // Turning the option on mid-line should fill it in, not wait for the next cue.
    if (wasOff && next.showTranslation && currentLine) showLineTranslation(currentLine);
  });

  adapter.observeSubtitles((cue) => {
    const text = cue?.text ?? null;
    currentLine = text;
    overlay.update(text);

    if (!text || !settings.showTranslation) return;
    showLineTranslation(text);
  });

  window.addEventListener("unload", () => {
    unsubscribe();
    overlay.destroy();
  });
}

void boot();
