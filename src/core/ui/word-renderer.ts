import { tokenizeWords } from "../word-normalization.ts";
import type { WordStatus } from "../vocabulary.ts";
export const WORD_STYLES = `
.sf-word { cursor:pointer; border-radius:.18em; color:#FFFFFF; }
.sf-word:focus-visible, button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid #8ECBFF; outline-offset:3px; }
.sf-word-new { color:#8ECBFF; } .sf-word-special { color:#C4A5FF; }
.sf-word-difficult { color:#FF8A80; } .sf-word-learned { color:#81C784; }
.sf-word:hover { background:#ffffff24; } .sf-selected { background:#ffffff38; }
`;
export function createWordRenderer(container: HTMLElement, options: {
  status(word: string): WordStatus | null;
  select(word: string, sentence: string): void;
  difficult?(word: string, sentence: string): void;
}) {
  let sentence = "";
  const wordAt = (event: Event): HTMLElement | null => {
    const target = event.target as Element | null;
    const word = target?.closest?.<HTMLElement>(".sf-word");
    return word && container.contains(word) && !!word.dataset.word ? word : null;
  };
  const select = (word: HTMLElement) => {
    container.querySelectorAll(".sf-selected").forEach(node => node.classList.remove("sf-selected"));
    word.classList.add("sf-selected");
    options.select(word.dataset.word!, sentence);
  };
  const click = (event: MouseEvent) => { const word = wordAt(event); if (!word || event.button !== 0) return; event.stopPropagation(); select(word); };
  const context = (event: MouseEvent) => {
    const word = wordAt(event);
    if (!word || !options.difficult) return;
    event.preventDefault(); event.stopPropagation();
    options.difficult(word.dataset.word!, sentence);
  };
  const key = (event: KeyboardEvent) => {
    const word = wordAt(event);
    if (!word || !["Enter", " "].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) select(word);
  };
  container.addEventListener("click", click);
  container.addEventListener("contextmenu", context);
  container.addEventListener("keydown", key);
  const refresh = () => {
    container.querySelectorAll<HTMLElement>(".sf-word").forEach(node => {
      const status = options.status(node.dataset.word!);
      for (const name of ["new", "special", "difficult", "learned"]) node.classList.toggle(`sf-word-${name}`, status === name);
    });
  };
  return {
    update(text: string) {
      if (text === sentence) { refresh(); return; }
      sentence = text; container.replaceChildren();
      for (const token of tokenizeWords(text)) {
        if (!token.key) { container.appendChild(container.ownerDocument.createTextNode(token.text)); continue; }
        const span = container.ownerDocument.createElement("span");
        span.className = "sf-word"; span.textContent = token.text; span.dataset.word = token.text;
        span.tabIndex = 0; span.setAttribute("role", "button"); span.setAttribute("aria-label", `Consultar ${token.text}`);
        container.appendChild(span);
      }
      refresh();
    }, refresh,
    destroy() { container.removeEventListener("click", click); container.removeEventListener("contextmenu", context); container.removeEventListener("keydown", key); },
  };
}
