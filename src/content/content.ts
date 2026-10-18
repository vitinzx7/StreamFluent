import { resolveWordStatus } from "../core/word-status.ts";
import { getAdapter } from "../adapters/registry.ts";
import { startCinetaroTop, startEmbeddedPlayer } from "./cinetaro-session.ts";
import { isCinetaroUrl, isEmbeddedPlayerUrl } from "../core/frame-messages.ts";
import { createSubtitleOverlay } from "../core/ui/subtitle-overlay.ts";
import { PhraseRepository } from "../core/storage.ts";
import { SettingsRepository, getLangPair } from "../core/settings.ts";
import { createVocabularyStore, type WordStatus } from "../core/vocabulary.ts";
import { createLineNavigation } from "../core/line-navigation.ts";
import { createPlaybackController, type PlaybackDriver } from "../core/playback-controller.ts";
import { createStudyContext, type StudySnapshot } from "../core/study-context.ts";
import { createWordActions } from "../core/word-actions.ts";
import { createStudyActions } from "../core/study-actions.ts";
import { installShortcuts } from "../core/keyboard-shortcuts.ts";
import { createDomAutoPause } from "../core/auto-pause.ts";
import type { StreamingAdapter } from "../core/types.ts";
import { translateSentence } from "../core/translation.ts";

const NO_WORDS: ReadonlySet<string> = new Set();

