import { afterEach, describe, expect, it, vi } from "vitest";
import { broadcastStudyChanges, onStudyInvalidated } from "../core/study-notifications.ts";
afterEach(() => vi.unstubAllGlobals());
describe("trusted storage notifications", () => {
  it("sends only invalidation keys, never account/session/library payloads", async () => {
    const sendMessage = vi.fn(async () => {}), query = vi.fn(async () => [{ id: 1 }, { id: 2 }]);
    vi.stubGlobal("chrome", { tabs: { query, sendMessage } });
    await broadcastStudyChanges({ sfAccountSession: { newValue: "secret" }, sfAccount: { newValue: "secret" } }, "local");
    expect(query).not.toHaveBeenCalled();
    await broadcastStudyChanges({ vocabulary: { newValue: "personal" }, settings: { newValue: "prefs" }, sfAccountSession: { newValue: "secret" } }, "local");
    expect(sendMessage).toHaveBeenCalledWith(1, { type: "sf:study-invalidated", keys: ["settings", "vocabulary"] });
    expect(JSON.stringify(sendMessage.mock.calls)).not.toMatch(/secret|personal|prefs/);
  });
  it("accepts only the worker invalidation and removes its listener on dispose", () => {
    let listener!: (m: unknown, s: chrome.runtime.MessageSender) => void;
    const removeListener = vi.fn(), reload = vi.fn();
    vi.stubGlobal("chrome", { runtime: { id: "our-id", onMessage: { addListener: (l: typeof listener) => { listener = l; }, removeListener } } });
    const dispose = onStudyInvalidated("settings", reload);
    const message = { type: "sf:study-invalidated", keys: ["settings"] };
    listener(message, { id: "evil" }); listener(message, { id: "our-id", tab: { id: 1 } as chrome.tabs.Tab });
    expect(reload).not.toHaveBeenCalled(); listener(message, { id: "our-id" }); expect(reload).toHaveBeenCalledOnce();
    dispose(); expect(removeListener).toHaveBeenCalledWith(listener);
  });
});
