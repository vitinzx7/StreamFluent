import { beforeEach, describe, expect, it, vi } from "vitest";
import { installStudyWorker } from "./helpers/study-worker.ts";
import { createAccountService, ACCOUNT_KEY } from "../core/account-service.ts";
import type { AccountRemote, RemoteDocument } from "../core/account-remote.ts";
import { emptyDocument, makeBackup, studyDocument, type StudyDocument } from "../core/study-document.ts";
import { requestStudy } from "../core/study-messages.ts";
const owner = { id: "user-a", email: "a@example.test" };
function cloud() {
  let data: RemoteDocument | null = null;
  const remote: AccountRemote = {
    user: vi.fn(async () => owner), signIn: vi.fn(async () => owner), signUp: vi.fn(async () => {}), signOut: vi.fn(async () => {}),
    read: vi.fn(async () => structuredClone(data)),
    write: vi.fn(async (revision, document) => {
      if ((data?.revision ?? 0) !== revision) return null;
      data = { revision: revision + 1, document: structuredClone(document) }; return data.revision;
    }),
  };
  return { remote, get data() { return data; }, set data(value) { data = value; } };
}
let worker: ReturnType<typeof installStudyWorker>;
let server: ReturnType<typeof cloud>;
let account: ReturnType<typeof createAccountService>;
const sender = () => ({ id: chrome.runtime.id, url: chrome.runtime.getURL("account.html"), frameId: 0 });
function setup(initial: Record<string, unknown> = {}) {
  worker = installStudyWorker(initial);
  chrome.runtime.getURL = p => `chrome-extension://${chrome.runtime.id}/${p}`;
  account = createAccountService(worker.service, server.remote, worker.local as unknown as chrome.storage.LocalStorageArea);
}
async function call(action: string, payload: Record<string, unknown> = {}) {
  const result = await account.handle({ type: `sf:account:${action}`, requestId: crypto.randomUUID(), payload }, sender());
  if (!result.ok) throw new Error(result.error);
  return result.data as Record<string, unknown>;
}
const login = () => call("sign-in", { email: owner.email, password: "example-password" });
const enable = () => call("enable", { consent: true });
const mark = (value: "difficult" | "learned" | null, word = "hello") => requestStudy("set-mark", { language: "en", word, mark: value });
beforeEach(() => { server = cloud(); setup(); });
describe("optional account sync through the serialized study service", () => {
  it("never contacts the server by default, and login alone does not upload", async () => {
    await account.sync(); await call("status"); await mark("difficult"); await call("export");
    expect(server.remote.user).not.toHaveBeenCalled(); expect(server.remote.write).not.toHaveBeenCalled();
    await login(); expect(server.remote.write).not.toHaveBeenCalled();
    await expect(call("enable", { consent: false })).rejects.toThrow();
    expect(server.remote.write).not.toHaveBeenCalled();
  });
  it("saves offline first, uploads on consent and restores on a fresh installation", async () => {
    await mark("difficult"); await login(); await enable();
    expect(server.data?.document.vocabulary.languages.en.marks.hello).toBe("difficult");
    expect((await call("status")).synchronized).toBe(true);
    setup(); await login(); await enable();
    expect((await requestStudy<{ vocabulary: StudyDocument["vocabulary"] }>("read")).data.vocabulary.languages.en.marks.hello).toBe("difficult");
  });
  it("retains local changes and baseline after network failure, and retries", async () => {
    await login(); await enable(); await mark("difficult");
    vi.mocked(server.remote.read).mockRejectedValueOnce(new Error("offline"));
    await account.sync();
    expect((await call("status")).synchronized).toBe(false);
    expect(worker.storage.vocabulary).toMatchObject({ languages: { en: { marks: { hello: "difficult" } } } });
    await account.sync(); expect((await call("status")).synchronized).toBe(true);
  });
  it("propagates deletion from another device and preserves unmarked seen history", async () => {
    await mark("difficult"); await login(); await enable();
    await requestStudy("observe", { language: "en", keys: ["private"], occurrenceId: "one" });
    server.data = { revision: 2, document: emptyDocument() }; await account.sync();
    const local = worker.storage.vocabulary as StudyDocument["vocabulary"];
    expect(local.languages.en.marks.hello).toBeUndefined(); expect(local.languages.en.seen).toContain("private");
  });
  it("requires conflict choices, rejects stale choices and applies a current explicit choice", async () => {
    await mark("difficult"); await login(); await enable(); await mark("learned");
    server.data = { revision: 2, document: emptyDocument() }; await account.sync();
    const first = await call("status"); expect(first.conflictCount).toBe(1);
    await account.sync(); expect((await call("status")).conflictToken).toBe(first.conflictToken);
    expect(server.data.document.vocabulary.languages).toEqual({});
    await mark("difficult", "other");
    const stale = await call("sync", { choices: { "word:en:hello": "remote" }, token: first.conflictToken });
    expect(stale.error).toMatch(/mudaram/);
    await account.sync(); const current = await call("status");
    await call("sync", { choices: { "word:en:hello": "remote" }, token: current.conflictToken });
    expect((await call("status")).synchronized).toBe(true);
    expect(server.data?.document.vocabulary.languages.en.marks).toEqual({ other: "difficult" });
  });
  it("does not lose a local save while a cloud upload is in flight", async () => {
    await login(); await enable(); await mark("difficult");
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>(r => { started = r; });
    const wait = new Promise<void>(r => { release = r; });
    const original = server.remote.write;
    vi.mocked(server.remote.write).mockImplementationOnce(async (r, d) => { started(); await wait; return original(r, d); });
    const flight = account.sync(); await ready; await mark("learned", "other"); release(); await flight;
    expect((await call("status")).synchronized).toBe(false);
    expect((worker.storage.vocabulary as StudyDocument["vocabulary"]).languages.en.marks.other).toBe("learned");
    await account.sync(); expect(server.data?.document.vocabulary.languages.en.marks.other).toBe("learned");
  });
  it("re-reads after a CAS race and never does an unconditional overwrite", async () => {
    await login(); await enable(); await mark("difficult");
    vi.mocked(server.remote.write).mockImplementationOnce(async () => {
      const document = studyDocument({ vocabulary: { en: { seen: [], marks: { other: "learned" } } } });
      server.data = { revision: 2, document }; return null;
    });
    await account.sync(); expect(server.data?.document.vocabulary.languages.en.marks).toEqual({ hello: "difficult", other: "learned" });
  });
  it("does not mix accounts or delete cloud data on logout", async () => {
    await mark("difficult"); await login(); await enable(); const before = structuredClone(server.data);
    await call("sign-out"); await account.sync(); expect(server.data).toEqual(before);
    vi.mocked(server.remote.signIn).mockResolvedValueOnce({ id: "user-b", email: "b@example.test" });
    await expect(call("sign-in", { email: "b@example.test", password: "example-password" })).rejects.toThrow(/outra conta/);
    expect(server.data).toEqual(before);
  });
  it("serializes authentication against a background sync so another account cannot receive its data", async () => {
    await login(); await enable(); await mark("difficult");
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>(r => { started = r; }), wait = new Promise<void>(r => { release = r; });
    const original = server.remote.write;
    vi.mocked(server.remote.write).mockImplementationOnce(async (r, d) => { started(); await wait; return original(r, d); });
    const flight = account.sync(); await ready;
    const count = vi.mocked(server.remote.signIn).mock.calls.length;
    const signing = login(); await Promise.resolve(); await Promise.resolve();
    expect(server.remote.signIn).toHaveBeenCalledTimes(count);
    release(); await flight; await signing;
    expect(server.remote.signIn).toHaveBeenCalledTimes(count + 1);
  });
  it("keeps the merge baseline across worker restart and still recognizes delete/edit conflicts", async () => {
    await mark("difficult"); await login(); await enable(); await mark("learned");
    const saved = structuredClone(worker.storage);
    server.data = { revision: 2, document: emptyDocument() };
    setup(saved); await account.sync();
    expect((await call("status")).conflictCount).toBe(1);
    expect((worker.storage.vocabulary as StudyDocument["vocabulary"]).languages.en.marks.hello).toBe("learned");
  });
  it("recovers when the server commits but its response is lost", async () => {
    await login(); await enable(); await mark("difficult");
    const original = server.remote.write;
    vi.mocked(server.remote.write).mockImplementationOnce(async (r, d) => { await original(r, d); throw new Error("response lost"); });
    await account.sync(); expect((await call("status")).synchronized).toBe(false);
    const revision = server.data!.revision;
    await account.sync(); expect(server.data!.revision).toBe(revision);
    expect((await call("status")).synchronized).toBe(true);
  });
  it("recovers without a false success if local persistence fails after a cloud commit", async () => {
    await login(); await enable(); await mark("difficult");
    const original = server.remote.write;
    vi.mocked(server.remote.write).mockImplementationOnce(async (r, d) => { const result = await original(r, d); worker.failNextWrite(); return result; });
    await account.sync(); expect((await call("status")).synchronized).toBe(false);
    expect((worker.storage.vocabulary as StudyDocument["vocabulary"]).languages.en.marks.hello).toBe("difficult");
    await account.sync(); expect((await call("status")).synchronized).toBe(true);
  });
  it("validates backup and imports without silently replacing local conflicts", async () => {
    await mark("learned"); const incoming = studyDocument({ vocabulary: { en: { seen: [], marks: { hello: "difficult", other: "learned" } } } });
    const result = await call("import", { text: makeBackup(incoming), includeSettings: false });
    expect(result.keptLocalConflicts).toBe(1);
    expect((worker.storage.vocabulary as StudyDocument["vocabulary"]).languages.en.marks).toEqual({ hello: "learned", other: "learned" });
    const before = structuredClone(worker.storage);
    await expect(call("import", { text: '{"version":99}', includeSettings: true })).rejects.toThrow();
    expect(worker.storage).toEqual(before);
    expect((await call("export")).backup).not.toMatch(/password|access_token|refresh_token|sfAccount/);
  });
  it("rejects content scripts, other pages, frames and external extension senders", async () => {
    for (const patch of [{ url: "https://www.netflix.com/watch/1" }, { url: chrome.runtime.getURL("library.html") }, { frameId: 4 }, { id: "evil" }]) {
      const result = await account.handle({ type: "sf:account:export", requestId: "id", payload: {} }, { ...sender(), ...patch });
      expect(result.ok).toBe(false);
    }
  });
  it("does not report an import saved if persistence fails and preserves future metadata", async () => {
    worker.failNextWrite();
    await expect(call("import", { text: makeBackup(emptyDocument()), includeSettings: false })).rejects.toThrow();
    expect(worker.storage).toEqual({});
    setup({ [ACCOUNT_KEY]: { version: 99 } });
    await expect(call("status")).rejects.toThrow(/incompatível/);
    expect(worker.storage[ACCOUNT_KEY]).toEqual({ version: 99 });
  });
});
