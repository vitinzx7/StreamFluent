import { createWordRenderer, WORD_STYLES } from "./word-renderer.ts";
import { createWordCard, CARD_STYLES, type CardContent } from "./word-card.ts";
export type { CardContent } from "./word-card.ts";
import { EXTENSION_MARKER } from "../dom-utils.ts";
import {
  clampSubtitleBottom,
  DIRECTION_LABELS,
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
  style.textContent = WORD_STYLES + CARD_STYLES + `
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
    .sf-panel {
      position: fixed;
      bottom: 68px;
      right: 20px;
      z-index: 100001;
      width: 232px;
      padding: 14px;
      border-radius: 10px;
      background: #1a1a2e;
      border: 1px solid rgba(0, 212, 170, 0.3);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #e0e0e0;
      font-size: 13px;
    }
    .sf-panel.sf-hidden {
      display: none;
    }
    .sf-panel-title {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #00d4aa;
      margin-bottom: 12px;
    }
    .sf-panel-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
      cursor: pointer;
    }
    .sf-panel-row input[type="checkbox"] {
      width: 15px;
      height: 15px;
      accent-color: #00d4aa;
      cursor: pointer;
      flex: none;
    }
    .sf-panel-row select {
      flex: 1;
      min-width: 0;
      padding: 5px 6px;
      border: 1px solid #2a3a5c;
      border-radius: 5px;
      background: #16213e;
      color: #e0e0e0;
      font-size: 12px;
      cursor: pointer;
    }
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
    .sf-panel-legend {
      display: flex;
      gap: 12px;
      font-size: 12px;
      font-weight: 700;
      margin: 2px 0 4px;
    }
    .sf-panel-hint {
      font-size: 11px;
      color: #8a94a6;
      margin-top: 10px;
      line-height: 1.4;
    }
    .sf-panel-actions {
      display: flex;
      gap: 6px;
    }
    .sf-panel-actions .sf-panel-btn {
      margin-top: 8px;
    }
    .sf-feedback {
      position: fixed;
      bottom: 22px;
      left: 20px;
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
    .sf-word:hover {
      background: rgba(0, 212, 170, 0.35);
      transform: translateY(-1px);
    }
    .sf-word.sf-selected {
      background: rgba(0, 212, 170, 0.6);
    }
    .sf-card {
      position: fixed;
      z-index: 100000;
      background: #1a1a2e;
      border: 1px solid rgba(0, 212, 170, 0.3);
      border-radius: 10px;
      padding: 14px 18px;
      min-width: 220px;
      max-width: 360px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #e0e0e0;
    }
    .sf-card.sf-hidden {
      display: none;
    }
    .sf-card-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }
    .sf-card-word {
      font-size: 18px;
      font-weight: 600;
      color: #00d4aa;
    }
    .sf-card-dir {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.4px;
      color: #6d7a86;
      white-space: nowrap;
    }
    .sf-card-translation {
      font-size: 16px;
      color: #f0f0f0;
      margin-bottom: 8px;
    }
    .sf-card-definition {
      font-size: 13px;
      color: #999;
      margin-bottom: 10px;
      line-height: 1.45;
    }
    .sf-card-sentence {
      font-size: 13px;
      color: #999;
      border-top: 1px solid rgba(255,255,255,0.1);
      padding-top: 8px;
      margin-bottom: 4px;
    }
    .sf-card-sentence-translation {
      font-size: 13px;
      color: #7ee8d0;
      margin-bottom: 10px;
    }
    .sf-card-btn {
      display: inline-block;
      padding: 6px 14px;
      border: none;
      border-radius: 6px;
      background: #00d4aa;
      color: #1a1a2e;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .sf-card-btn:hover {
      opacity: 0.85;
    }
    .sf-card-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .sf-card-mark {
      padding: 6px 10px;
      border: 1px solid currentColor;
      border-radius: 6px;
      background: transparent;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .sf-card-mark.sf-mark-difficult { color: #FF8A80; }
    .sf-card-mark.sf-mark-learned { color: #81C784; }
    .sf-card-mark.sf-active {
      background: currentColor;
    }
    .sf-card-mark.sf-active span {
      color: #1a1a2e;
    }
    .sf-card-btn.sf-saved {
      background: #555;
      color: #999;
      cursor: default;
    }
    .sf-card-btn.sf-error {
      background: #e74c3c;
      color: #fff;
    }
    .sf-fab {
      position: fixed;
      bottom: 20px;
      right: 20px;
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
      transform: scale(1.1);
    }
    .sf-fab.sf-hidden {
      display: none;
    }
    .sf-loading {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid #555;
      border-top-color: #00d4aa;
      border-radius: 50%;
      animation: sf-spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes sf-spin {
      to { transform: rotate(360deg); }
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
  panel.innerHTML = `
    <div class="sf-panel-title">StreamFluent</div>
    <label class="sf-panel-row">
      <span>Translated line</span>
      <input type="checkbox" data-sf="translation" />
    </label>
    <label class="sf-panel-row">
      <span>Colour new words</span>
      <input type="checkbox" data-sf="new-words" />
    </label>
    <label class="sf-panel-row"><span>Destacar palavras especiais (inglês)</span><input type="checkbox" data-sf="special-words" /></label>
    <label class="sf-panel-row"><span>Pausa automática</span><input type="checkbox" data-sf="auto-pause" /></label>
    <div class="sf-panel-legend">
      <span class="sf-legend-new">Nova</span>
      <span class="sf-legend-difficult">Difícil</span>
      <span class="sf-legend-learned">Aprendida</span>
      <span class="sf-legend-special">Especial</span>
    </div>
    <label class="sf-panel-row">
      <select data-sf="direction">
        <option value="en-pt">${DIRECTION_LABELS["en-pt"]}</option>
        <option value="pt-en">${DIRECTION_LABELS["pt-en"]}</option>
      </select>
    </label>
    <div class="sf-panel-actions">
      <button class="sf-panel-btn" data-sf="copy-line">Copiar fala</button>
      <button class="sf-panel-btn" data-sf="save-line">Salvar fala</button>
    </div>
    <button class="sf-panel-btn" data-sf="library">Frases salvas</button>
    <button class="sf-panel-btn" data-sf="difficult-library">Palavras difíceis</button>
    <div class="sf-panel-hint">
      A: fala anterior · S: repetir fala · D: avançar 5 s · Espaço: reproduzir/pausar ·
      Q: pausa automática · R: salvar fala · Ctrl/⌘+C: copiar fala.
      Clique numa palavra para consultar; botão direito marca como difícil.
      Arraste a legenda para cima ou para baixo para movê-la.
    </div>
  `;
  document.body.appendChild(panel);

  const translationInput = panel.querySelector<HTMLInputElement>('[data-sf="translation"]');
  const directionSelect = panel.querySelector<HTMLSelectElement>('[data-sf="direction"]');
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
  fab.title = "StreamFluent settings";
  markElement(fab);
  fab.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("sf-hidden");
  });
  document.body.appendChild(fab);

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
      // Turning it off should take effect now, not at the next subtitle.
      if (!settings.showTranslation) targetLine.textContent = "";
      // Skip while dragging: the change we just saved would fight the cursor.
      if (!dragging) applyBottom(settings.subtitleBottom);
    },

    hideCard(): void {
      wordCard.hide();
    },

    showCard(content: CardContent, onSave: () => void | string | Promise<void | string>, onMark?: (mark: WordMark | null) => void | Promise<void>): void {
      const wordEl = sourceLine.querySelector(".sf-word.sf-selected");
      const rect = wordEl?.getBoundingClientRect();
      card.style.left = rect ? `${Math.max(8, Math.min(rect.left, window.innerWidth - 370))}px` : "50%";
      card.style.top = rect ? `${Math.max(8, rect.top - 200)}px` : "30%";
      card.style.transform = rect ? "" : "translateX(-50%)";
      wordCard.show(content, onSave, onMark);
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
      renderer.destroy();
      wordCard.hide();
      feedback.remove();
      copyBox.remove();
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
