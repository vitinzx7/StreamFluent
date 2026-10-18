import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryLineCache, handleLineCacheMessage, type LineCache } from "../core/line-cache.ts";
import { clearTranslationCache, translateSentence } from "../core/translation.ts";
import { requestStudy } from "../core/study-messages.ts";
import { installStudyWorker } from "./helpers/study-worker.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  clearTranslationCache();
});

describe("stored line translations", () => {
  it("keeps the newest lines when full", async () => {
    const cache = createMemoryLineCache(2);
    await cache.put("en-pt:One", "Um");
    await cache.put("en-pt:Two", "Dois");
    await cache.put("en-pt:Three", "Três");

    expect(await cache.get("en-pt:One")).toBeNull();
    expect(await cache.get("en-pt:Three")).toBe("Três");
  });

  it("answers the worker messages and refuses malformed ones", async () => {
    const cache = createMemoryLineCache();

    expect(await handleLineCacheMessage(cache, { type: "sf:line-cache", op: "put", key: "en-pt:Hi", text: "Oi" })).toEqual({ ok: true });
    expect(await handleLineCacheMessage(cache, { type: "sf:line-cache", op: "get", key: "en-pt:Hi" })).toEqual({ ok: true, text: "Oi" });
    expect(await handleLineCacheMessage(cache, { type: "sf:line-cache", op: "get", key: "en-pt:Other" })).toEqual({ ok: true, text: null });
    for (const bad of [
      { op: "get", key: "" },
      { op: "get", key: "x".repeat(1001) },
      { op: "put", key: "en-pt:Hi", text: "" },
      { op: "put", key: "en-pt:Hi", text: "x".repeat(2001) },
      { op: "clear", key: "en-pt:Hi" },
      null,
    ]) {
      expect(await handleLineCacheMessage(cache, bad)).toEqual({ ok: false });
    }
  });

  it("treats a broken store as a miss", async () => {
    const broken: LineCache = { get: () => Promise.reject(new Error("x")), put: () => Promise.reject(new Error("x")), clear: async () => {} };
    expect(await handleLineCacheMessage(broken, { op: "get", key: "en-pt:Hi" })).toEqual({ ok: false });
  });
});

describe("a line translated before comes back at once", () => {
  let worker: ReturnType<typeof installStudyWorker>;
  let providerCalls: number;

  beforeEach(() => {
    worker = installStudyWorker();
    providerCalls = 0;
    const study = worker.sendMessage.getMockImplementation()!;
    worker.sendMessage.mockImplementation(async (message: unknown) => {
      if ((message as { type?: unknown }).type !== "sf:provider-json") return study(message);
      providerCalls++;
      return { ok: true, data: ["Bom dia."] };
    });
  });

  it("asks the translator once, and after a reload reads the stored line instead", async () => {
    expect(await translateSentence("Good morning.", "en-pt")).toBe("Bom dia.");
    expect(providerCalls).toBe(1);
    await vi.waitFor(async () => expect(await worker.lines.get("en-pt:Good morning.")).toBe("Bom dia."));

    clearTranslationCache(); // the page's memory is gone, as after a reload
    expect(await translateSentence("Good morning.", "en-pt")).toBe("Bom dia.");

    expect(providerCalls).toBe(1);
  });

  it("is cleared with every other study data", async () => {
    await worker.lines.put("en-pt:Good morning.", "Bom dia.");

    await requestStudy("reset-all", {});

    expect(await worker.lines.get("en-pt:Good morning.")).toBeNull();
  });
});
