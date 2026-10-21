import { broadcastStudyChanges } from "../core/study-notifications.ts";
import { createAccountRemote } from "../core/account-remote.ts";
import { createAccountService } from "../core/account-service.ts";
import { createStudyStorageService } from "../core/study-storage.ts";
import { createIndexedDbSeenStore } from "../core/seen-store.ts";
import { createIndexedDbLineCache, handleLineCacheMessage } from "../core/line-cache.ts";
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

// Fail closed: account operations cannot persist sessions before this succeeds.
const trustedStorage = typeof chrome.storage.local.setAccessLevel === "function"
  ? chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  : Promise.reject(new Error("Este Chrome não permite restringir o armazenamento de conta."));
void trustedStorage.catch(() => {});
const lineCache = createIndexedDbLineCache();
const studyStorage = createStudyStorageService(chrome.storage.local, createIndexedDbSeenStore(), lineCache);
const accounts = createAccountService(studyStorage, createAccountRemote(trustedStorage));
if (chrome.storage.onChanged) chrome.storage.onChanged.addListener((changes, area) => {
  void broadcastStudyChanges(changes, area).catch(() => {});
});
const SYNC_ALARM = "sf-account-sync";
function scheduleSync() {
  if (chrome.alarms) void chrome.alarms.create("sf-account-pending", { delayInMinutes: 0.5 });
}
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(alarm => {
    if ([SYNC_ALARM, "sf-account-pending"].includes(alarm.name)) void accounts.sync().catch(() => {});
  });
  // Periodic retry also pulls edits made by another device, even with no local writes.
  void chrome.alarms.get(SYNC_ALARM).then(alarm => { if (!alarm) return chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 }); return undefined; }).catch(() => {});
}

// A new install starts by asking the English level; updates ask in the player instead.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!message || typeof message !== "object") return false;
  const request = message as { type?: unknown; url?: unknown; tab?: unknown };
  if (typeof request.type === "string" && request.type.startsWith("sf:account:")) {
    void trustedStorage.then(() => accounts.handle(message, sender)).then(respond, () => respond({ ok: false, requestId: (message as { requestId?: unknown }).requestId, error: "Armazenamento de conta indisponível neste Chrome." }));
    return true;
  }
  if (typeof request.type === "string" && request.type.startsWith("sf:study:")) {
    void studyStorage.handle(message, sender).then(reply => {
      respond(reply);
      if (reply.ok && !["sf:study:read", "sf:study:observe"].includes(request.type as string)) scheduleSync();
    });
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
    void chrome.tabs.create({ url: chrome.runtime.getURL(request.tab === "difficult" ? "library.html?tab=difficult" : "library.html") });
    respond({ ok: true });
    return false;
  }
  if (request.type === "sf:line-cache") {
    void handleLineCacheMessage(lineCache, message).then(respond);
    return true;
  }
  if (request.type !== "sf:provider-json") return false;
  if (!isAllowedProviderUrl(request.url)) {
    respond({ ok: false });
    return false;
  }
  void fetchProviderJson(request.url).then(respond);
  return true;
});
