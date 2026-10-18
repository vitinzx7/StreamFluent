import type { WordMark } from "../vocabulary.ts";
export interface CardContent {
  word: string; translation: string; definition: string; sentence: string; sentenceTranslation: string;
  directionLabel: string; state: "loading" | "ready" | "error"; mark?: WordMark | null;
  /** A new click supplies a new identity; translation updates reuse it. */
  identity?: string;
  /** Dictionary sites for this word, opened in a new tab only when clicked. */
  links?: Array<{ label: string; url: string }>;
}
/**
 * Compact and grey like the in-player panel. The line itself is not repeated:
 * it is on screen right under the card. Each host adds position and z-index.
 */
export const CARD_STYLES = `
.sf-card { box-sizing:border-box; width:280px; max-width:calc(100vw - 16px); padding:10px 12px 9px; pointer-events:auto; background:#313236; color:#f2f2f3; border:1px solid #4b4c52; border-radius:10px; box-shadow:0 8px 28px #0008; font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; text-align:left; white-space:normal; user-select:text; cursor:auto; }
.sf-card.sf-hidden { display:none; }
.sf-card::after { content:""; position:absolute; left:var(--sf-tip,50%); bottom:-6px; width:10px; height:10px; background:#313236; border:solid #4b4c52; border-width:0 1px 1px 0; transform:translateX(-50%) rotate(45deg); }
.sf-card.sf-card-below::after { bottom:auto; top:-6px; border-width:1px 0 0 1px; }
.sf-card.sf-card-free::after { display:none; }
.sf-card-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.sf-card-word { font-size:17px; font-weight:700; color:#fff; overflow-wrap:anywhere; }
.sf-card .sf-card-close { flex:none; width:22px; height:22px; margin:-2px -4px 0 0; padding:0; border:none; border-radius:50%; background:transparent; color:#b9bac0; font-size:17px; line-height:1; }
.sf-card .sf-card-close:hover { background:#45464c; color:#fff; }
.sf-card-translation { margin-top:1px; font-size:15px; font-weight:600; color:#7ee8d0; }
.sf-card-translation.sf-card-pending { font-weight:400; color:#b9bac0; }
.sf-card-definition { margin-top:4px; font-size:12px; color:#b9bac0; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.sf-card-definition:empty { display:none; }
.sf-card-actions { display:flex; align-items:center; gap:6px; margin-top:9px; }
.sf-card button { box-sizing:border-box; margin:0; padding:4px 9px; border:1px solid #5a5b61; border-radius:14px; background:#3c3d42; color:#f2f2f3; font-family:inherit; font-size:12px; font-weight:600; line-height:1.3; cursor:pointer; }
.sf-card button:hover { background:#47484e; }
.sf-card button:disabled { opacity:.6; cursor:default; }
.sf-card .sf-mark-difficult { --sf-mark:#FF8A80; } .sf-card .sf-mark-learned { --sf-mark:#81C784; }
.sf-card .sf-card-mark::before { content:""; display:inline-block; width:7px; height:7px; margin-right:5px; border-radius:50%; background:var(--sf-mark); vertical-align:1px; }
.sf-card .sf-card-mark.sf-active { background:var(--sf-mark); border-color:var(--sf-mark); color:#1d1d1f; }
.sf-card .sf-card-mark.sf-active::before { content:"✓"; width:auto; height:auto; border-radius:0; background:none; vertical-align:0; }
.sf-card .sf-card-btn { margin-left:auto; }
.sf-card-feedback { margin-top:6px; font-size:11.5px; color:#b9bac0; } .sf-card-feedback:empty { display:none; }
.sf-card-links { display:flex; flex-wrap:wrap; gap:2px 10px; margin-top:8px; padding-top:7px; border-top:1px solid #45464c; font-size:11px; color:#8e8f96; } .sf-card-links:empty { display:none; }
.sf-card-links a { color:#b9bac0; text-decoration:none; } .sf-card-links a:hover { color:#fff; text-decoration:underline; }
`;
const GAP = 10;
const MARGIN = 8;
/**
 * Puts the card just above the clicked word, centred on it with its tip on
 * the word, and below it only when there is no room above. Anchored by its
 * bottom edge, so a translation arriving later grows it upwards, away from
 * the word. `rightReserve` keeps it clear of the settings button's strip.
 */
