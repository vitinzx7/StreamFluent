import { CEFR_LEVELS, LEVEL_LABELS } from "../cefr.ts";
import type { StudyCommand } from "../keyboard-shortcuts.ts";
import type { Settings } from "../settings.ts";

/**
 * The in-player panel behind the Aa button: three tabs (settings, colour map,
 * key map) written for someone who never read the docs. Only markup, styles
 * and the parts that follow the settings live here; subtitle-overlay.ts wires
 * the controls by their data-sf attributes.
 */

/** One key of the keyboard map. Keys without a command are drawn faded, for orientation. */
export interface MappedKey {
  key: string;
  cap: string;
  label?: string;
  command?: StudyCommand;
}

/** Laid out like the keyboard itself, so the letters are found by position. */
export const KEYBOARD_MAP: MappedKey[][] = [
  [
    { key: "q", cap: "Q", label: "Pausa automática", command: "auto-pause" },
    { key: "w", cap: "W" },
    { key: "e", cap: "E" },
    { key: "r", cap: "R", label: "Salvar fala", command: "save-line" },
  ],
  [
    { key: "a", cap: "A", label: "Fala anterior", command: "previous" },
    { key: "s", cap: "S", label: "Repetir fala", command: "repeat" },
    { key: "d", cap: "D", label: "Avançar 5\u00a0s", command: "forward" },
  ],
  [{ key: " ", cap: "Espaço", label: "Reproduzir / pausar", command: "toggle" }],
];

const kbd = (...keys: string[]): string => keys.map((key) => `<span class="sf-kbd">${key}</span>`).join(" + ");

const mouse = (action: string): string => `<span class="sf-mouse">${action}</span>`;

/** What it does on the left, the key on the right, like a cheat sheet. */
const keyItem = (action: string, keys: string, help = ""): string => `
  <div class="sf-key-item">
    <span><span class="sf-key-action">${action}</span>${help ? `<span class="sf-option-help">${help}</span>` : ""}</span>
    <span class="sf-key-combo">${keys}</span>
  </div>`;

const keyCap = ({ key, cap, label, command }: MappedKey): string => command
  ? `<div class="sf-key${key === " " ? " sf-key-space" : ""}" data-key="${key}" data-command="${command}"><span class="sf-key-cap">${cap}</span><span class="sf-key-label">${label}</span></div>`
  : `<div class="sf-key sf-key-unused" aria-hidden="true"><span class="sf-key-cap">${cap}</span></div>`;

/** The colours of section 2.3 in the order a beginner meets them; values match WORD_STYLES. */
const COLOR_MAP = [
  { color: "normal", sample: "palavra", name: "Branca: normal", detail: "Sem destaque. Você já viu essa palavra antes." },
  { color: "new", sample: "palavra", name: "Azul: nova", detail: "É a primeira vez que ela aparece para você.", toggle: "new-words", toggleLabel: "Pintar palavras novas de azul" },
  { color: "special", sample: "palavra", name: "Lilás: acima do seu nível", detail: "", toggle: "special-words", toggleLabel: "Pintar de lilás as palavras acima do meu nível" },
  { color: "difficult", sample: "palavra", name: "Vermelha: difícil", detail: "Você marcou: botão direito na palavra, ou Difícil no cartão." },
  { color: "learned", sample: "palavra", name: "Verde: aprendida", detail: "Você marcou Aprendida no cartão da palavra." },
  { color: "translation", sample: "tradução", name: "Verde-água: tradução", detail: "A fala traduzida, na linha de baixo da legenda." },
];

const colorRow = ({ color, sample, name, detail, toggle, toggleLabel }: (typeof COLOR_MAP)[number]): string => {
  const inner = `
    <span class="sf-chip sf-legend-${color}">${sample}</span>
    <span class="sf-color-text">
      <span class="sf-option-name">${name}</span>
      <span class="sf-option-help"${color === "special" ? ' data-sf="special-detail"' : ""}>${detail}</span>
    </span>`;
  return toggle
    ? `<label class="sf-color-row" data-color="${color}">${inner}<input type="checkbox" class="sf-switch" role="switch" data-sf="${toggle}" aria-label="${toggleLabel}" /></label>`
    : `<div class="sf-color-row" data-color="${color}">${inner}</div>`;
};

