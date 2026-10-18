import { beforeEach, describe, expect, it, vi } from "vitest";
import { installStudyWorker } from "./helpers/study-worker.ts";
import { requestStudy } from "../core/study-messages.ts";
import { normalizeVocabulary, normalizePhrases } from "../core/study-data.ts";
import { createStudyStorageService, isStudySender } from "../core/study-storage.ts";
import { PhraseRepository } from "../core/storage.ts";
import type { SavedPhraseInput, VocabularyV2 } from "../core/types.ts";
let worker: ReturnType<typeof installStudyWorker>;
beforeEach(() => { worker = installStudyWorker(); });
const phrase = (patch: Partial<SavedPhraseInput> = {}): SavedPhraseInput => ({
  kind: "sentence", sentence: "Hello\nworld", sourceLanguage: "en", targetLanguage: "pt-BR",
  platform: "Netflix", mediaTitle: "Test", season: 1, episode: 2, ...patch,
} as SavedPhraseInput);

describe("study migration", () => {
  it("normalizes collisions, prefers difficult and migrates without inventing dates", () => {
    const raw = { en: { seen: ["Hello", "HELLO,", "DON’T", "don't"], marks: { "HELLO": "marked", "hello,": "difficult", "Don’t": "marked" } } };
    const result = normalizeVocabulary(raw);
    expect(result.languages.en.seen).toEqual(["hello", "don't"]);
    expect(result.languages.en.marks).toEqual({ hello: "difficult", "don't": "learned" });
    expect(result.languages.en.details.hello).toEqual({ displayWord: "hello", markedAt: null, updatedAt: null });
    expect(normalizeVocabulary(result)).toEqual(result);
    expect(raw.en.marks.HELLO).toBe("marked");
  });
  it("preserves valid legacy phrase IDs/dates, unknown languages and recovers sentences", () => {
    const result = normalizePhrases([
      { id: "old", sentence: "original", selectedWord: "word", createdAt: "2020-01-01T00:00:00.000Z" },
      { sentence: "recoverable" }, { sentence: false }, null,
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "old", kind: "word", sourceLanguage: null, targetLanguage: null, createdAt: "2020-01-01T00:00:00.000Z" });
    expect(result[1]).toMatchObject({ kind: "sentence", sentence: "recoverable", createdAt: "" });
    expect(normalizePhrases(result)).toEqual(result);
  });
  it("commits migration atomically, preserves legacy on failure, and is idempotent", async () => {
    worker.storage.vocabulary = { en: { seen: [], marks: { hello: "marked" } } };
    worker.storage.settings = { direction: "pt-en", subtitleBottom: 53, highlightNewWords: false };
    const before = structuredClone(worker.storage);
    worker.failNextWrite();
    await expect(requestStudy("read")).rejects.toThrow();
    expect(worker.storage).toEqual(before);
    await requestStudy("read");
    expect(worker.storage.settings).toMatchObject({ direction: "pt-en", subtitleBottom: 53, highlightNewWords: false, highlightSpecialWords: false, autoPause: false });
    const count = worker.local.set.mock.calls.length;
    await requestStudy("read"); worker.restart(); await requestStudy("read");
    expect(worker.local.set).toHaveBeenCalledTimes(count);
  });
  it("refuses unknown future schemas and never overwrites them", async () => {
    worker.storage.vocabulary = { schemaVersion: 3, languages: { future: true } };
    await expect(requestStudy("patch-settings", { patch: { autoPause: true } })).rejects.toThrow(/Versão/);
    expect(worker.local.set).not.toHaveBeenCalled();
    expect(worker.storage.vocabulary).toMatchObject({ schemaVersion: 3 });
  });
  it("keeps prototype-like word keys as own data without inherited marks", () => {
    const input = JSON.parse('{"en":{"seen":["constructor"],"marks":{"constructor":"marked","__proto__":"difficult"}}}');
    const result = normalizeVocabulary(input);
    expect(Object.prototype.hasOwnProperty.call(result.languages.en.marks, "constructor")).toBe(true);
    expect(result.languages.en.marks.constructor).toBe("learned");
    expect(Object.getPrototypeOf(result.languages.en.marks)).toBeNull();
  });
});

describe("serialized operations", () => {
  it("saves concurrent phrases, deduplicates equivalents and preserves first date", async () => {
    const [a, b] = await Promise.all([PhraseRepository.saveResult(phrase()), PhraseRepository.saveResult(phrase({ sentence: "Hello world", timeSeconds: 35 }))]);
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true);
    expect(b.phrase.id).toBe(a.phrase.id); expect(b.phrase.createdAt).toBe(a.phrase.createdAt);
    expect(await PhraseRepository.count()).toBe(1);
    await PhraseRepository.save(phrase({ episode: 3 }));
    await PhraseRepository.save(phrase({ sourceLanguage: null, targetLanguage: null }));
    await PhraseRepository.save(phrase({ sentence: "hello world" }));
    await PhraseRepository.save({ ...phrase(), kind: "word", selectedWord: "world" });
    expect(await PhraseRepository.count()).toBe(5);
  });
  it("preserves marks and settings when removing or clearing phrases", async () => {
    const saved = await PhraseRepository.save(phrase());
    await requestStudy("set-mark", { language: "en", word: "world", mark: "difficult" });
    await PhraseRepository.remove(saved.id); await PhraseRepository.clear();
    expect((worker.storage.vocabulary as VocabularyV2).languages.en.marks.world).toBe("difficult");
    expect(worker.storage.settings).toBeDefined();
    await requestStudy("set-mark", { language: "en", word: "world", mark: null });
    expect((await worker.seen.all()).en).toContain("world");
  });
  it("is idempotent for identical marks and retains details when changing status", async () => {
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult", details: { translation: "olá", displayWord: "Hello" } });
    const first = structuredClone((worker.storage.vocabulary as VocabularyV2).languages.en.details.hello);
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult" });
    expect((worker.storage.vocabulary as VocabularyV2).languages.en.details.hello).toEqual(first);
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "learned" });
    expect((worker.storage.vocabulary as VocabularyV2).languages.en.details.hello).toMatchObject({ translation: "olá", displayWord: "Hello", markedAt: first.markedAt });
  });
  it("continues the queue after rejection and recovers confirmed data on restart", async () => {
    await requestStudy("read"); worker.failNextWrite();
    const bad = PhraseRepository.save(phrase());
    const good = PhraseRepository.save(phrase({ sentence: "Second" }));
    await expect(bad).rejects.toThrow(); await good;
    worker.restart();
    expect((await PhraseRepository.getAll()).map(p => p.sentence)).toEqual(["Second"]);
  });
  it("returns success only after storage.set resolves", async () => {
    let finish!: () => void;
    worker.local.set.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const resolved = vi.fn();
    const pending = requestStudy("read").then(resolved);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(resolved).not.toHaveBeenCalled(); finish(); await pending;
    expect(resolved).toHaveBeenCalledOnce();
  });
});

