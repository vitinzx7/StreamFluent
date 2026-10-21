import { describe, expect, it } from "vitest";
import { emptyDocument, importDocument, localVocabulary, makeBackup, mergeDocuments, parseBackup, studyDocument, validateDocument } from "../core/study-document.ts";
const marked = (mark: "difficult" | "learned") => studyDocument({ vocabulary: { en: { seen: ["private", "hello"], marks: { hello: mark } } } });
const phrase = (id: string, sentence: string) => ({ id, kind: "sentence", sentence, sourceLanguage: "en", targetLanguage: "pt-BR", platform: "Netflix", mediaTitle: "Test", season: 1, episode: 1, createdAt: "2026-10-20T00:00:00.000Z" });
describe("account document and backup", () => {
  it("exports only marked vocabulary, no session or observation history", () => {
    const doc = marked("difficult");
    expect(doc.vocabulary.languages.en.seen).toEqual(["hello"]);
    expect(parseBackup(makeBackup(doc))).toEqual(doc);
    expect(localVocabulary({ en: { seen: ["private"], marks: {} } }, doc).languages.en.seen).toContain("private");
  });
  it("rejects future schemas, damaged documents and unknown fields", () => {
    expect(() => validateDocument({ ...emptyDocument(), schemaVersion: 2 })).toThrow();
    expect(() => validateDocument({ ...emptyDocument(), phrases: [{ sentence: false }] })).toThrow();
    expect(() => validateDocument({ ...emptyDocument(), session: "secret" })).toThrow();
    expect(() => parseBackup("x")).toThrow();
    expect(() => parseBackup(" ".repeat(4 * 1024 * 1024 + 1))).toThrow();
  });
  it("combines independent additions on two devices and restores a new installation", () => {
    const a = studyDocument({ phrases: [phrase("a", "a")] }), b = studyDocument({ phrases: [phrase("b", "b")] });
    expect(mergeDocuments(emptyDocument(), a, b).document.phrases).toHaveLength(2);
    expect(mergeDocuments(emptyDocument(), emptyDocument(), b).document).toEqual(b);
  });
  it("propagates remote deletion, preserves offline addition and reports delete/edit conflict", () => {
    const base = marked("difficult"), deleted = emptyDocument(), edited = marked("learned");
    expect(mergeDocuments(base, base, deleted).document.vocabulary.languages).toEqual({});
    const result = mergeDocuments(base, edited, deleted);
    expect(result.conflicts).toHaveLength(1);
    expect(result.document).toEqual(edited);
    expect(mergeDocuments(base, edited, deleted, { "word:en:hello": "remote" }).document).toEqual(deleted);
  });
  it("does not use device timestamps to pick a winner", () => {
    const base = marked("difficult"), local = marked("learned"), remote = marked("learned");
    remote.vocabulary.languages.en.details.hello.updatedAt = "2026-10-21T00:00:00.000Z";
    expect(mergeDocuments(base, local, remote).conflicts).toHaveLength(1);
  });
  it("treats the same phrase saved independently as one item, with stable server ID", () => {
    const local = studyDocument({ phrases: [phrase("a", "same")] }), remote = studyDocument({ phrases: [phrase("b", "same")] });
    const result = mergeDocuments(emptyDocument(), local, remote);
    expect(result.conflicts).toHaveLength(0); expect(result.document.phrases[0].id).toBe("b");
  });
  it("imports additively and keeps conflicts local without dropping existing phrases", () => {
    const local = marked("learned"), incoming = marked("difficult");
    local.settings.autoPause = true;
    const result = importDocument(local, incoming, false);
    expect(result.document).toEqual(local); expect(result.conflicts).toHaveLength(1);
  });
});
