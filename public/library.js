/* global chrome */

async function getAllPhrases() {
  return (await studyRequest("read")).phrases;
}
async function removePhrase(id) {
  await studyRequest("remove-phrase", { id });
  return getAllPhrases();
}
async function clearAllPhrases() {
  await studyRequest("clear-phrases");
}

function formatDate(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "Data desconhecida";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderPhrases(phrases) {
  const listEl = document.getElementById("list");
  document.getElementById("count").textContent = `${phrases.length} frase(s) salva(s)`;
  listEl.replaceChildren();
  function text(parent, className, value) {
    const node = document.createElement("div");
    node.className = className;
    node.textContent = value;
    parent.appendChild(node);
  }
  if (!phrases.length) text(listEl, "empty", "Nenhuma frase salva.");
  for (const p of phrases) {
    const card = document.createElement("div");
    card.className = "card";
    const remove = document.createElement("button");
    remove.className = "card-delete";
    remove.textContent = "×";
    remove.title = "Excluir frase";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try { await removePhrase(p.id); await refresh(); }
      catch { document.getElementById("feedback").textContent = "Não foi possível excluir. Tente novamente."; remove.disabled = false; }
    });
    card.appendChild(remove);
    text(card, "card-word", p.kind === "word" ? p.selectedWord : "Fala completa");
    if (p.translation) text(card, "card-translation", p.translation);
    if (p.definition) text(card, "card-definition", p.definition);
    text(card, "card-sentence", p.sentence);
    if (p.sentenceTranslation) text(card, "card-sentence-translation", p.sentenceTranslation);
    text(card, "card-meta", [p.platform, p.mediaTitle, p.season ? `S${p.season}E${p.episode ?? "?"}` : "", formatDate(p.createdAt)].filter(Boolean).join(" · "));
    listEl.appendChild(card);
  }
}

function populatePlatformFilter(phrases) {
  const select = document.getElementById("platformFilter");
  const platforms = [...new Set(phrases.map((p) => p.platform))].sort();
  select.innerHTML = '<option value="">All platforms</option>';
  for (const plat of platforms) {
    const opt = document.createElement("option");
    opt.value = plat;
    opt.textContent = plat;
    select.appendChild(opt);
  }
}

function applyFilters(allPhrases) {
  const search = document.getElementById("search").value.toLowerCase().trim();
  const platform = document.getElementById("platformFilter").value;

  let filtered = allPhrases;

  if (search) {
    filtered = filtered.filter(
      (p) =>
        p.sentence.toLowerCase().includes(search) ||
        (p.kind === "word" ? p.selectedWord : "").toLowerCase().includes(search) ||
        p.mediaTitle.toLowerCase().includes(search)
    );
  }

  if (platform) {
    filtered = filtered.filter((p) => p.platform === platform);
  }

  // Sort newest first
  filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  renderPhrases(filtered);
}

let allPhrases = [];
async function refresh() {
  allPhrases = await getAllPhrases();
  const filter = document.getElementById("platformFilter").value;
  populatePlatformFilter(allPhrases);
  document.getElementById("platformFilter").value = filter;
  applyFilters(allPhrases);
}
async function init() {
  await refresh();
  document.getElementById("search").addEventListener("input", () => applyFilters(allPhrases));
  document.getElementById("platformFilter").addEventListener("change", () => applyFilters(allPhrases));
  document.getElementById("clearAll").addEventListener("click", async () => {
    if (!confirm("Apagar todas as frases salvas? Esta ação não pode ser desfeita.")) return;
    try { await clearAllPhrases(); await refresh(); }
    catch { document.getElementById("feedback").textContent = "Não foi possível apagar. Tente novamente."; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.phrases) void refresh().catch(() => {});
  });
}
init().catch(() => { document.getElementById("feedback").textContent = "Não foi possível carregar. Recarregue para tentar novamente."; });
