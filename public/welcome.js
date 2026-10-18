/* First-run page: asks the English level. Plain JS like popup.js; the worker owns the write. */
const buttons = [...document.querySelectorAll("[data-level]")];
const highlight = document.getElementById("highlight");
const status = document.getElementById("status");

function show(level) {
  for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.level === level));
}

async function refresh() {
  try {
    const { settings } = await studyRequest("read");
    show(settings.level);
    if (settings.level) highlight.checked = settings.highlightSpecialWords;
  } catch {
    status.textContent = "Não foi possível carregar suas preferências. Recarregue a página.";
  }
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    status.textContent = "Salvando…";
    try {
      const settings = await studyRequest("patch-settings", {
        patch: { level: button.dataset.level, highlightSpecialWords: highlight.checked },
      });
      show(settings.level);
      status.textContent = `Pronto: nível ${settings.level}. Abra um episódio com legenda em inglês na Netflix.`;
    } catch {
      status.textContent = "Não foi possível salvar. Tente novamente.";
    }
  });
}

void refresh();
