chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const statusEl = document.getElementById("status");

  if (!tab?.url) {
    statusEl.textContent = "Unable to detect page.";
    return;
  }

  const url = new URL(tab.url);
  const host = url.hostname;

  const matches = (domain) => host === domain || host.endsWith(`.${domain}`);
  if (matches("netflix.com")) {
    statusEl.textContent = "Netflix detected. Open a video to start.";
  } else if (matches("max.com") || matches("hbomax.com")) {
    statusEl.textContent = "Max detected. Open a video to start.";
  } else if (host === "cinetaro.to" || host === "www.cinetaro.to") {
    statusEl.textContent = "Cinetaro: use o painel StreamFluent no player para importar SRT/VTT, traduzir e ajustar o tempo. Frames externos podem estar indisponíveis.";
    document.querySelectorAll(".field").forEach((field) => { field.hidden = true; });
  } else {
    statusEl.textContent = "Abra Netflix, Max ou Cinetaro para usar StreamFluent.";
  }
});

document.getElementById("openLibrary")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
});

document.getElementById("openPlayerTest")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("player-test.html") });
});

// Mirrors src/core/settings.ts - this file is plain JS, outside the TS bundle.
const SETTINGS_KEY = "settings";
const DEFAULT_DIRECTION = "en-pt";
const DIRECTIONS = ["en-pt", "pt-en"];

async function initSettings() {
  const select = document.getElementById("direction");
  const toggle = document.getElementById("showTranslation");
  const hint = document.getElementById("directionHint");
  if (!select || !toggle) return;

  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
  select.value = DIRECTIONS.includes(stored.direction) ? stored.direction : DEFAULT_DIRECTION;
  toggle.checked = stored.showTranslation !== false;

  // Merge, never replace: the object also holds the subtitle position the user
  // set by dragging it in the player, which this page has no control for.
  const persist = async () => {
    const current = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        ...current,
        direction: select.value,
        showTranslation: toggle.checked,
      },
    });
    if (hint) hint.textContent = "Saved. Applies to the next subtitle line.";
  };

  select.addEventListener("change", persist);
  toggle.addEventListener("change", persist);
}

initSettings();