const TABS = [
  { id: "settings", label: "Ajustes" },
  { id: "colors", label: "Cores" },
  { id: "keys", label: "Teclas" },
];

export const PANEL_HTML = `
  <div class="sf-panel-head">
    <div class="sf-panel-title">StreamFluent</div>
    <button type="button" class="sf-panel-close" data-sf="panel-close" aria-label="Fechar painel">×</button>
  </div>
  <div class="sf-tabs" role="tablist" aria-label="Painel do StreamFluent">
    ${TABS.map(({ id, label }, index) => `<button type="button" class="sf-tab" role="tab" id="sf-tab-${id}" data-tab="${id}" aria-controls="sf-tabpanel-${id}" aria-selected="${index === 0}">${label}</button>`).join("")}
  </div>

  <div class="sf-tabpanel" role="tabpanel" id="sf-tabpanel-settings" data-tabpanel="settings" aria-labelledby="sf-tab-settings">
    <div class="sf-section">
      <div class="sf-section-title">Legenda</div>
      <label class="sf-option">
        <span><span class="sf-option-name">Mostrar a tradução</span><span class="sf-option-help">A fala traduzida aparece embaixo da legenda.</span></span>
        <input type="checkbox" class="sf-switch" role="switch" data-sf="translation" />
      </label>
      <label class="sf-field">
        <span class="sf-option-name">Idioma da legenda</span>
        <select data-sf="direction">
          <option value="en-pt">Inglês (traduzir para português)</option>
          <option value="pt-en">Português (traduzir para inglês)</option>
        </select>
      </label>
    </div>
    <div class="sf-section">
      <div class="sf-section-title">Meu nível de inglês</div>
      <select data-sf="level" aria-label="Meu nível de inglês"><option value="">Escolher…</option>${CEFR_LEVELS.map((level) => `<option value="${level}">${LEVEL_LABELS[level]}</option>`).join("")}</select>
      <span class="sf-option-help sf-field-help">As palavras acima do seu nível ficam <span class="sf-legend-special">lilás</span>.</span>
    </div>
    <div class="sf-section">
      <div class="sf-section-title">Pausa automática</div>
      <label class="sf-option">
        <span><span class="sf-option-name">Pausar no fim de cada fala</span><span class="sf-option-help">Dá tempo de ler. Atalho: tecla Q.</span></span>
        <input type="checkbox" class="sf-switch" role="switch" data-sf="auto-pause" />
      </label>
    </div>
    <div class="sf-section">
      <div class="sf-section-title">Fala na tela</div>
      <div class="sf-panel-actions">
        <button type="button" class="sf-panel-btn" data-sf="copy-line">Copiar fala<span class="sf-btn-keys">${kbd("Ctrl", "C")}</span></button>
        <button type="button" class="sf-panel-btn" data-sf="save-line">Salvar fala<span class="sf-btn-keys">${kbd("R")}</span></button>
      </div>
    </div>
    <div class="sf-section">
      <div class="sf-section-title">Minha biblioteca</div>
      <div class="sf-panel-actions">
        <button type="button" class="sf-panel-btn" data-sf="library">Frases salvas</button>
        <button type="button" class="sf-panel-btn" data-sf="difficult-library">Palavras difíceis</button>
      </div>
    </div>
  </div>

  <div class="sf-tabpanel" role="tabpanel" id="sf-tabpanel-colors" data-tabpanel="colors" aria-labelledby="sf-tab-colors" hidden>
    <div class="sf-section">
      <div class="sf-section-title">O que cada cor quer dizer</div>
      ${COLOR_MAP.map(colorRow).join("")}
    </div>
    <div class="sf-panel-hint">Clique numa palavra para ver a tradução e marcar como Difícil ou Aprendida. A sua marcação (vermelha ou verde) vale mais que as outras cores.</div>
  </div>

  <div class="sf-tabpanel" role="tabpanel" id="sf-tabpanel-keys" data-tabpanel="keys" aria-labelledby="sf-tab-keys" hidden>
    <div class="sf-section">
      <div class="sf-section-title">Teclas do vídeo</div>
      <div class="sf-keyboard">${KEYBOARD_MAP.map((row) => `<div class="sf-key-row">${row.map(keyCap).join("")}</div>`).join("")}</div>
    </div>
    <div class="sf-section">
      <div class="sf-section-title">Outras teclas</div>
      ${keyItem("Copiar a fala", kbd("Ctrl", "C"), `No Mac: ${kbd("⌘", "C")}`)}
      ${keyItem("Abrir as frases salvas", kbd("Ctrl", "Shift", "L"))}
      ${keyItem("Fechar o painel e o cartão", kbd("Esc"))}
    </div>
    <div class="sf-section">
      <div class="sf-section-title">Com o mouse</div>
      ${keyItem("Ver tradução e significado", mouse("Clique na palavra"))}
      ${keyItem("Marcar como difícil", mouse("Botão direito na palavra"))}
      ${keyItem("Subir ou descer a legenda", mouse("Arraste a legenda"))}
    </div>
    <div class="sf-panel-hint">As teclas começam a valer quando a primeira legenda aparece, e não agem enquanto você digita.</div>
  </div>
`;

