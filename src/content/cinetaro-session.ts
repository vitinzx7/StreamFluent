import { observeHtml5Player } from "../adapters/html5-player.ts";
import { createTimedSubtitles } from "../core/ui/timed-subtitles.ts";
import type { PlayerSnapshot } from "../core/player-types.ts";
import { isFrameOffer, isFrameLeaseReply, isFrameSessionUpdate, type FrameOffer } from "../core/frame-messages.ts";

type Overlay = ReturnType<typeof createTimedSubtitles>;
const HEARTBEAT_MS = 500;
const OWNER_LIFETIME_MS = 2500;
// The child stops rendering before the top can assign its ownership elsewhere.
const CHILD_LIFETIME_MS = 1500;
const REQUEST_TIMEOUT_MS = 1000;

/** Only the top Cinetaro document owns the episode identity and UI election. */
export function startCinetaroTop(): () => void {
  let stopped = false;
  let overlay: Overlay | null = createTimedSubtitles();
  let state: PlayerSnapshot | null = null;
  let owner: (FrameOffer & { lastSeen: number }) | null = null;
  let page = location.href;
  let sessionKey = crypto.randomUUID();

  function renderLocal(): void {
    if (stopped) return;
    if (owner) {
      overlay?.destroy();
      overlay = null;
    } else {
      overlay ??= createTimedSubtitles();
      if (state) overlay.updatePlayer(state);
    }
  }
  function refreshSession(): void {
    if (page === location.href) return;
    page = location.href;
    sessionKey = crypto.randomUUID();
    if (owner) {
      void chrome.runtime.sendMessage({
        type: "sf:frame-session", token: owner.token, frameId: owner.frameId,
        documentId: owner.documentId, sessionKey,
      }).catch(() => {});
    }
  }
  function expireOwner(): void {
    refreshSession();
    if (owner && Date.now() - owner.lastSeen >= OWNER_LIFETIME_MS) {
      owner = null;
      renderLocal();
    }
  }
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void): boolean => {
    if (stopped || sender.id !== chrome.runtime.id || sender.tab || !isFrameOffer(message)) return false;
    expireOwner();
    const sameOwner = owner?.token === message.token && owner.frameId === message.frameId
      && owner.documentId === message.documentId;
    if (!message.active) {
      if (sameOwner) { owner = null; renderLocal(); }
      respond({ granted: false, sessionKey });
      return false;
    }
    if (state?.video || (owner && !sameOwner)) {
      respond({ granted: false, sessionKey });
      return false;
    }
    owner = { ...message, lastSeen: Date.now() };
    renderLocal();
    respond({ granted: true, sessionKey });
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  const stopPlayer = observeHtml5Player((next) => {
    state = next;
    expireOwner();
    // A remote owner keeps its lease until it releases/expires, avoiding duplicate UI.
    renderLocal();
  });
  const timer = window.setInterval(expireOwner, HEARTBEAT_MS);
  return () => {
    stopped = true;
    chrome.runtime.onMessage.removeListener(onMessage);
    window.clearInterval(timer);
    stopPlayer();
    overlay?.destroy();
    overlay = null;
    owner = null;
  };
}

/** Runs inside the explicitly allowed cinextream.cc document, not through its parent's DOM. */
export function startEmbeddedPlayer(): () => void {
  let stopped = false;
  let state: PlayerSnapshot | null = null;
  let overlay: Overlay | null = null;
  let token = crypto.randomUUID();
  let parentSession = "";
  let granted = false;
  let sequence = 0;
  let inFlight = false;
  let nextAttempt = 0;
  let expiresAt = 0;
  let expiryTimer: number | undefined;
  let requestTimer: number | undefined;

  function dropOverlay(): void {
    granted = false;
    window.clearTimeout(expiryTimer);
    overlay?.destroy();
    overlay = null;
  }
  function release(oldToken: string): void {
    void chrome.runtime.sendMessage({ type: "sf:frame-lease", active: false, token: oldToken }).catch(() => {});
  }
  function render(): void {
    if (!granted || stopped || !state?.video || Date.now() >= expiresAt) {
      dropOverlay();
      return;
    }
    overlay ??= createTimedSubtitles();
    overlay.updatePlayer({ ...state, sessionKey: `${parentSession}|${state.sessionKey}` });
  }
  async function renew(): Promise<void> {
    if (stopped || !state?.video || inFlight || Date.now() < nextAttempt) return;
    inFlight = true;
    const sentAt = Date.now();
    nextAttempt = sentAt + HEARTBEAT_MS;
    const requestToken = token;
    const id = ++sequence;
    const denied = { granted: false, sessionKey: "" };
    try {
      const reply: unknown = await Promise.race([
        chrome.runtime.sendMessage({ type: "sf:frame-lease", active: true, token: requestToken }).catch(() => denied),
        new Promise((resolve) => { requestTimer = window.setTimeout(() => resolve(denied), REQUEST_TIMEOUT_MS); }),
      ]);
      if (stopped || requestToken !== token) {
        release(requestToken);
        return;
      }
      // A pushed episode change wins over an older request already in flight.
      if (id !== sequence) return;
      if (!isFrameLeaseReply(reply) || !reply.granted || !state?.video
        || Date.now() >= sentAt + CHILD_LIFETIME_MS) {
        dropOverlay();
        return;
      }
      parentSession = reply.sessionKey;
      granted = true;
      expiresAt = sentAt + CHILD_LIFETIME_MS;
      window.clearTimeout(expiryTimer);
      expiryTimer = window.setTimeout(dropOverlay, Math.max(0, expiresAt - Date.now()));
      render();
    } catch {
      if (!stopped && requestToken === token && id === sequence) dropOverlay();
    } finally {
      window.clearTimeout(requestTimer);
      inFlight = false;
    }
  }
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender): boolean => {
    if (stopped || sender.id !== chrome.runtime.id || sender.tab || !isFrameSessionUpdate(message)
      || message.token !== token) return false;
    sequence++;
    parentSession = message.sessionKey;
    render();
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  const stopPlayer = observeHtml5Player((next) => {
    if (state && state.sessionKey !== next.sessionKey) {
      const oldToken = token;
      token = crypto.randomUUID();
      sequence++;
      parentSession = "";
      nextAttempt = 0;
      dropOverlay();
      release(oldToken);
    }
    state = next;
    if (!next.video) { dropOverlay(); return; }
    render();
    void renew();
  }, { includeFrames: false });
  const timer = window.setInterval(() => { render(); void renew(); }, HEARTBEAT_MS);
  return () => {
    stopped = true;
    sequence++;
    chrome.runtime.onMessage.removeListener(onMessage);
    window.clearInterval(timer);
    window.clearTimeout(requestTimer);
    stopPlayer();
    dropOverlay();
    release(token);
  };
}
