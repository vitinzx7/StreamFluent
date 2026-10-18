import { createWordRenderer, WORD_STYLES } from "./word-renderer.ts";
import { createWordCard, placeCard, CARD_STYLES, type CardContent } from "./word-card.ts";
export type { CardContent } from "./word-card.ts";
import { EXTENSION_MARKER } from "../dom-utils.ts";
import { createIdleFade, isolatePointer, IDLE_CLASS } from "./idle-fade.ts";
import { bindPanel, PANEL_HTML, PANEL_STYLES } from "./settings-panel.ts";
import { CEFR_LEVELS, LEVEL_LABELS, isCefrLevel } from "../cefr.ts";
import {
  clampSubtitleBottom,
  isLanguageDirection,
  type Settings,
} from "../settings.ts";
import type { WordMark, WordStatus } from "../vocabulary.ts";

const STYLE_ID = "streamfluent-overlay";
const FEEDBACK_MS = 3000;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = WORD_STYLES + CARD_STYLES + PANEL_STYLES + `
    .sf-overlay {
      position: fixed;
      bottom: 12%;
      cursor: grab;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      pointer-events: auto;
      user-select: none;
      max-width: 80%;
      text-align: center;
      white-space: pre-wrap;
      /* Typography is set here, not on .sf-word: the spaces between words are
         text nodes of this container, so they must share the words' font for
         the gap to be one real space. */
      /* Netflix's own cue stack, so on netflix.com this picks up Netflix Sans
         (already loaded by the page) and degrades elsewhere the way theirs does. */
      font-family: "Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
      /* 700, not 500: most installed fonts ship only Regular and Bold, and 500
         silently falls back to Regular, which is what made the line look thin. */
      font-weight: 700;
      /* Scales with the picture like the players' cues: about 4.6% of a 16:9
         video's height, whether the window letterboxes or pillarboxes it. */
      font-size: clamp(18px, min(4.6vh, 2.6vw), 60px);
      line-height: 1.25;
      color: #ffffff;
      /* A tight dark edge plus a soft drop: readable over bright scenes too. */
      text-shadow:
        0 0 0.05em #000,
        0 0 0.08em #000,
        0 0 0.12em #000,
        0 0.04em 0.25em rgba(0, 0, 0, 0.7);
    }
    .sf-overlay.sf-hidden {
      display: none;
    }
    .sf-overlay.sf-dragging,
    .sf-overlay.sf-dragging .sf-word {
      cursor: grabbing;
    }
    /* The panel itself is styled in settings-panel.ts (mid-height on the right
       edge, clear of the player's bottom bar and of its top-left back arrow).
       This plain button is also the copy box's "Fechar". */
    .sf-panel-btn {
      display: block;
      width: 100%;
      padding: 8px;
      border: none;
      border-radius: 6px;
      background: #16213e;
      color: #e0e0e0;
      font-size: 12px;
      cursor: pointer;
      margin-top: 12px;
    }
    .sf-panel-btn:hover {
      background: #1a3a5c;
    }
    .sf-feedback {
      position: fixed;
      top: 10%;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100002;
      max-width: 60vw;
      padding: 6px 10px;
      border-radius: 6px;
      background: #1a1a2e;
      color: #fff;
      font: 14px/1.4 system-ui, sans-serif;
      pointer-events: none;
    }
    .sf-feedback:empty {
      display: none;
    }
    .sf-level-prompt {
      position: fixed;
      top: 16%;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100003;
      width: min(520px, calc(100vw - 32px));
      padding: 16px;
      border-radius: 10px;
      background: #1a1a2e;
      border: 1px solid #C4A5FF;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      color: #e0e0e0;
      font: 14px/1.4 system-ui, sans-serif;
    }
    .sf-level-prompt.sf-hidden {
      display: none;
    }
    .sf-level-title {
      font-size: 16px;
      font-weight: 700;
      color: #C4A5FF;
    }
    .sf-level-hint {
      margin: 4px 0 12px;
      font-size: 12px;
      color: #aab;
    }
    .sf-level-options {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }
    .sf-level-options button,
    .sf-level-later {
      padding: 8px;
      border: 1px solid #2a3a5c;
      border-radius: 6px;
      background: #16213e;
      color: #e0e0e0;
      font: inherit;
      cursor: pointer;
    }
    .sf-level-options button:hover {
      border-color: #C4A5FF;
    }
    .sf-level-later {
      margin-top: 10px;
      background: transparent;
    }
    .sf-copy {
      position: fixed;
      left: 50%;
      top: 30%;
      transform: translateX(-50%);
      z-index: 100003;
      width: min(480px, calc(100vw - 32px));
      padding: 14px;
      border-radius: 10px;
      background: #1a1a2e;
      border: 1px solid rgba(0, 212, 170, 0.3);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      color: #e0e0e0;
      font: 13px/1.4 system-ui, sans-serif;
      user-select: text;
    }
    .sf-copy.sf-hidden {
      display: none;
    }
    .sf-copy-text {
      display: block;
      width: 100%;
      margin: 8px 0 0;
      padding: 6px;
      border: 1px solid #2a3a5c;
      border-radius: 5px;
      background: #16213e;
      color: #fff;
      font: inherit;
      resize: vertical;
      box-sizing: border-box;
    }
    .sf-line-target {
      margin-top: 0.15em;
      color: #7ee8d0;
      font-size: 0.8em;
    }
    .sf-line-target:empty {
      display: none;
    }
    .sf-word {
      display: inline-block;
      /* The highlight reaches past the word without widening the gap: the
         negative margin gives back exactly what the padding takes, so words
         sit one ordinary space apart, as in the player's own subtitles. */
      padding: 0.04em 0.14em;
      margin: 0 -0.14em;
      border-radius: 0.18em;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
    }
    /* Light tints: they stay readable inside the dark outline. */
    /* The five states of section 2.3; word-renderer.ts uses the same values. */
    .sf-word-special, .sf-legend-special { color: #C4A5FF; }
    .sf-word-new, .sf-legend-new { color: #8ECBFF; }
    .sf-word-difficult, .sf-legend-difficult { color: #FF8A80; }
    .sf-word-learned, .sf-legend-learned { color: #81C784; }
    /* A light veil, not a coloured block: the word keeps its own colour. */
    .sf-word:hover {
      background: rgba(255, 255, 255, 0.14);
      transform: translateY(-1px);
    }
    .sf-word.sf-selected {
      background: rgba(255, 255, 255, 0.22);
    }
    .sf-card {
      position: fixed;
      z-index: 100000;
    }
    .sf-fab {
      position: fixed;
      top: 50%;
      right: 16px;
      transform: translateY(-50%);
      z-index: 99998;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: #1a1a2e;
      color: #00d4aa;
      font-size: 18px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s, transform 0.2s;
      opacity: 0.6;
    }
    .sf-fab:hover {
      opacity: 1;
      transform: translateY(-50%) scale(1.1);
    }
    /* Rests out of sight while the mouse is still, like the player's controls. */
    .sf-fab.${IDLE_CLASS} {
      opacity: 0;
      pointer-events: none;
    }
    .sf-fab.sf-hidden {
      display: none;
    }
  `;
  document.head.appendChild(style);
}