/** Neutral greys over the video; the subtitle colours keep their own values. */
export const PANEL_STYLES = `
  .sf-panel {
    position: fixed;
    top: 50%;
    right: 68px;
    transform: translateY(-50%);
    max-height: calc(100vh - 32px);
    overflow: auto;
    z-index: 100001;
    width: 316px;
    max-width: calc(100vw - 84px);
    padding: 14px;
    border-radius: 12px;
    background: #313236;
    border: 1px solid #4b4c52;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    color: #f2f2f3;
    text-align: left;
    cursor: default;
    user-select: none;
  }
  .sf-panel *, .sf-panel *::before, .sf-panel *::after { box-sizing: border-box; }
  .sf-panel.sf-hidden, .sf-panel [hidden] { display: none !important; }
  .sf-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .sf-panel-title {
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
  }
  .sf-panel-close {
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #b4b5bb;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }
  .sf-panel-close:hover { background: #45464c; color: #ffffff; }
  .sf-tabs {
    display: flex;
    gap: 3px;
    padding: 3px;
    margin-bottom: 12px;
    border-radius: 9px;
    background: #25262a;
  }
  .sf-tab {
    flex: 1;
    padding: 7px 4px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: #b4b5bb;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .sf-tab:hover { color: #ffffff; }
  .sf-tab[aria-selected="true"] {
    background: #4a4b51;
    color: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  }
  .sf-section {
    margin-bottom: 8px;
    padding: 10px 12px;
    border-radius: 9px;
    background: #3c3d42;
  }
  .sf-tabpanel > .sf-section:last-child { margin-bottom: 0; }
  .sf-section-title {
    margin-bottom: 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: #a3a4aa;
  }
  .sf-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    cursor: pointer;
  }
  .sf-option-name {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #f2f2f3;
  }
  .sf-option-help {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    color: #b9bac0;
  }
  .sf-field { display: block; margin-top: 10px; cursor: pointer; }
  .sf-field-help { margin-top: 6px; }
  .sf-panel select {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 7px 8px;
    border: 1px solid #5a5b61;
    border-radius: 7px;
    background: #47484e;
    color: #f2f2f3;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .sf-section-title + select { margin-top: 0; }
  .sf-panel select option { background: #313236; color: #f2f2f3; }
  .sf-switch {
    -webkit-appearance: none;
    appearance: none;
    position: relative;
    flex: none;
    width: 38px;
    height: 22px;
    margin: 0;
    border-radius: 11px;
    background: #64656b;
    cursor: pointer;
    transition: background 0.15s;
  }
  .sf-switch::before {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
    transition: transform 0.15s;
  }
  .sf-switch:checked { background: #00b894; }
  .sf-switch:checked::before { transform: translateX(16px); }
  .sf-panel-actions { display: flex; gap: 6px; }
  .sf-panel .sf-panel-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: auto;
    margin: 0;
    padding: 8px 6px;
    border: 1px solid #5a5b61;
    border-radius: 7px;
    background: #47484e;
    color: #f2f2f3;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
  }
  .sf-panel .sf-panel-btn:hover { background: #56575d; }
  .sf-btn-keys { font-weight: 400; color: #b9bac0; }
  .sf-kbd {
    display: inline-block;
    min-width: 20px;
    padding: 1px 5px;
    border: 1px solid #6b6c72;
    border-bottom-width: 2px;
    border-radius: 4px;
    background: #2a2b2f;
    color: #f2f2f3;
    font: 700 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-align: center;
    white-space: nowrap;
  }
  .sf-color-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
  }
  .sf-color-row + .sf-color-row { border-top: 1px solid #4b4c51; }
  label.sf-color-row { cursor: pointer; }
  .sf-color-text { flex: 1; min-width: 0; }
  /* A strip of "video" so each colour looks the way it does on screen. */
  .sf-chip {
    flex: none;
    width: 76px;
    padding: 4px 0;
    border-radius: 6px;
    background: #111113;
    font-family: "Netflix Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 14px;
    font-weight: 700;
    text-align: center;
    text-shadow: 0 0 2px #000000;
    transition: opacity 0.15s;
  }
  .sf-color-row.sf-off .sf-chip { opacity: 0.3; }
  .sf-legend-normal { color: #ffffff; }
  .sf-legend-translation { color: #7ee8d0; }
  .sf-keyboard {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: max-content;
    margin: 0 auto;
  }
  .sf-key-row { display: flex; gap: 6px; }
  .sf-key-row:nth-child(2) { padding-left: 16px; }
  .sf-key-row:nth-child(3) { padding-left: 34px; }
  .sf-key {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 58px;
    min-height: 56px;
    padding: 5px 3px 4px;
    border: 1px solid #6b6c72;
    border-bottom-width: 3px;
    border-radius: 7px;
    background: #2a2b2f;
    text-align: center;
  }
  .sf-key-space { width: 190px; }
  .sf-key-unused { opacity: 0.3; }
  .sf-key-cap { font-size: 15px; font-weight: 800; color: #ffffff; }
  .sf-key-label {
    margin-top: 3px;
    font-size: 10px;
    line-height: 1.15;
    color: #9fe9d7;
  }
  .sf-key-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 0;
  }
  .sf-key-item + .sf-key-item { border-top: 1px solid #4b4c51; }
  .sf-key-action { display: block; font-size: 12.5px; color: #f2f2f3; }
  .sf-key-combo { flex: none; color: #b9bac0; white-space: nowrap; }
  .sf-mouse {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 10px;
    background: #2a2b2f;
    border: 1px solid #6b6c72;
    font-size: 11px;
    font-weight: 700;
    color: #f2f2f3;
    white-space: nowrap;
  }
  .sf-panel-hint {
    margin-top: 10px;
    font-size: 11.5px;
    line-height: 1.45;
    color: #b9bac0;
  }
`;