describe("local protocol boundary", () => {
  it("accepts only extension pages and explicitly admitted content-script documents", () => {
    const base = { id: chrome.runtime.id, frameId: 0, tab: { id: 3 } as chrome.tabs.Tab };
    expect(isStudySender({ ...base, url: "https://www.netflix.com/watch/1" })).toBe(true);
    expect(isStudySender({ ...base, url: "https://www.netflix.com.evil.example/watch/1" })).toBe(false);
    expect(isStudySender({ ...base, frameId: 5, url: "https://www.netflix.com/watch/1" })).toBe(false);
    expect(isStudySender({ ...base, frameId: 5, url: "https://cinextream.cc/player", documentId: "document-id" })).toBe(true);
    expect(isStudySender({ ...base, id: "other", url: "https://www.netflix.com/watch/1" })).toBe(false);
    expect(isStudySender({ ...base, url: `chrome-extension://${chrome.runtime.id}/library.html?tab=difficult` })).toBe(true);
  });
  it("rejects invalid actions, enums, times, payload keys and malformed requests before writing", async () => {
    const service = createStudyStorageService();
    const sender = { id: chrome.runtime.id, url: `chrome-extension://${chrome.runtime.id}/library.html` };
    for (const [action, payload] of [
      ["set-mark", { word: "hello", language: "en", mark: "special" }],
      ["patch-settings", { patch: { autoPause: "yes" } }],
      ["patch-settings", { patch: { subtitleBottom: Infinity } }],
      ["observe", { language: "en", keys: ["hello"], occurrenceId: "", injected: true }],
      ["save-phrase", { phrase: phrase({ timeSeconds: NaN }) }],
      ["run-code", {}],
    ]) expect((await service.handle({ type: `sf:study:${action}`, requestId: "id", payload }, sender)).ok).toBe(false);
    expect(worker.local.set).not.toHaveBeenCalled();
  });
});

describe("seen history outside chrome.storage", () => {
  it("moves a legacy history into the seen store, keeping marks, and never writes it back", async () => {
    worker.storage.vocabulary = { en: { seen: ["hello", "world"], marks: { world: "marked" } }, "pt-BR": { seen: ["olá"], marks: {} } };

    const { data } = await requestStudy<{ vocabulary: VocabularyV2 }>("read");

    expect(await worker.seen.all()).toEqual({ en: ["hello", "world"], "pt-BR": ["olá"] });
    expect(data.vocabulary.languages.en).toMatchObject({ seen: [], marks: { world: "learned" } });
    expect((worker.storage.vocabulary as VocabularyV2).languages.en.seen).toEqual([]);
    const fresh = await requestStudy<{ freshKeys: string[] }>("observe", { language: "en", keys: ["hello", "again"], occurrenceId: "1" });
    expect(fresh.data.freshKeys).toEqual(["again"]);
    expect((worker.storage.vocabulary as VocabularyV2).languages.en.seen).toEqual([]);
  });

  it("keeps the legacy history in storage when the migration write fails, and finishes later", async () => {
    worker.storage.vocabulary = { en: { seen: ["hello"], marks: {} } };
    worker.failNextWrite();

    await expect(requestStudy("read")).rejects.toThrow();
    expect((worker.storage.vocabulary as { en: { seen: string[] } }).en.seen).toEqual(["hello"]);
    expect((await worker.seen.all()).en).toEqual(["hello"]);

    await requestStudy("read");
    expect((worker.storage.vocabulary as VocabularyV2).languages.en.seen).toEqual([]);
  });

  it("answers a subtitle line without touching chrome.storage once migrated", async () => {
    await requestStudy("read");
    const reads = worker.local.get.mock.calls.length;
    const writes = worker.local.set.mock.calls.length;

    for (let i = 0; i < 20; i++) {
      await requestStudy("observe", { language: "en", keys: ["word", `new${"x".repeat(i + 1)}`], occurrenceId: String(i) });
    }

    expect(worker.local.get.mock.calls.length).toBe(reads);
    expect(worker.local.set.mock.calls.length).toBe(writes);
    expect((await worker.seen.all()).en).toHaveLength(21);
  });

  it("reads storage again after a worker restart before trusting its fast path", async () => {
    await requestStudy("read");
    worker.restart();
    worker.storage.vocabulary = { en: { seen: ["legacy"], marks: {} } };

    const fresh = await requestStudy<{ freshKeys: string[] }>("observe", { language: "en", keys: ["legacy"], occurrenceId: "1" });

    expect(fresh.data.freshKeys).toEqual([]);
  });
});
