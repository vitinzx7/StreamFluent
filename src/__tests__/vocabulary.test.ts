import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createVocabularyStore, wordKey, type VocabularyStore } from "../core/vocabulary.ts";
import { installStudyWorker } from "./helpers/study-worker.ts";
import type { VocabularyV2 } from "../core/types.ts";

let worker: ReturnType<typeof installStudyWorker>;
const stores: VocabularyStore[] = [];
function create() { const store = createVocabularyStore(); stores.push(store); return store; }
beforeEach(() => { worker = installStudyWorker(); });
afterEach(() => { stores.splice(0).forEach(store => store.dispose()); vi.unstubAllGlobals(); });
const stored = () => (worker.storage.vocabulary as VocabularyV2).languages;

describe("word identity and durable history", () => {
  it("normalizes Unicode, case, punctuation and internal apostrophes", () => {
    expect(wordKey("Hello,")).toBe("hello");
    expect(wordKey("Coração!")).toBe("coração");
    expect(wordKey("DON’T")).toBe("don't");
    expect(wordKey("cafe\u0301")).toBe("café");
    expect(wordKey("...")).toBe("");
  });
  it("waits for initial stored history even when the first cue arrives early", async () => {
    worker.storage.vocabulary = { en: { seen: ["hello"], marks: {} } };
    const store = create();
    expect([...await store.observeLine("Hello world", "en", "first")]).toEqual(["world"]);
  });
  it("is new only once, and reuses the result for a rerender of the same occurrence", async () => {
    const store = create();
    expect([...await store.observeLine("Hello, HELLO world!", "en", "one")]).toEqual(["hello", "world"]);
    expect([...await store.observeLine("Hello, HELLO world!", "en", "one")]).toEqual(["hello", "world"]);
    expect((await store.observeLine("hello WORLD", "en", "two")).size).toBe(0);
    expect([...await store.observeLine("Hello there.", "en")]).toEqual(["there"]);
  });
  it("preserves token boundaries and ignores punctuation-only tokens", async () => {
    const store = create();
    expect([...await store.observeLine("- ♪ ... 123 don't word—other well-known", "en")]).toEqual(["don't", "word", "other", "well-known"]);
  });
  it("keeps languages apart", async () => {
    const store = create();
    await store.observeLine("a casa", "pt-BR");
    expect([...await store.observeLine("a house", "en")]).toEqual(["a", "house"]);
  });
  it("survives client and worker restart without a delayed flush", async () => {
    const store = create();
    await store.observeLine("Hello world", "en");
    await store.setMark("hello", "en", "difficult");
    store.dispose(); worker.restart();
    const restored = create(); await restored.ready;
    expect(restored.getMark("hello", "en")).toBe("difficult");
    expect((await restored.observeLine("Hello world", "en")).size).toBe(0);
  });
});

describe("confirmed personal marks", () => {
  it("sets, replaces, reads and removes a normalized mark while retaining seen", async () => {
    const store = create(); await store.ready;
    await store.setMark("Hello", "en", "difficult");
    expect(store.getMark("HELLO,", "en")).toBe("difficult");
    expect(store.getMark("Hello", "pt-BR")).toBeNull();
    await store.setMark("hello", "en", "learned");
    expect(store.getMark("hello", "en")).toBe("learned");
    await store.setMark("hello", "en", null);
    expect(store.getMark("hello", "en")).toBeNull();
    expect(stored().en.seen).toEqual(["hello"]);
    expect(stored().en.details).toEqual({});
  });
  it("migrates legacy marks and drops malformed values", async () => {
    worker.storage.vocabulary = { en: { seen: [1, "ok", "", null], marks: { a: "bogus", b: "marked", fear: "difficult" } }, broken: 5 };
    const store = create(); await store.ready;
    expect([...await store.observeLine("ok fine", "en")]).toEqual(["fine"]);
    expect(store.getMark("b", "en")).toBe("learned");
    expect(store.getMark("a", "en")).toBeNull();
    expect(store.getMark("Fear", "en")).toBe("difficult");
  });
  it("does not announce a failed mark and permits retry", async () => {
    const store = create(); await store.ready;
    await store.setMark("hello", "en", "difficult");
    worker.failNextWrite();
    await expect(store.setMark("hello", "en", "learned")).rejects.toThrow();
    expect(store.getMark("hello", "en")).toBe("difficult");
    await store.setMark("hello", "en", "learned");
    expect(store.getMark("hello", "en")).toBe("learned");
  });
  it("retries failed seen history with the next useful cue", async () => {
    const store = create(); await store.ready;
    worker.failNextWrite();
    await expect(store.observeLine("hello", "en", "one")).rejects.toThrow();
    await store.observeLine("world", "en", "two");
    expect(new Set(stored().en.seen)).toEqual(new Set(["hello", "world"]));
  });
});

describe("several tabs", () => {
  it("preserves simultaneous different marks and serializes first appearances", async () => {
    const a = create(), b = create(); await Promise.all([a.ready, b.ready]);
    await Promise.all([a.setMark("one", "en", "difficult"), b.setMark("two", "en", "learned")]);
    expect(stored().en.marks).toEqual({ one: "difficult", two: "learned" });
    const observations = await Promise.all([a.observeLine("new", "en", "a"), b.observeLine("new", "en", "b")]);
    expect(observations.map(set => set.size)).toEqual([1, 0]);
  });
  it("keeps the latest confirmed choice and propagates removals without resurrection", async () => {
    const a = create(), b = create(); await Promise.all([a.ready, b.ready]);
    const change = vi.fn(); a.onChange(change);
    await Promise.all([a.setMark("hello", "en", "difficult"), b.setMark("hello", "en", "learned")]);
    expect(a.getMark("hello", "en")).toBe("learned");
    await b.setMark("hello", "en", null);
    expect(a.getMark("hello", "en")).toBeNull();
    expect(change).toHaveBeenCalled();
    a.dispose(); change.mockClear();
    await b.setMark("other", "en", "difficult");
    expect(change).not.toHaveBeenCalled();
  });
});
