import { EXTENSION_MARKER } from "../dom-utils.ts";
import {
  clampSubtitleBottom,
  DIRECTION_LABELS,
  isLanguageDirection,
  type Settings,
} from "../settings.ts";

const STYLE_ID = "streamfluent-overlay";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
    .sf-panel-hint {
      font-size: 11px;
      color: #666;
      margin-top: 10px;
      line-height: 1.4;
    }
    .sf-line-target {
      margin-top: 2px;
      color: #7ee8d0;
      font-size: 17px;
      font-weight: 500;
      text-shadow: 1px 1px 3px rgba(0,0,0,0.9);
      line-height: 1.4;
    }
    .sf-line-target:empty {
      display: none;
    }
    .sf-word {
      display: inline-block;
      padding: 2px 6px;
      margin: 0 2px;
      border-radius: 4px;
      cursor: pointer;
      color: #ffffff;
      font-size: 20px;
      font-weight: 500;
      text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
      transition: background 0.15s, transform 0.1s;
      line-height: 1.5;
    }
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

let currentSentence = "";
let onWordSelect: ((word: string, sentence: string) => void) | null = null;
let activeOverlay: ReturnType<typeof createSubtitleOverlay> | null = null;

function handleWordClick(word: string): void {
  document.querySelectorAll(".sf-word.sf-selected").forEach((el) => {
    el.classList.remove("sf-selected");
  });

  const wordEls = document.querySelectorAll(".sf-word");
  for (const el of wordEls) {
    if (el.textContent === word) {
      el.classList.add("sf-selected");
      break;
    }
  }

  onWordSelect?.(word, currentSentence);
}

function markElement(el: HTMLElement): void {
  el.setAttribute(EXTENSION_MARKER, "");
}

export interface CardContent {
  word: string;
  /** Main line: the word in the target language. */
  translation: string;
  /** Optional second line: phonetic + dictionary definition. */
  definition: string;
  sentence: string;
  /** The whole subtitle line translated, when it has already resolved. */
  sentenceTranslation: string;
  /** e.g. "EN -> PT", so it is obvious which way the lookup went. */
  directionLabel: string;
  state: "loading" | "ready" | "error";
}

export interface OverlayOptions {
  onWordSelect: (word: string, sentence: string) => void;
  /** Initial values for the in-player settings panel and subtitle position. */
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onOpenLibrary: () => void;
}

export function createSubtitleOverlay(options: OverlayOptions): {
  update: (text: string | null) => void;
  setTranslation: (sourceText: string, translation: string) => void;
  applySettings: (settings: Settings) => void;
  hideCard: () => void;
  showCard: (content: CardContent, onSave: () => void) => void;
  destroy: () => void;
} {
  // Destroy previous overlay if one exists (only one instance allowed)
  if (activeOverlay) {
    activeOverlay.destroy();
    activeOverlay = null;
  }

  ensureStyles();
  onWordSelect = options.onWordSelect;

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
      <select data-sf="direction">
        <option value="en-pt">${DIRECTION_LABELS["en-pt"]}</option>
        <option value="pt-en">${DIRECTION_LABELS["pt-en"]}</option>
      </select>
    </label>
    <button class="sf-panel-btn" data-sf="library">My Phrases</button>
    <div class="sf-panel-hint">Drag the subtitle up or down to move it.</div>
  `;
  document.body.appendChild(panel);

  const translationInput = panel.querySelector<HTMLInputElement>('[data-sf="translation"]');
  const directionSelect = panel.querySelector<HTMLSelectElement>('[data-sf="direction"]');

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
      card.classList.add("sf-hidden");
      panel.classList.add("sf-hidden");
    }
    if (e.ctrlKey && e.shiftKey && e.key === "L") {
      e.preventDefault();
      options.onOpenLibrary();
    }
  };

  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!card.contains(target) && !target.classList.contains("sf-word")) {
      card.classList.add("sf-hidden");
      document.querySelectorAll(".sf-word.sf-selected").forEach((el) => {
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
      sourceLine.innerHTML = "";
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

      const words = text.split(/\s+/);
      for (const w of words) {
        const span = document.createElement("span");
        span.className = "sf-word";
        span.textContent = w;
        span.addEventListener("click", (e) => {
          e.stopPropagation();
          handleWordClick(w);
        });
        sourceLine.appendChild(span);
        sourceLine.appendChild(document.createTextNode(" "));
      }
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

    applySettings(settings: Settings): void {
      if (translationInput) translationInput.checked = settings.showTranslation;
      if (directionSelect) directionSelect.value = settings.direction;
      // Turning it off should take effect now, not at the next subtitle.
      if (!settings.showTranslation) targetLine.textContent = "";
      // Skip while dragging: the change we just saved would fight the cursor.
      if (!dragging) applyBottom(settings.subtitleBottom);
    },

    hideCard(): void {
      card.classList.add("sf-hidden");
    },

    showCard(content: CardContent, onSave: () => void): void {
      card.classList.remove("sf-hidden");

      const wordEl = document.querySelector(".sf-word.sf-selected");
      if (wordEl) {
        const rect = wordEl.getBoundingClientRect();
        card.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 370))}px`;
        card.style.top = `${Math.max(8, rect.top - 160)}px`;
        card.style.transform = "";
      } else {
        card.style.left = "50%";
        card.style.top = "30%";
        card.style.transform = "translateX(-50%)";
      }

      const isLoading = content.state === "loading";
      const isError = content.state === "error";
      const mainLine = isLoading
        ? "Translating..."
        : content.translation || "Translation unavailable.";

      card.innerHTML = `
        <div class="sf-card-head">
          <span class="sf-card-word">${escapeHtml(content.word)}</span>
          <span class="sf-card-dir">${escapeHtml(content.directionLabel)}</span>
        </div>
        <div class="sf-card-translation">
          ${isLoading ? '<span class="sf-loading"></span>' : ""}
          ${escapeHtml(mainLine)}
        </div>
        ${
          content.definition
            ? `<div class="sf-card-definition">${escapeHtml(content.definition)}</div>`
            : ""
        }
        <div class="sf-card-sentence">"${escapeHtml(content.sentence)}"</div>
        ${
          content.sentenceTranslation
            ? `<div class="sf-card-sentence-translation">"${escapeHtml(
                content.sentenceTranslation
              )}"</div>`
            : ""
        }
        <button class="sf-card-btn${isError ? " sf-error" : ""}">
          ${isLoading ? "Loading..." : isError ? "Error" : "Save Phrase"}
        </button>
      `;

      if (!isLoading) {
        const btn = card.querySelector<HTMLButtonElement>(".sf-card-btn");
        btn?.addEventListener("click", (e) => {
          e.stopPropagation();
          onSave();
          btn.textContent = "Saved!";
          btn.classList.add("sf-saved");
        });
      }
    },

    destroy(): void {
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("mousemove", handleDragMove);
      document.removeEventListener("mouseup", handleDragEnd);
      overlay.remove();
      card.remove();
      fab.remove();
      panel.remove();
      onWordSelect = null;
      if (activeOverlay === instance) {
        activeOverlay = null;
      }
    },
  };

  instance.applySettings(options.settings);

  activeOverlay = instance;
  return instance;
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
