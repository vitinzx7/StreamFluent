import { getLangPair, DIRECTION_LABELS } from "./settings.ts";
import { PhraseRepository } from "./storage.ts";
import { wordContext, type StudySnapshot } from "./study-context.ts";
import { translateWord, type TranslationResult } from "./translation.ts";
import type { CardContent } from "./ui/word-card.ts";
import type { VocabularyStore, WordMark } from "./vocabulary.ts";

/** Phonetic + definition + example, collapsed into the card's second line. */
export function formatDefinition(result: TranslationResult): string {
  if (!result.definition) return "";
  const phonetic = result.phonetic ? `${result.phonetic} ` : "";
  const example = result.example ? ` e.g. "${result.example}"` : "";
  return `${phonetic}${result.definition}${example}`;
}

export interface WordActionsOptions {
  vocabulary: VocabularyStore;
  /** The line on screen; clicks act on its snapshot, captured before any await. */
  study(): StudySnapshot | null;
  /** Lookups started under another session never update the card. */
  sessionId(): string;
  isAlive(): boolean;
  showCard(
    content: CardContent,
    onSave: () => Promise<string>,
    onMark: (mark: WordMark | null) => Promise<void>
  ): void;
  /** Recolours the words on screen after a mark changed. */
  refresh(): void;
  feedback(message: string): void;
}

/**
 * The two word gestures of both subtitle paths: a left click opens the card
 * (translation, dictionary, marks, save), a right click marks the word as
 * difficult at once — offline, with no lookup and no extra phrase.
 */
export function createWordActions(options: WordActionsOptions) {
  // Clicking a second word while the first is still in flight must not let
  // the slower response overwrite the newer card.
  let lookupId = 0;

  return {
    async lookup(word: string): Promise<void> {
      const shown = options.study();
      if (!shown) return;
      const id = ++lookupId;
      const session = options.sessionId();
      const direction = shown.direction;
      const language = getLangPair(direction).source;
      const marked = wordContext(shown);
      const valid = (): boolean => options.isAlive() && id === lookupId && options.sessionId() === session;
      let translation = "";
      let definition = "";
      const extras = () => ({
        ...(translation ? { translation } : {}),
        ...(definition ? { definition } : {}),
      });

      const save = async (): Promise<string> => {
        const result = await PhraseRepository.saveResult({
          kind: "word",
          ...marked,
          targetLanguage: marked.targetLanguage ?? null,
          selectedWord: word,
          ...extras(),
        });
        return result.duplicate ? "Já salvo" : "Salvo";
      };
      const mark = async (next: WordMark | null): Promise<void> => {
        await options.vocabulary.setMark(word, language, next, { displayWord: word, context: marked, ...extras() });
        if (valid()) options.refresh();
      };
      const show = (state: CardContent["state"]): void => options.showCard({
        identity: String(id),
        word,
        translation,
        definition,
        sentence: shown.text,
        sentenceTranslation: shown.translation ?? "",
        directionLabel: DIRECTION_LABELS[direction],
        state,
        mark: options.vocabulary.getMark(word, language),
      }, save, mark);

      // The card and its mark buttons are usable while the lookup runs.
      show("loading");
      const result = await translateWord(word, direction);
      if (!valid()) return;
      translation = result.translation;
      definition = formatDefinition(result);
      show(result.error ? "error" : "ready");
    },

    markDifficult(word: string): void {
      // Everything is captured now: the line may change before the write lands.
      const shown = options.study();
      if (!shown) return;
      const session = options.sessionId();
      const language = getLangPair(shown.direction).source;
      const current = (): boolean => options.isAlive() && options.sessionId() === session;
      options.feedback("Salvando…");
      void options.vocabulary
        .setMark(word, language, "difficult", { displayWord: word, context: wordContext(shown) })
        .then((changed) => {
          if (!current()) return;
          options.refresh();
          // The worker says whether it changed: a quick second click knows it was already there.
          options.feedback(changed ? "Adicionada às difíceis" : "Já está nas difíceis");
        })
        .catch(() => {
          if (current()) options.feedback("Não foi possível salvar. Clique novamente para tentar.");
        });
    },

    /** The card closed, or the session or language changed: drop pending lookups. */
    cancel(): void {
      lookupId++;
    },
  };
}
