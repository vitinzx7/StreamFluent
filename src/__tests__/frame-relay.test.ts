import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmbeddedPlayerUrl, isCinetaroUrl } from "../core/frame-messages.ts";
import { relayFrameLease, relayFrameSession } from "../background/background.ts";

// Background installs its listener at import time; supply that boundary before import.
vi.hoisted(() => {
  Object.assign(globalThis, { chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: { async get() { return {}; }, async set() {} } } } });
});
const sender = {
  id: "extension", tab: { id: 7 }, frameId: 12, documentId: "document-a",
  url: "https://cinextream.cc/embed/private?token=never-forward",
} as chrome.runtime.MessageSender;
const request = { type: "sf:frame-lease", active: true, token: "lease-a" };
let send: ReturnType<typeof vi.fn>;

beforeEach(() => {
  send = vi.fn().mockResolvedValue({ granted: true, sessionKey: "episode-opaque-id" });
  vi.stubGlobal("chrome", { runtime: { id: "extension" }, tabs: { sendMessage: send } });
});
afterEach(() => vi.unstubAllGlobals());

describe("frame relay authorization", () => {
  it("uses browser sender identity, not requested tab/frame/document IDs", async () => {
    const result = await relayFrameLease({ ...request, tabId: 99, frameId: 98, documentId: "fake" }, sender);
    expect(result).toEqual({ granted: true, sessionKey: "episode-opaque-id" });
    expect(send).toHaveBeenCalledWith(7, {
      type: "sf:frame-offer", active: true, token: "lease-a", frameId: 12, documentId: "document-a",
    }, { frameId: 0 });
    expect(JSON.stringify(send.mock.calls)).not.toContain("private");
    expect(JSON.stringify(send.mock.calls)).not.toContain("never-forward");
  });

  it.each([
    { id: "other" }, { id: undefined }, { tab: undefined }, { tab: { id: -1 } },
    { frameId: 0 }, { frameId: -3 }, { documentId: undefined },
    { url: "https://cinetaro.to/embed" }, { url: "https://cinextream.cc.evil.example/" },
    { url: "https://sub.cinextream.cc/" }, { url: "http://cinextream.cc/" },
    { url: "https://user:password@cinextream.cc/" }, { url: "https://cinextream.cc:8443/" },
  ])("rejects a non-authorized frame sender: %j", async (patch) => {
    expect(await relayFrameLease(request, { ...sender, ...patch } as chrome.runtime.MessageSender))
      .toEqual({ granted: false, sessionKey: "" });
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts an opaque sandbox origin only when the browser URL matches the allowed player", async () => {
    expect((await relayFrameLease(request, { ...sender, origin: "null" })).granted).toBe(true);
  });

  it.each([null, {}, { ...request, token: "" }, { ...request, token: "x".repeat(101) }, { ...request, active: "true" }])(
    "rejects malformed requests: %j", async (message) => {
      expect((await relayFrameLease(message, sender)).granted).toBe(false);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the parent is gone or sends a malformed reply", async () => {
    send.mockRejectedValueOnce(new Error("No receiving end"));
    expect((await relayFrameLease(request, sender)).granted).toBe(false);
    send.mockResolvedValueOnce({ granted: true, sessionKey: "" });
    expect((await relayFrameLease(request, sender)).granted).toBe(false);
  });

  it("relays episode updates only from the Cinetaro top to the same tab and exact document", async () => {
    const update = { type: "sf:frame-session", token: "lease-a", sessionKey: "episode-2", frameId: 12, documentId: "document-a", tabId: 999 };
    expect(await relayFrameSession(update, { ...sender, frameId: 0, url: "https://cinetaro.to/watch/1?ep=2" }))
      .toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(7, { type: "sf:frame-session", token: "lease-a", sessionKey: "episode-2" }, { documentId: "document-a" });
    send.mockClear();
    expect(await relayFrameSession(update, sender)).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts only exact configured hostnames", () => {
    expect(isEmbeddedPlayerUrl("https://cinextream.cc/embed")).toBe(true);
    expect(isEmbeddedPlayerUrl("https://cinextream.cc.evil.test/")).toBe(false);
    expect(isCinetaroUrl("https://www.cinetaro.to/watch/1")).toBe(true);
    expect(isCinetaroUrl("https://other.cinetaro.to/")).toBe(false);
  });
});