/** Seeks, play and pause go through the platform adapter; a missing one just fails. */
function adapterDriver(adapter: StreamingAdapter, getSessionId: () => string): PlaybackDriver {
  return {
    getVideo: () => adapter.getVideo?.() ?? null,
    getSessionId,
    seekTo: (seconds) => adapter.seekTo?.(seconds) ?? Promise.resolve(false),
    play: () => adapter.play?.() ?? Promise.resolve(false),
    pause: () => adapter.pause?.() ?? Promise.resolve(false),
    canPlayPause: () => adapter.canPlayPause?.() ?? false,
  };
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
  const alive = (): boolean => !disposed && generation === bootGeneration;

  // Live, held and retained lines; R, copy, S and the cards read snapshots
  // from here instead of whatever is on screen after an await.
  const context = createStudyContext();
  let lineRequestId = 0;
  let occurrenceSequence = 0;
  /** The occurrence currently rendered in the overlay. */
  let shownOccurrence = "";

  // An episode is the URL path plus the <video> playing it. Anything pending
  // for the previous one is dropped when either changes.
  let sessionVideo: HTMLVideoElement | null | undefined;
  let sessionPath = location.pathname;
  let sessionSequence = 0;
  /** Shortcuts stay off until this session showed a subtitle: previews and menus keep their keys. */
  let sessionHasLines = false;
  const syncSession = (): string => {
    const video = adapter.getVideo?.() ?? null;
    if (video !== sessionVideo || location.pathname !== sessionPath) {
      const first = sessionVideo === undefined;
      sessionVideo = video;
      sessionPath = location.pathname;
      sessionSequence++;
      sessionHasLines = false;
      if (!first) endSession();
      bindVideo(video);
    }
    return `${generation}:${sessionSequence}`;
  };

  // Resuming, or any seek, gives the screen back to the live line.
  let boundVideo: HTMLVideoElement | null = null;
  const releaseRetained = (): void => {
    if (!context.retained && !context.held) return;
    context.release();
    present();
  };
  const onJump = (): void => {
    autoPause.jumped();
    releaseRetained();
  };
  // Not a second jump: the line shown at the destination must stay armed.
  const onLanded = (): void => autoPause.landed();
  const bindVideo = (video: HTMLVideoElement | null): void => {
    boundVideo?.removeEventListener("play", releaseRetained);
    boundVideo?.removeEventListener("seeking", onJump);
    boundVideo?.removeEventListener("seeked", onLanded);
    boundVideo = video;
    video?.addEventListener("play", releaseRetained);
    video?.addEventListener("seeking", onJump);
    video?.addEventListener("seeked", onLanded);
  };
  syncSession();
  const shortcutsActive = (): boolean => {
    if (!alive() || !adapter.getVideo?.()) return false;
    syncSession();
    return sessionHasLines;
  };

  // Words are coloured per source language: "new" means first appearance ever,
  // computed once per occurrence so a re-render keeps the same colours.
  const vocabulary = createVocabularyStore();
  const sourceLanguage = (): string => getLangPair(settings.direction).source;
  const wordStatus = (word: string): WordStatus | null => {
    const shown = context.study;
    const fresh = shown && shown.direction === settings.direction ? shown.freshKeys : NO_WORDS;
    const language = sourceLanguage();
    const status = resolveWordStatus(word, language, vocabulary.getMark(word, language), fresh, settings);
    return status === "normal" ? null : status;
  };

  /** One request per shown occurrence; a reply for anything else is dropped. */
  const translateLine = (shown: StudySnapshot): void => {
    const id = ++lineRequestId;
    const page = location.href;
    const direction = settings.direction;
    void translateSentence(shown.text, direction).then((translation) => {
      if (!alive() || id !== lineRequestId || page !== location.href) return;
      if (!settings.showTranslation || settings.direction !== direction || !translation) return;
      if (context.study?.occurrenceId !== shown.occurrenceId) return;
      context.translate(shown.occurrenceId, translation);
      overlay.setTranslation(shown.text, translation);
    });
  };

  /** Words count as seen only once their line is actually shown. */
  const observeWords = (shown: StudySnapshot): void => {
    void vocabulary
      .observeLine(shown.text, getLangPair(shown.direction).source, shown.occurrenceId)
      .then((fresh) => {
        if (!alive()) return;
        context.setFresh(shown.occurrenceId, fresh);
        overlay.refreshWordStatuses();
      })
      .catch(() => overlay.showFeedback("Não foi possível registrar o histórico desta fala."));
  };

  /** Renders the study line when it changed; same occurrence, same colours. */
  const present = (): void => {
    const shown = context.study;
    const occurrence = shown?.occurrenceId ?? "";
    if (occurrence === shownOccurrence) {
      overlay.refreshWordStatuses();
      return;
    }
    shownOccurrence = occurrence;
    lineRequestId++;
    overlay.update(shown?.text ?? null);
    if (!shown) return;
    observeWords(shown);
    if (shown.translation) overlay.setTranslation(shown.text, shown.translation);
    else if (settings.showTranslation) translateLine(shown);
  };

  const endSession = (): void => {
    words.cancel();
    lineRequestId++;
    context.clear();
    autoPause.reset();
    controller.invalidate();
    overlay.hideCard();
    present();
  };

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
    onStudyCommand: (command) => actions.trigger(command),
    onCardClose: () => words.cancel(),
    onWordDifficult: (word) => words.markDifficult(word),
    onWordSelect: (word) => words.lookup(word),
  });

  // Left click: the card. Right click: difficult at once, offline.
  const words = createWordActions({
    vocabulary,
    study: () => context.study,
    sessionId: syncSession,
    isAlive: alive,
    showCard: (content, onSave, onMark) => overlay.showCard(content, onSave, onMark),
    refresh: () => overlay.refreshWordStatuses(),
    feedback: (message) => overlay.showFeedback(message),
  });

  // Learns line times from the same cues the overlay shows; the A key itself
  // belongs to the shortcut router below.
  const navigation = createLineNavigation(adapter);

  const controller = createPlaybackController(adapterDriver(adapter, syncSession), {
    backTarget: (from) => navigation.backTarget(from),
    // A, D and S release the retained line at once, before the seek lands.
    onNavigate: onJump,
  });

  // Pauses when a line leaves the screen; the DOM gives no end time, so this
  // is approximate by nature and never seeks back to make up for it.
  const autoPause = createDomAutoPause({
    enabled: () => settings.autoPause,
    pause: () => controller.pause(),
    hold: (snapshot) => {
      context.hold(snapshot);
      present();
    },
    retain: (snapshot) => {
      context.retain(snapshot);
      present();
    },
    failed: () => {
      context.release();
      present();
      overlay.showFeedback("A pausa automática não conseguiu pausar o vídeo.");
    },
  });

  const actions = createStudyActions({
    controller,
    study: () => context.study,
    sessionId: syncSession,
    toggleAutoPause: () => SettingsRepository.toggleAutoPause(),
    savePhrase: (phrase) => PhraseRepository.saveResult(phrase),
    feedback: (message) => overlay.showFeedback(message),
    showCopyFallback: (text) => overlay.showCopyFallback(text),
    clipboard: () => navigator.clipboard,
  });

  const stopShortcuts = installShortcuts(window, {
    isActive: shortcutsActive,
    canRun: actions.canRun,
    run: actions.run,
    explain: actions.explain,
  });

  // Marks and words recorded by another tab (or before storage finished
  // loading) show up on the line already on screen.
  const stopVocabulary = vocabulary.onChange(() => overlay.refreshWordStatuses());
  void vocabulary.ready.then(() => {
    if (alive()) overlay.refreshWordStatuses();
  }).catch((error) => console.warn("StreamFluent: histórico indisponível.", error));

  const unsubscribe = SettingsRepository.onChange((next) => {
    const wasOff = !settings.showTranslation;
    const directionChanged = settings.direction !== next.direction;
    const highlightChanged = settings.highlightNewWords !== next.highlightNewWords || settings.highlightSpecialWords !== next.highlightSpecialWords;
    if (directionChanged || settings.showTranslation !== next.showTranslation) lineRequestId++;
    settings = next;
    overlay.applySettings(next);
    if (highlightChanged) overlay.refreshWordStatuses();
    if (directionChanged) {
      // Another language is another study context: the same text on screen,
      // without the old translation, colours or retained line.
      words.cancel();
      overlay.hideCard();
      autoPause.reset();
      context.release();
      const live = context.live;
      if (live) {
        const { translation: _old, ...rest } = live;
        context.setLive({ ...rest, direction: next.direction, freshKeys: NO_WORDS });
      }
      shownOccurrence = context.study?.occurrenceId ?? "";
      overlay.update(context.study?.text ?? null);
    }

    // Turning the option on mid-line should fill it in, not wait for the next cue.
    const shown = context.study;
    if ((wasOff || directionChanged) && next.showTranslation && shown) translateLine(shown);
  });

  const stopObserving = adapter.observeSubtitles((cue) => {
    const session = syncSession();
    const text = cue?.text ?? null;
    navigation.cueChanged(text);
    // Netflix answers whether it supports play/pause in the background.
    adapter.canPlayPause?.();

    let next: StudySnapshot | null = null;
    if (text) {
      sessionHasLines = true;
      // The DOM gives no times (start/end are 0): use what the timeline recorded.
      const timing = navigation.current();
      const metadata = adapter.getMediaMetadata();
      next = {
        sessionId: session,
        sourceId: `${adapter.name}:dom`,
        cueId: timing ? `dom@${timing.start.toFixed(2)}` : "dom",
        occurrenceId: `${session}:${++occurrenceSequence}`,
        text,
        direction: settings.direction,
        ...(timing ? { start: timing.start } : {}),
        ...(timing?.previousEnd !== undefined ? { previousEnd: timing.previousEnd } : {}),
        platform: adapter.name,
        mediaTitle: metadata?.title || "",
        season: metadata?.season ?? null,
        episode: metadata?.episode ?? null,
        freshKeys: NO_WORDS,
      };
    }
    // Captured before it is replaced: the line that ended is the one retained.
    const previous = context.live;
    context.setLive(next);
    if (previous) autoPause.lineEnded(previous, adapter.getVideo?.() ?? null);
    if (next) autoPause.lineShown(next);
    present();
  });

  stopContent = () => {
    lineRequestId++;
    words.cancel();
    stopObserving();
    stopShortcuts();
    autoPause.reset();
    bindVideo(null);
    controller.stop();
    navigation.stop();
    unsubscribe();
    stopVocabulary();
    vocabulary.dispose();
    overlay.destroy();
  };
}

void boot().catch(() => cleanup());
