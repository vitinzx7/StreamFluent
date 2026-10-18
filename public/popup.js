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
    ["direction", "showTranslation"].forEach(id => { document.getElementById(id).closest(".field").hidden = true; });
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

// The worker patches individual fields, preserving the other preferences.
async function initSettings() {
  const select = document.getElementById("direction");
  const toggle = document.getElementById("showTranslation");
  // Same values as src/core/cefr.ts; this page is not bundled.
  const levelSelect = document.getElementById("level");
  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  let chosenLevel = null;
  const hint = document.getElementById("directionHint");
  function apply(settings) {
    select.value = settings.direction;
    toggle.checked = settings.showTranslation;
    levelSelect.value = settings.level ?? "";
    chosenLevel = settings.level ?? null;
    for (const key of ["highlightNewWords", "highlightSpecialWords", "autoPause"]) document.getElementById(key).checked = settings[key];
  }
  try { apply((await studyRequest("read")).settings); }
  catch { hint.textContent = "Não foi possível carregar. Reabra o popup para tentar novamente."; }
  async function persist(patch) {
    hint.textContent = "Salvando…";
    try {
      apply(await studyRequest("patch-settings", { patch }));
      hint.textContent = "Preferência salva.";
    } catch { hint.textContent = "Não foi possível salvar. Tente novamente."; }
  }
  for (const key of ["highlightNewWords", "highlightSpecialWords", "autoPause"]) {
    const input = document.getElementById(key);
    input.addEventListener("change", () => void persist({ [key]: input.checked }));
  }
  select.addEventListener("change", () => void persist({ direction: select.value }));
  levelSelect.addEventListener("change", () => {
    const level = LEVELS.includes(levelSelect.value) ? levelSelect.value : null;
    // The first level chosen also turns the lilac on; later changes leave the switch alone.
    void persist({ level, ...(level && !chosenLevel ? { highlightSpecialWords: true } : {}) });
  });
  toggle.addEventListener("change", () => void persist({ showTranslation: toggle.checked }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      void studyRequest("read").then(state => apply(state.settings)).catch(() => {});
    }
  });
}
void initSettings();

document.getElementById("openDifficult").addEventListener("click", () => { chrome.tabs.create({ url: chrome.runtime.getURL("library.html?tab=difficult") }); });
