/* global chrome, studyRequest */
const views = ["phrases", "difficult", "learned"];
let view = new URLSearchParams(location.search).get("tab");
if (!views.includes(view)) view = "phrases";
let state = { phrases: [], vocabulary: { languages: {} } };
let readSequence = 0;
const get = id => document.getElementById(id);
function node(tag, className, text) {
  const el = document.createElement(tag); el.className = className; el.textContent = text; return el;
}
function dateText(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("pt-BR") : "Data desconhecida";
}
function updateOptions(select, values, label) {
  const selected = select.value;
  select.replaceChildren(new Option(label, ""), ...values.map(value => new Option(value, value)));
  select.value = values.includes(selected) ? selected : "";
}
function words() {
  return Object.entries(state.vocabulary.languages).flatMap(([language, entry]) => Object.entries(entry.marks).map(([key, mark]) => ({
    id: `${language}:${key}`, key, language, mark, ...(entry.details[key] || { displayWord: key, markedAt: null, updatedAt: null }),
  })));
}
async function action(button, operation) {
  button.disabled = true; get("feedback").textContent = "Salvando…"; delete get("feedback").dataset.kind;
  try { await operation(); await refresh(); get("feedback").textContent = "Alteração salva."; }
  catch { get("feedback").textContent = "Não foi possível salvar. Tente novamente."; get("feedback").dataset.kind = "error"; button.disabled = false; }
}
function actionButton(card, label, actionName, operation) {
  const button = node("button", "card-action", label); button.type = "button"; button.dataset.action = actionName;
  button.addEventListener("click", () => void action(button, operation)); card.appendChild(button);
}
function render() {
  const active = document.activeElement;
  const focused = active?.closest?.("[data-item]")?.dataset.item;
  const focusedAction = active?.dataset?.action;
  document.querySelectorAll("[data-tab]").forEach(button => {
    if (button.dataset.tab === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  get("viewTitle").textContent = { phrases: "Frases salvas", difficult: "Palavras difíceis", learned: "Palavras aprendidas" }[view];
  get("platformFilter").hidden = view !== "phrases"; get("clearAll").hidden = view !== "phrases";
  const search = get("search").value.normalize("NFC").toLowerCase().trim(), language = get("languageFilter").value;
  let items;
  if (view === "phrases") {
    items = state.phrases.filter(p => (!language || p.sourceLanguage === language) && (!get("platformFilter").value || p.platform === get("platformFilter").value)
      && [p.sentence, p.kind === "word" ? p.selectedWord : "", p.mediaTitle].some(value => (value || "").toLowerCase().includes(search)));
    items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  } else {
    items = words().filter(w => w.mark === view && (!language || w.language === language)
      && [w.key, w.displayWord, w.context?.sentence, w.translation].some(value => (value || "").toLowerCase().includes(search)));
    items.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.key.localeCompare(b.key) || a.language.localeCompare(b.language));
  }
  get("count").textContent = `${items.length} ${view === "phrases" ? "frase(s)" : "palavra(s)"}`;
  const list = get("list"); list.replaceChildren();
  if (!items.length) list.appendChild(node("p", "empty", view === "difficult" ? "Clique com o botão direito em uma palavra da legenda para salvá-la aqui." : "Nenhum item neste filtro."));
  for (const item of items) {
    const card = node("article", "card", ""); card.dataset.item = item.id;
    if (view === "phrases") {
      card.appendChild(node("div", "card-word", item.kind === "word" ? item.selectedWord : "Fala completa"));
      if (item.kind === "word" && item.translation) card.appendChild(node("div", "card-translation", item.translation));
      if (item.kind === "word" && item.definition) card.appendChild(node("div", "card-definition", item.definition));
      card.appendChild(node("div", "card-sentence", item.sentence));
      if (item.sentenceTranslation) card.appendChild(node("div", "card-sentence-translation", item.sentenceTranslation));
      card.appendChild(node("div", "card-meta", [item.sourceLanguage || "Idioma desconhecido", item.platform, item.mediaTitle, item.season !== null ? `S${item.season}E${item.episode ?? "?"}` : "", dateText(item.createdAt)].filter(Boolean).join(" · ")));
      actionButton(card, "Excluir frase", "remove-phrase", () => studyRequest("remove-phrase", { id: item.id }));
    } else {
      card.appendChild(node("div", `card-word ${item.mark}`, item.displayWord));
      card.appendChild(node("div", "card-meta", `${item.language} · ${item.mark === "difficult" ? "Difícil" : "Aprendida"} · ${dateText(item.updatedAt)}`));
      if (item.translation) card.appendChild(node("div", "card-translation", item.translation));
      if (item.definition) card.appendChild(node("div", "card-definition", item.definition));
      if (item.context) {
        card.appendChild(node("div", "card-sentence", item.context.sentence));
        if (item.context.sentenceTranslation) card.appendChild(node("div", "card-sentence-translation", item.context.sentenceTranslation));
        card.appendChild(node("div", "card-meta", [item.context.platform, item.context.mediaTitle].filter(Boolean).join(" · ")));
      }
      actionButton(card, item.mark === "difficult" ? "Marcar como aprendida" : "Marcar como difícil", "change-mark", () => studyRequest("set-mark", { language: item.language, word: item.key, mark: item.mark === "difficult" ? "learned" : "difficult" }));
      actionButton(card, "Remover marcação", "remove-mark", () => studyRequest("set-mark", { language: item.language, word: item.key, mark: null }));
    }
    list.appendChild(card);
  }
  if (focused) {
    const card = [...list.querySelectorAll("[data-item]")].find(item => item.dataset.item === focused);
    const button = card && [...card.querySelectorAll("[data-action]")].find(item => item.dataset.action === focusedAction);
    (button || document.querySelector(`[data-tab="${view}"]`)).focus();
  }
}
async function refresh() {
  const sequence = ++readSequence;
  const next = await studyRequest("read");
  if (sequence !== readSequence) return;
  state = next;
  updateOptions(get("platformFilter"), [...new Set(state.phrases.map(p => p.platform))].filter(Boolean).sort(), "Todas as plataformas");
  updateOptions(get("languageFilter"), [...new Set([...state.phrases.map(p => p.sourceLanguage), ...Object.keys(state.vocabulary.languages)])].filter(Boolean).sort(), "Todos os idiomas");
  render();
}
for (const id of ["search", "platformFilter", "languageFilter"]) get(id).addEventListener(id === "search" ? "input" : "change", render);
document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => {
  view = button.dataset.tab; history.replaceState({}, "", `?tab=${view}`); render();
}));
get("clearAll").addEventListener("click", () => {
  if (confirm("Apagar todas as frases? As marcações de palavras serão mantidas.")) void action(get("clearAll"), () => studyRequest("clear-phrases")).finally(() => { get("clearAll").disabled = false; });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.phrases || changes.vocabulary)) void refresh().catch(() => { get("feedback").textContent = "Não foi possível atualizar. Recarregue para tentar novamente."; });
});
void refresh().catch(() => { get("feedback").textContent = "Não foi possível carregar. Recarregue para tentar novamente."; });
