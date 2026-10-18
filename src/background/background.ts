import { createStudyStorageService } from "../core/study-storage.ts";
import { fetchProviderJson, isAllowedProviderUrl } from "../core/translation-request.ts";
import {
  isCinetaroUrl, isEmbeddedPlayerUrl, isFrameDocumentId, isFrameId,
  isFrameLeaseReply, isFrameLeaseRequest, isFrameSessionRequest,
  type FrameLeaseReply, type FrameOffer,
} from "../core/frame-messages.ts";

function senderTabId(sender: chrome.runtime.MessageSender): number | null {
  const tabId = sender.tab?.id;
  return sender.id === chrome.runtime.id && typeof tabId === "number"
    && Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null;
}

export async function relayFrameLease(message: unknown, sender: chrome.runtime.MessageSender): Promise<FrameLeaseReply> {
  const denied: FrameLeaseReply = { granted: false, sessionKey: "" };
  const tabId = senderTabId(sender);
  if (tabId === null || !isFrameLeaseRequest(message) || !isFrameId(sender.frameId)
    || !isFrameDocumentId(sender.documentId) || !isEmbeddedPlayerUrl(sender.url)) return denied;
  const offer: FrameOffer = {
    type: "sf:frame-offer", active: message.active, token: message.token,
    frameId: sender.frameId, documentId: sender.documentId,
  };
  try {
    const reply: unknown = await chrome.tabs.sendMessage(tabId, offer, { frameId: 0 });
    return isFrameLeaseReply(reply)
      ? { granted: reply.granted, sessionKey: reply.sessionKey } : denied;
  } catch {
    return denied;
  }
}

export async function relayFrameSession(message: unknown, sender: chrome.runtime.MessageSender): Promise<{ ok: boolean }> {
  const tabId = senderTabId(sender);
  if (tabId === null || sender.frameId !== 0 || !isCinetaroUrl(sender.url)
    || !isFrameSessionRequest(message)) return { ok: false };
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "sf:frame-session", token: message.token, sessionKey: message.sessionKey,
    }, { documentId: message.documentId });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

const studyStorage = createStudyStorageService();

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!message || typeof message !== "object") return false;
  const request = message as { type?: unknown; url?: unknown };
  if (typeof request.type === "string" && request.type.startsWith("sf:study:")) {
    void studyStorage.handle(message, sender).then(respond);
    return true;
  }
  if (request.type === "sf:frame-lease") {
    void relayFrameLease(message, sender).then(respond);
    return true;
  }
  if (request.type === "sf:frame-session") {
    void relayFrameSession(message, sender).then(respond);
    return true;
  }
  if (sender.id !== chrome.runtime.id) return false;
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
