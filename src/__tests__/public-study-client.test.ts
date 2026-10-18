/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import clientSource from "../../public/study-client.js?raw";
function client(sendMessage: (request: { type: string; requestId: string; payload: unknown }) => Promise<unknown>) {
  return new Function("chrome", "crypto", `${clientSource}\nreturn studyRequest;`)(
    { runtime: { sendMessage } }, { randomUUID: () => "page-request-id" },
  ) as (action: string, payload?: unknown) => Promise<unknown>;
}

describe("unbundled pages study protocol", () => {
  it("waits for confirmed persistence and sends a field patch", async () => {
    let confirm!: (reply: unknown) => void;
    const send = vi.fn(() => new Promise(resolve => { confirm = resolve; }));
    const result = client(send)("patch-settings", { patch: { showTranslation: false } });
    const ready = vi.fn();
    void result.then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ type: "sf:study:patch-settings", requestId: "page-request-id", payload: { patch: { showTranslation: false } } });
    confirm({ ok: true, requestId: "page-request-id", revision: 3, data: { showTranslation: false, subtitleBottom: 42 } });
    expect(await result).toEqual({ showTranslation: false, subtitleBottom: 42 });
  });
  it("rejects quota errors and unrelated or malformed success replies", async () => {
    for (const reply of [
      { ok: false, requestId: "page-request-id", error: "quota" },
      { ok: true, requestId: "other", revision: 1, data: {} },
      { ok: true, requestId: "page-request-id", revision: -1, data: {} },
      undefined,
    ]) await expect(client(async () => reply)("clear-phrases")).rejects.toThrow();
  });
});
