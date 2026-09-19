import { fetchProviderJson, isAllowedProviderUrl } from "../core/translation-request.ts";

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return false;
  const request = message as { type?: unknown; url?: unknown };
  if (request.type === "sf:open-library") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
    respond({ ok: true });
    return false;
  }
  if (request.type !== "sf:provider-json") return false;
  if (!isAllowedProviderUrl(request.url)) {
    respond({ ok: false });
    return false;
  }
  void fetchProviderJson(request.url).then(respond);
  return true;
});
