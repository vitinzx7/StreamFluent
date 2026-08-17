/* global chrome */

const STORAGE_KEY = "phrases";

async function getAllPhrases() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw;
}

async function removePhrase(id) {
  const phrases = await getAllPhrases();
  const filtered = phrases.filter((p) => p.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
  return filtered;
}

async function clearAllPhrases() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderPhrases(phrases) {
  const listEl = document.getElementById("list");
  const countEl = document.getElementById("count");

  countEl.textContent = `${phrases.length} phrase${phrases.length !== 1 ? "s" : ""} saved`;

  if (phrases.length === 0) {
    listEl.innerHTML = '<p class="empty">No phrases saved yet.</p>';
    return;
  }

  listEl.innerHTML = "";
  for (const p of phrases) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <button class="card-delete" data-id="${escapeHtml(p.id)}" title="Delete">&times;</button>
      <div class="card-word">${escapeHtml(p.selectedWord)}</div>
      <div class="card-translation">${escapeHtml(p.translation || "No translation")}</div>
      <div class="card-sentence">"${escapeHtml(p.sentence)}"</div>
      <div class="card-meta">
        ${escapeHtml(p.platform)} &middot; ${escapeHtml(p.mediaTitle)}
        ${p.season ? ` &middot; S${p.season}E${p.episode || "?"}` : ""}
        &middot; ${formatDate(p.createdAt)}
      </div>
    `;
    listEl.appendChild(card);
  }

  // Delete handlers
  listEl.querySelectorAll(".card-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      const updated = await removePhrase(id);
      applyFilters(updated);
    });
  });
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
        p.selectedWord.toLowerCase().includes(search) ||
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

async function init() {
  const allPhrases = await getAllPhrases();
  populatePlatformFilter(allPhrases);
  applyFilters(allPhrases);

  document.getElementById("search").addEventListener("input", () => {
    applyFilters(allPhrases);
  });

  document.getElementById("platformFilter").addEventListener("change", () => {
    applyFilters(allPhrases);
  });

  document.getElementById("clearAll").addEventListener("click", async () => {
    if (!confirm("Delete all saved phrases? This cannot be undone.")) return;
    await clearAllPhrases();
    allPhrases.length = 0;
    applyFilters(allPhrases);
  });
}

init();