let activeOverlay: ReturnType<typeof createSubtitleOverlay> | null = null;

function markElement(el: HTMLElement): void {
  el.setAttribute(EXTENSION_MARKER, "");
}

export interface OverlayOptions {
  onWordSelect: (word: string, sentence: string) => void;
  onWordDifficult?: (word: string, sentence: string) => void;
  onCardClose?: () => void;
  /** "Copiar fala" / "Salvar fala": the same handlers as Ctrl/⌘+C and R. */
  onStudyCommand?: (command: "copy-line" | "save-line") => void;
  /** Initial values for the in-player settings panel and subtitle position. */
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onOpenLibrary: (tab?: "difficult") => void;
  /** Colour for a word on screen, or null to leave it plain. */
  getWordStatus?: (word: string) => WordStatus | null;
}

export function createSubtitleOverlay(options: OverlayOptions): {
  update: (text: string | null) => void;
  setTranslation: (sourceText: string, translation: string) => void;
  applySettings: (settings: Settings) => void;
  /** Re-reads every word's colour, e.g. after a mark changed. */
  refreshWordStatuses: () => void;
  hideCard: () => void;
  showCard: (
    content: CardContent,
    onSave: () => void | string | Promise<void | string>,
    onMark?: (mark: WordMark | null) => void | Promise<void>
  ) => void;
  showFeedback: (message: string) => void;
  askLevel: () => void;
  /** The clipboard refused: show the line in a selectable field for a normal copy. */
  showCopyFallback: (text: string) => void;
  destroy: () => void;
} {
  // Destroy previous overlay if one exists (only one instance allowed)
  if (activeOverlay) {
    activeOverlay.destroy();
    activeOverlay = null;
  }

  ensureStyles();
  let currentSentence = "";

  const overlay = document.createElement("div");
  overlay.className = "sf-overlay sf-hidden";
  markElement(overlay);

  // Original line (clickable words) on top, translated line underneath.
  const sourceLine = document.createElement("div");
  sourceLine.className = "sf-line-source";
  const targetLine = document.createElement("div");
  targetLine.className = "sf-line-target";
  overlay.appendChild(sourceLine);
  overlay.appendChild(targetLine);

  document.body.appendChild(overlay);

  const card = document.createElement("div");
  card.className = "sf-card sf-hidden";
  markElement(card);
  document.body.appendChild(card);
  const wordCard = createWordCard(card, options.onCardClose);
  const renderer = createWordRenderer(sourceLine, { status: word => options.getWordStatus?.(word) ?? null, select: options.onWordSelect, difficult: options.onWordDifficult });
  const feedback = document.createElement("div");
  feedback.className = "sf-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  markElement(feedback);
  document.body.appendChild(feedback);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  // Clipboard fallback: the line in a read-only field the user copies normally.
  const copyBox = document.createElement("div");
  copyBox.className = "sf-copy sf-hidden";
  copyBox.setAttribute("role", "dialog");
  copyBox.setAttribute("aria-label", "Copiar fala");
  markElement(copyBox);
  copyBox.innerHTML = `
    <div class="sf-copy-hint">Não foi possível copiar automaticamente. Pressione Ctrl+C (⌘C no Mac) para copiar a fala.</div>
    <textarea class="sf-copy-text" readonly rows="3"></textarea>
    <button type="button" class="sf-panel-btn" data-sf="copy-close">Fechar</button>
  `;
  document.body.appendChild(copyBox);
  const copyText = copyBox.querySelector<HTMLTextAreaElement>(".sf-copy-text")!;
  const hideCopyBox = (): void => copyBox.classList.add("sf-hidden");
  copyBox.querySelector('[data-sf="copy-close"]')?.addEventListener("click", hideCopyBox);

  const panel = document.createElement("div");
  panel.className = "sf-panel sf-hidden";
  markElement(panel);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Painel do StreamFluent");
  panel.innerHTML = PANEL_HTML;
  document.body.appendChild(panel);
  const panelView = bindPanel(panel, () => panel.classList.add("sf-hidden"));

  const translationInput = panel.querySelector<HTMLInputElement>('[data-sf="translation"]');
  const directionSelect = panel.querySelector<HTMLSelectElement>('[data-sf="direction"]');
  const levelSelect = panel.querySelector<HTMLSelectElement>('[data-sf="level"]');
  let chosenLevel = options.settings.level;
  levelSelect?.addEventListener("change", () => {
    const level = isCefrLevel(levelSelect.value) ? levelSelect.value : null;
    // The first level chosen also turns the lilac on; later changes leave the switch alone.
    options.onSettingsChange({ level, ...(level && !chosenLevel ? { highlightSpecialWords: true } : {}) });
  });

  // Asked once, on screen: one click sets the level and turns the lilac on.
  const levelPrompt = document.createElement("div");
  levelPrompt.className = "sf-level-prompt sf-hidden";
  levelPrompt.setAttribute("role", "dialog");
  levelPrompt.setAttribute("aria-label", "Seu nível de inglês");
  markElement(levelPrompt);
  levelPrompt.innerHTML = `
    <div class="sf-level-title">Qual é o seu nível de inglês?</div>
    <div class="sf-level-hint">As palavras acima do seu nível ficam em lilás. Dá para mudar depois no painel ou no popup.</div>
    <div class="sf-level-options">${CEFR_LEVELS.map((level) => `<button type="button" data-level="${level}">${LEVEL_LABELS[level]}</button>`).join("")}</div>
    <button type="button" class="sf-level-later" data-sf="level-later">Agora não</button>
  `;
  document.body.appendChild(levelPrompt);
  const hideLevelPrompt = (): void => levelPrompt.classList.add("sf-hidden");
  levelPrompt.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((button) => {
    button.addEventListener("click", () => {
      hideLevelPrompt();
      options.onSettingsChange({ level: button.dataset.level as (typeof CEFR_LEVELS)[number], highlightSpecialWords: true });
    });
  });
  levelPrompt.querySelector('[data-sf="level-later"]')?.addEventListener("click", hideLevelPrompt);
  const newWordsInput = panel.querySelector<HTMLInputElement>('[data-sf="new-words"]');

  const specialInput = panel.querySelector<HTMLInputElement>('[data-sf="special-words"]');
  const autoPauseInput = panel.querySelector<HTMLInputElement>('[data-sf="auto-pause"]');
  specialInput?.addEventListener("change", () => options.onSettingsChange({ highlightSpecialWords: specialInput.checked }));
  autoPauseInput?.addEventListener("change", () => options.onSettingsChange({ autoPause: autoPauseInput.checked }));

  newWordsInput?.addEventListener("change", () => {
    options.onSettingsChange({ highlightNewWords: newWordsInput.checked });
  });

  translationInput?.addEventListener("change", () => {
    options.onSettingsChange({ showTranslation: translationInput.checked });
  });

  directionSelect?.addEventListener("change", () => {
    const value = directionSelect.value;
    if (isLanguageDirection(value)) options.onSettingsChange({ direction: value });
  });

  panel.querySelector('[data-sf="library"]')?.addEventListener("click", () => {
    options.onOpenLibrary();
  });

  panel.querySelector('[data-sf="difficult-library"]')?.addEventListener("click", () => options.onOpenLibrary("difficult"));

  panel.querySelector('[data-sf="copy-line"]')?.addEventListener("click", () => options.onStudyCommand?.("copy-line"));
  panel.querySelector('[data-sf="save-line"]')?.addEventListener("click", () => options.onStudyCommand?.("save-line"));

  const fab = document.createElement("button");
  fab.className = "sf-fab";
  fab.textContent = "Aa";
  fab.title = "Ajustes, cores e teclas do StreamFluent";
  markElement(fab);
  fab.setAttribute("aria-label", "Configurações do StreamFluent");
  fab.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("sf-hidden");
  });
  document.body.appendChild(fab);
  const fabFade = createIdleFade(fab, () => !panel.classList.contains("sf-hidden"));
  fabFade.attach(document);

  // In fullscreen only the fullscreen element and its descendants are drawn:
  // our roots must live inside it, or the subtitle and panel vanish. A
  // fullscreen <video> cannot host anything, and <html> itself means body.
  const roots = [overlay, card, feedback, copyBox, panel, fab, levelPrompt];
  roots.forEach(isolatePointer);
  const mountTarget = (): HTMLElement => {
    const fullscreen = document.fullscreenElement;
    if (fullscreen instanceof HTMLElement && fullscreen !== document.documentElement && !(fullscreen instanceof HTMLVideoElement)) {
      return fullscreen;
    }
    return document.body;
  };
  /** Cheap when nothing moved; also re-attaches roots a player re-render dropped. */
  const mount = (): void => {
    const target = mountTarget();
    for (const root of roots) if (root.parentNode !== target) target.appendChild(root);
  };
  const onFullscreenChange = (): void => {
    mount();
    fabFade.wake();
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      wordCard.hide();
      panel.classList.add("sf-hidden");
      hideCopyBox();
    }
    if (e.ctrlKey && e.shiftKey && e.key === "L") {
      e.preventDefault();
      options.onOpenLibrary();
    }
  };

  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!card.contains(target) && !target.classList.contains("sf-word")) {
      wordCard.hide();
      sourceLine.querySelectorAll(".sf-word.sf-selected").forEach((el) => {
        el.classList.remove("sf-selected");
      });
    }
    if (!panel.contains(target) && target !== fab) {
      panel.classList.add("sf-hidden");
    }
  };

  // ---- dragging the subtitle vertically ----
  let bottomPercent = clampSubtitleBottom(options.settings.subtitleBottom);
  let dragging = false;
  let dragMoved = false;
  let dragStartY = 0;
  let dragStartBottom = bottomPercent;

  const applyBottom = (percent: number) => {
    bottomPercent = clampSubtitleBottom(percent);
    overlay.style.bottom = `${bottomPercent}%`;
  };

  const handleDragStart = (e: MouseEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    dragMoved = false;
    dragStartY = e.clientY;
    dragStartBottom = bottomPercent;
  };

  const handleDragMove = (e: MouseEvent) => {
    if (!dragging) return;
    const dy = e.clientY - dragStartY;
    // A few pixels of slack, otherwise every word click registers as a drag.
    if (!dragMoved && Math.abs(dy) < 4) return;

    dragMoved = true;
    overlay.classList.add("sf-dragging");
    e.preventDefault();
    applyBottom(dragStartBottom - (dy / window.innerHeight) * 100);
  };

  const handleDragEnd = () => {
    if (!dragging) return;
    dragging = false;
    overlay.classList.remove("sf-dragging");
    if (dragMoved) options.onSettingsChange({ subtitleBottom: bottomPercent });
  };

  // The click that closes a drag must not also count as picking a word.
  const swallowClickAfterDrag = (e: MouseEvent) => {
    if (!dragMoved) return;
    dragMoved = false;
    e.stopPropagation();
    e.preventDefault();
  };

  overlay.addEventListener("mousedown", handleDragStart);
  overlay.addEventListener("click", swallowClickAfterDrag, true);
  // On document, so a fast drag that outruns the cursor still tracks.
  document.addEventListener("mousemove", handleDragMove);
  document.addEventListener("mouseup", handleDragEnd);

  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("click", handleClick);

  const instance = {
    update(text: string | null): void {
      mount();
      renderer.update("");
      // The old line's translation must go immediately: leaving it up while the
      // next one is in flight pairs the wrong translation with the new subtitle.
      targetLine.textContent = "";

      if (!text) {
        overlay.classList.add("sf-hidden");
        currentSentence = "";
        return;
      }

      currentSentence = text;
      overlay.classList.remove("sf-hidden");

      renderer.update(text);
    },

    /**
     * Translations arrive asynchronously, so a slow one can land after the
     * subtitle already changed: only apply it if it belongs to the line on screen.
     */
    setTranslation(sourceText: string, translation: string): void {
      // An empty currentSentence means nothing is on screen, so no translation
      // can belong to it — without the first check, "" would match "".
      if (!sourceText || sourceText !== currentSentence) return;
      targetLine.textContent = translation;
    },

    refreshWordStatuses(): void {
      renderer.refresh();
    },

    applySettings(settings: Settings): void {
      if (translationInput) translationInput.checked = settings.showTranslation;
      if (newWordsInput) newWordsInput.checked = settings.highlightNewWords;
      if (specialInput) specialInput.checked = settings.highlightSpecialWords;
      if (autoPauseInput) autoPauseInput.checked = settings.autoPause;
      if (directionSelect) directionSelect.value = settings.direction;
      if (levelSelect) levelSelect.value = settings.level ?? "";
      chosenLevel = settings.level;
      if (settings.level) hideLevelPrompt();
      panelView.apply(settings);
      // Turning it off should take effect now, not at the next subtitle.
      if (!settings.showTranslation) targetLine.textContent = "";
      // Skip while dragging: the change we just saved would fight the cursor.
      if (!dragging) applyBottom(settings.subtitleBottom);
    },

    hideCard(): void {
      wordCard.hide();
    },

    showCard(content: CardContent, onSave: () => void | string | Promise<void | string>, onMark?: (mark: WordMark | null) => void | Promise<void>): void {
      wordCard.show(content, onSave, onMark);
      // Placed after the content is in, so its real height decides above or below.
      const rect = sourceLine.querySelector(".sf-word.sf-selected")?.getBoundingClientRect();
      placeCard(card, rect, { width: window.innerWidth, height: window.innerHeight });
    },
    /** Shows the level question; it closes itself once a level is chosen. */
    askLevel(): void {
      levelPrompt.classList.remove("sf-hidden");
    },

    showFeedback(message: string): void {
      feedback.textContent = message;
      clearTimeout(feedbackTimer);
      // Discreet: gone after a moment, replaced sooner by the next message.
      feedbackTimer = setTimeout(() => { feedback.textContent = ""; }, FEEDBACK_MS);
    },

    showCopyFallback(text: string): void {
      copyText.value = text;
      copyBox.classList.remove("sf-hidden");
      // The user asked to copy: focusing the field is what makes Ctrl+C work.
      copyText.focus();
      copyText.select();
    },

    destroy(): void {
      clearTimeout(feedbackTimer);
      fabFade.destroy();
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      renderer.destroy();
      wordCard.hide();
      feedback.remove();
      copyBox.remove();
      levelPrompt.remove();
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("mousemove", handleDragMove);
      document.removeEventListener("mouseup", handleDragEnd);
      overlay.remove();
      card.remove();
      fab.remove();
      panel.remove();

      if (activeOverlay === instance) {
        activeOverlay = null;
      }
    },
  };

  instance.applySettings(options.settings);

  activeOverlay = instance;
  return instance;
}
