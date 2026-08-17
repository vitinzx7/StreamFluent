// Library page — will be expanded in Block 6.
// For now, just confirm chrome.storage is accessible.

const listEl = document.getElementById("list");

chrome.storage.local.get("phrases", (result) => {
  const phrases = result.phrases || [];
  if (phrases.length === 0) return;

  listEl.innerHTML = "";
  for (const p of phrases) {
    const card = document.createElement("div");
    card.style.cssText =
      "background:#16213e;border-radius:8px;padding:16px;margin-bottom:12px;";
    card.innerHTML =
      `<p style="color:#00d4aa;font-size:14px;margin-bottom:4px;">${escapeHtml(p.selectedWord)}</p>` +
      `<p style="font-size:13px;color:#aaa;margin-bottom:4px;">${escapeHtml(p.sentence)}</p>` +
      `<p style="font-size:12px;color:#666;">${escapeHtml(p.platform)} · ${escapeHtml(p.mediaTitle)}</p>`;
    listEl.appendChild(card);
  }
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
