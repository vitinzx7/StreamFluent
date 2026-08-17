const STYLE_ID = "streamfluent-overlay";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .sf-overlay {
      position: fixed;
      bottom: 12%;
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
    .sf-card-word {
      font-size: 18px;
      font-weight: 600;
      color: #00d4aa;
      margin-bottom: 6px;
    }
    .sf-card-translation {
      font-size: 14px;
      color: #ccc;
      margin-bottom: 10px;
    }
    .sf-card-sentence {
      font-size: 13px;
      color: #999;
      border-top: 1px solid rgba(255,255,255,0.1);
      padding-top: 8px;
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

export function createSubtitleOverlay(
  wordSelectCb: (word: string, sentence: string) => void
): {
  update: (text: string | null) => void;
  hideCard: () => void;
  showCard: (
    word: string,
    translation: string,
    sentence: string,
    onSave: () => void
  ) => void;
  destroy: () => void;
} {
  ensureStyles();
  onWordSelect = wordSelectCb;

  const overlay = document.createElement("div");
  overlay.className = "sf-overlay sf-hidden";
  document.body.appendChild(overlay);

  const card = document.createElement("div");
  card.className = "sf-card sf-hidden";
  document.body.appendChild(card);

  const fab = document.createElement("button");
  fab.className = "sf-fab sf-hidden";
  fab.textContent = "Aa";
  fab.title = "Open My Phrases (Ctrl+Shift+L)";
  fab.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
  });
  document.body.appendChild(fab);

  let subtitleActive = false;
  const updateFabVisibility = () => {
    fab.classList.toggle("sf-hidden", !subtitleActive);
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      card.classList.add("sf-hidden");
    }
    if (e.ctrlKey && e.shiftKey && e.key === "L") {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
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
  };

  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("click", handleClick);

  return {
    update(text: string | null): void {
      if (!text) {
        overlay.classList.add("sf-hidden");
        overlay.innerHTML = "";
        currentSentence = "";
        subtitleActive = false;
        updateFabVisibility();
        return;
      }

      currentSentence = text;
      overlay.classList.remove("sf-hidden");
      overlay.innerHTML = "";
      subtitleActive = true;
      updateFabVisibility();

      const words = text.split(/\s+/);
      for (const w of words) {
        const span = document.createElement("span");
        span.className = "sf-word";
        span.textContent = w;
        span.addEventListener("click", (e) => {
          e.stopPropagation();
          handleWordClick(w);
        });
        overlay.appendChild(span);
        overlay.appendChild(document.createTextNode(" "));
      }
    },

    hideCard(): void {
      card.classList.add("sf-hidden");
    },

    showCard(
      word: string,
      translation: string,
      sentence: string,
      onSave: () => void
    ): void {
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

      const isLoading = translation === "Loading...";
      const isError = translation.startsWith("Failed") || translation === "No definition found.";

      card.innerHTML = `
        <div class="sf-card-word">${escapeHtml(word)}</div>
        <div class="sf-card-translation">
          ${isLoading ? '<span class="sf-loading"></span>' : ""}
          ${escapeHtml(translation || "No definition found.")}
        </div>
        <div class="sf-card-sentence">"${escapeHtml(sentence)}"</div>
        <button class="sf-card-btn${isError ? " sf-error" : ""}" id="sf-save-btn">
          ${isLoading ? "Loading..." : isError ? "Error" : "Save Phrase"}
        </button>
      `;

      if (!isLoading) {
        document.getElementById("sf-save-btn")?.addEventListener("click", (e) => {
          e.stopPropagation();
          onSave();
          const btn = document.getElementById("sf-save-btn");
          if (btn) {
            btn.textContent = "Saved!";
            btn.classList.add("sf-saved");
          }
        });
      }
    },

    destroy(): void {
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("click", handleClick);
      overlay.remove();
      card.remove();
      fab.remove();
      onWordSelect = null;
    },
  };
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
