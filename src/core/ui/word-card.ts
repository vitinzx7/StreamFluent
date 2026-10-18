import type { WordMark } from "../vocabulary.ts";
export interface CardContent {
  word: string; translation: string; definition: string; sentence: string; sentenceTranslation: string;
  directionLabel: string; state: "loading" | "ready" | "error"; mark?: WordMark | null;
  /** A new click supplies a new identity; translation updates reuse it. */
  identity?: string;
}
export const CARD_STYLES = `
.sf-card { pointer-events:auto; background:#1a1a2e; color:#e0e0e0; border:1px solid #00d4aa55; border-radius:10px; padding:14px 18px; max-width:360px; font:14px/1.5 system-ui,sans-serif; box-shadow:0 8px 32px #0009; white-space:normal; user-select:text; }
.sf-card.sf-hidden { display:none; } .sf-card-head { display:flex; justify-content:space-between; gap:10px; }
.sf-card-word { color:#00d4aa; font-size:18px; font-weight:600; } .sf-card-dir { font-size:11px; }
.sf-card-sentence,.sf-card-sentence-translation { white-space:pre-wrap; margin:8px 0; }
.sf-card-sentence-translation { color:#7ee8d0; } .sf-card-actions { display:flex; gap:6px; flex-wrap:wrap; }
.sf-card button { color:inherit; background:#26344c; border:1px solid #536078; border-radius:5px; padding:6px; cursor:pointer; font:inherit; }
.sf-card .sf-active { outline:2px solid currentColor; } .sf-card .sf-mark-difficult { color:#FF8A80; } .sf-card .sf-mark-learned { color:#81C784; }
.sf-card-feedback { font-size:12px; min-height:1.5em; }
`;
export function createWordCard(card: HTMLElement, onClose?: () => void) {
  // Static shell only; all untrusted content is assigned through textContent.
  card.innerHTML = `<div class="sf-card-head"><span class="sf-card-word"></span><span class="sf-card-dir"></span><button type="button" class="sf-card-close" aria-label="Fechar cartão">×</button></div><div class="sf-card-translation"></div><div class="sf-card-definition"></div><div class="sf-card-sentence"></div><div class="sf-card-sentence-translation"></div><div class="sf-card-actions"><button type="button" class="sf-card-btn">Salvar palavra + frase</button><button type="button" class="sf-card-mark sf-mark-difficult" data-mark="difficult">Difícil</button><button type="button" class="sf-card-mark sf-mark-learned" data-mark="learned">Aprendida</button><button type="button" class="sf-card-mark" data-mark="">Remover marcação</button></div><div class="sf-card-feedback" role="status" aria-live="polite"></div>`;
  const find = <T extends HTMLElement>(name: string) => card.querySelector<T>(name)!;
  const feedback = find(".sf-card-feedback");
  const saveButton = find<HTMLButtonElement>(".sf-card-btn");
  const markButtons = [...card.querySelectorAll<HTMLButtonElement>(".sf-card-mark")];
  let identity = "", generation = 0, markOperation = 0, confirmedOperation = 0;
  let confirmed: WordMark | null = null;
  let save: () => void | string | Promise<void | string> = () => {};
  let mark: ((value: WordMark | null) => void | Promise<void>) | undefined;
  const showMark = (value: WordMark | null) => markButtons.forEach(button => {
    const selected = !!value && button.dataset.mark === value;
    button.classList.toggle("sf-active", selected); button.setAttribute("aria-pressed", String(selected));
  });
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
    const value = (button.dataset.mark || null) as WordMark | null;
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
      const fields = { ".sf-card-word": content.word, ".sf-card-dir": content.directionLabel,
        ".sf-card-translation": content.state === "loading" ? "Traduzindo…" : content.translation || "Tradução indisponível; você pode marcar e salvar o original.",
        ".sf-card-definition": content.definition, ".sf-card-sentence": content.sentence, ".sf-card-sentence-translation": content.sentenceTranslation };
      for (const [selector, text] of Object.entries(fields)) find(selector).textContent = text;
      markButtons.forEach(button => { button.hidden = !mark; }); showMark(confirmed);
      card.classList.remove("sf-hidden");
    }, hide,
  };
}