export function placeCard(card: HTMLElement, word: DOMRect | undefined, view: { width: number; height: number }, rightReserve = 64): void {
  const style = card.style;
  card.classList.toggle("sf-card-free", !word);
  if (!word) {
    Object.assign(style, { left: "50%", top: "20%", bottom: "auto", transform: "translateX(-50%)" });
    return;
  }
  const width = card.offsetWidth, height = card.offsetHeight;
  const centre = word.left + word.width / 2;
  const left = Math.max(MARGIN, Math.min(centre - width / 2, view.width - rightReserve - width));
  const below = word.top - GAP - height < MARGIN;
  card.classList.toggle("sf-card-below", below);
  Object.assign(style, {
    left: `${left}px`, transform: "",
    top: below ? `${word.bottom + GAP}px` : "auto",
    bottom: below ? "auto" : `${view.height - word.top + GAP}px`,
  });
  style.setProperty("--sf-tip", `${Math.max(14, Math.min(width - 14, centre - left))}px`);
}
export function createWordCard(card: HTMLElement, onClose?: () => void) {
  // Static shell only; all untrusted content is assigned through textContent.
  card.innerHTML = `<div class="sf-card-head"><span class="sf-card-word"></span><button type="button" class="sf-card-close" aria-label="Fechar cartão">×</button></div><div class="sf-card-translation"></div><div class="sf-card-definition"></div><div class="sf-card-actions"><button type="button" class="sf-card-mark sf-mark-difficult" data-mark="difficult">Difícil</button><button type="button" class="sf-card-mark sf-mark-learned" data-mark="learned">Aprendida</button><button type="button" class="sf-card-btn" title="Salvar a palavra com a frase na biblioteca">Salvar</button></div><div class="sf-card-feedback" role="status" aria-live="polite"></div><div class="sf-card-links"></div>`;
  const find = <T extends HTMLElement>(name: string) => card.querySelector<T>(name)!;
  const feedback = find(".sf-card-feedback");
  const saveButton = find<HTMLButtonElement>(".sf-card-btn");
  const markButtons = [...card.querySelectorAll<HTMLButtonElement>(".sf-card-mark")];
  let identity = "", generation = 0, markOperation = 0, confirmedOperation = 0;
  let confirmed: WordMark | null = null, shown: WordMark | null = null;
  let save: () => void | string | Promise<void | string> = () => {};
  let mark: ((value: WordMark | null) => void | Promise<void>) | undefined;
  const showMark = (value: WordMark | null) => { shown = value; markButtons.forEach(button => {
    const selected = !!value && button.dataset.mark === value;
    button.classList.toggle("sf-active", selected); button.setAttribute("aria-pressed", String(selected));
    button.title = selected ? "Clique de novo para desmarcar" : "";
  }); };
  const hide = () => { generation++; identity = ""; card.classList.add("sf-hidden"); onClose?.(); };
  find(".sf-card-close").addEventListener("click", hide);
  saveButton.addEventListener("click", async event => {
    event.stopPropagation(); const token = generation;
    saveButton.disabled = true; feedback.textContent = "Salvando…";
    try { const message = await save(); if (generation === token) feedback.textContent = message || "Salvo"; }
    catch { if (generation === token) feedback.textContent = "Não foi possível salvar. Tente novamente."; }
    finally { if (generation === token) saveButton.disabled = false; }
  });
  markButtons.forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation(); if (!mark) return;
    // The pressed mark is a toggle: pressing it again removes it.
    const value = button.dataset.mark === shown ? null : button.dataset.mark as WordMark;
    const operation = ++markOperation, token = generation;
    showMark(value); feedback.textContent = "Salvando…";
    try {
      await mark(value);
      if (generation !== token) return;
      if (operation >= confirmedOperation) { confirmed = value; confirmedOperation = operation; }
      if (operation !== markOperation) return;
      feedback.textContent = value === "difficult" ? "Adicionada às difíceis" : value === "learned" ? "Marcada como aprendida" : "Marcação removida";
    } catch {
      if (generation !== token || operation !== markOperation) return;
      showMark(confirmed); feedback.textContent = "Não foi possível salvar. Tente novamente.";
    }
  }));
  return {
    show(content: CardContent, onSave: typeof save, onMark?: typeof mark) {
      const key = content.identity ?? JSON.stringify([content.word, content.sentence, content.directionLabel]);
      if (identity !== key) { identity = key; generation++; markOperation = 0; confirmedOperation = 0; feedback.textContent = ""; saveButton.disabled = false; }
      save = onSave; mark = onMark; confirmed = content.mark ?? null;
      const translation = find(".sf-card-translation");
      translation.classList.toggle("sf-card-pending", content.state !== "ready" || !content.translation);
      const fields = { ".sf-card-word": content.word,
        ".sf-card-translation": content.state === "loading" ? "Traduzindo…" : content.translation || "Tradução indisponível agora.",
        ".sf-card-definition": content.definition };
      for (const [selector, text] of Object.entries(fields)) find(selector).textContent = text;
      const links = find(".sf-card-links");
      links.replaceChildren();
      for (const link of content.links ?? []) {
        const anchor = card.ownerDocument.createElement("a");
        anchor.textContent = link.label;
        anchor.title = `Abrir no ${link.label} (nova aba)`;
        anchor.href = link.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        links.append(anchor);
      }
      markButtons.forEach(button => { button.hidden = !mark; }); showMark(confirmed);
      card.classList.remove("sf-hidden");
    }, hide,
  };
}