/** Tabs, the close button and the guide text that follows the settings. */
export function bindPanel(panel: HTMLElement, close: () => void): { apply(settings: Settings): void } {
  const tabs = [...panel.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  const tabPanels = [...panel.querySelectorAll<HTMLElement>("[data-tabpanel]")];
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      for (const other of tabs) other.setAttribute("aria-selected", String(other === tab));
      for (const tabPanel of tabPanels) tabPanel.hidden = tabPanel.dataset.tabpanel !== tab.dataset.tab;
    });
  }
  panel.querySelector('[data-sf="panel-close"]')?.addEventListener("click", close);

  const specialDetail = panel.querySelector<HTMLElement>('[data-sf="special-detail"]');
  const row = (color: string) => panel.querySelector<HTMLElement>(`.sf-color-row[data-color="${color}"]`);
  return {
    apply(settings: Settings): void {
      if (specialDetail) {
        specialDetail.textContent = settings.level
          ? `Mais difícil que o seu nível (${LEVEL_LABELS[settings.level]}). Só em inglês.`
          : "Escolha o seu nível na aba Ajustes. Até lá, uma lista fixa de palavras difíceis. Só em inglês.";
      }
      // A colour that is switched off is shown faded, so the map matches the screen.
      row("new")?.classList.toggle("sf-off", !settings.highlightNewWords);
      row("special")?.classList.toggle("sf-off", !settings.highlightSpecialWords);
      row("translation")?.classList.toggle("sf-off", !settings.showTranslation);
    },
  };
}
