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

describe("backups and starting over", () => {
  type Backup = { format: string; version: number; vocabulary: VocabularyV2; phrases: unknown[]; settings: Record<string, unknown> };
  const exportNow = async () => (await requestStudy<Backup>("export")).data;

  async function seedProfile() {
    await requestStudy("patch-settings", { patch: { level: "B1", autoPause: true } });
    await requestStudy("observe", { language: "en", keys: ["hello", "world"], occurrenceId: "1" });
    await requestStudy("set-mark", { language: "en", word: "world", mark: "difficult" });
    await PhraseRepository.save(phrase());
  }

  it("exports the seen history, marks, phrases and preferences in one file", async () => {
    await seedProfile();

    const backup = await exportNow();

    expect(backup).toMatchObject({ format: "streamfluent-backup", version: 1, settings: { level: "B1", autoPause: true } });
    expect(new Set(backup.vocabulary.languages.en.seen)).toEqual(new Set(["hello", "world"]));
    expect(backup.vocabulary.languages.en.marks).toEqual({ world: "difficult" });
    expect(backup.phrases).toHaveLength(1);
  });

  it("restores everything into a fresh install, then reports nothing new on a second import", async () => {
    await seedProfile();
    const backup = await exportNow();
    worker = installStudyWorker();

    const first = await requestStudy<{ words: number; marks: number; phrases: number }>("import", { backup });
    const second = await requestStudy<{ words: number; marks: number; phrases: number }>("import", { backup });

    expect(first.data).toEqual({ words: 2, marks: 1, phrases: 1 });
    expect(second.data).toEqual({ words: 0, marks: 0, phrases: 0 });
    expect((worker.storage.vocabulary as VocabularyV2).languages.en.marks).toEqual({ world: "difficult" });
    expect(worker.storage.settings).toMatchObject({ level: "B1", autoPause: true });
    const fresh = await requestStudy<{ freshKeys: string[] }>("observe", { language: "en", keys: ["hello", "new"], occurrenceId: "2" });
    expect(fresh.data.freshKeys).toEqual(["new"]);
  });

  it("keeps the most recent choice of each word when merging", async () => {
    await requestStudy("set-mark", { language: "en", word: "old", mark: "difficult" });
    await requestStudy("set-mark", { language: "en", word: "new", mark: "difficult" });
    const backup = await exportNow();
    const later = new Date(Date.now() + 60_000).toISOString();
    const earlier = "2020-01-01T00:00:00.000Z";
    backup.vocabulary.languages.en.marks = { old: "learned", new: "learned", extra: "learned" };
    backup.vocabulary.languages.en.details = {
      old: { displayWord: "old", markedAt: earlier, updatedAt: earlier },
      new: { displayWord: "new", markedAt: later, updatedAt: later },
      extra: { displayWord: "extra", markedAt: null, updatedAt: null },
    };

    await requestStudy("import", { backup });

    expect((worker.storage.vocabulary as VocabularyV2).languages.en.marks).toEqual({ old: "difficult", new: "learned", extra: "learned" });
  });

  it("adds only phrases it does not have, giving a clashing id a new one", async () => {
    const mine = await PhraseRepository.save(phrase());
    const backup = await exportNow();
    backup.phrases = [
      { ...(backup.phrases[0] as object) },
      { ...(backup.phrases[0] as object), sentence: "Another line" },
    ];

    const result = await requestStudy<{ phrases: number }>("import", { backup });

    expect(result.data.phrases).toBe(1);
    const all = await PhraseRepository.getAll();
    expect(all.map((item) => item.sentence)).toEqual(["Hello\nworld", "Another line"]);
    expect(all[1].id).not.toBe(mine.id);
  });

  it("refuses an unknown file, version or future schema without changing anything", async () => {
    await seedProfile();
    const backup = await exportNow();
    const before = structuredClone(worker.storage);

    await expect(requestStudy("import", { backup: { ...backup, format: "other" } })).rejects.toThrow();
    await expect(requestStudy("import", { backup: { ...backup, version: 2 } })).rejects.toThrow(/Versão de backup/);
    await expect(requestStudy("import", { backup: { ...backup, vocabulary: { schemaVersion: 9, languages: {} } } })).rejects.toThrow();

    expect(worker.storage).toEqual(before);
  });

  it("forgets only the seen history, or every study item while keeping preferences", async () => {
    await seedProfile();

    await requestStudy("reset-seen");
    expect(await worker.seen.all()).toEqual({});
    expect((worker.storage.vocabulary as VocabularyV2).languages.en.marks).toEqual({ world: "difficult" });
    expect(worker.storage.phrases).toHaveLength(1);

    await requestStudy("observe", { language: "en", keys: ["hello"], occurrenceId: "3" });
    await requestStudy("reset-all");
    expect(await worker.seen.all()).toEqual({});
    expect((worker.storage.vocabulary as VocabularyV2).languages).toEqual({});
    expect(worker.storage.phrases).toEqual([]);
    expect(worker.storage.settings).toMatchObject({ level: "B1", autoPause: true });
  });

  it("keeps the seen history when wiping marks and phrases failed", async () => {
    await seedProfile();
    worker.failNextWrite();

    await expect(requestStudy("reset-all")).rejects.toThrow();

    expect((await worker.seen.all()).en).toHaveLength(2);
    expect(worker.storage.phrases).toHaveLength(1);
  });

  it("round-trips: export, start over, import gives the same study data back", async () => {
    await seedProfile();
    const backup = await exportNow();

    await requestStudy("reset-all");
    await requestStudy("import", { backup });
    const again = await exportNow();

    expect(again.vocabulary.languages.en.marks).toEqual(backup.vocabulary.languages.en.marks);
    expect(new Set(again.vocabulary.languages.en.seen)).toEqual(new Set(backup.vocabulary.languages.en.seen));
    expect(again.phrases).toEqual(backup.phrases);
  });
});
