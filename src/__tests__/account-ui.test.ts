// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import html from "../../public/account.html?raw";
import type { Conflict } from "../core/study-document.ts";
import { requestStudy } from "../core/study-messages.ts";
import { installStudyWorker } from "./helpers/study-worker.ts";
interface TestStatus { email: string; signedIn: boolean; enabled: boolean; synchronized: boolean; syncing: boolean; error: string | null; lastSyncedAt: string | null; conflictCount: number; conflictToken: string | null; conflicts: Conflict[] }
const initial: TestStatus = { email: "", signedIn: false, enabled: false, synchronized: false, syncing: false, error: null, lastSyncedAt: null, conflictCount: 0, conflictToken: null, conflicts: [] };
let state = { ...initial };
let handler: (action: string, payload: Record<string, unknown>) => unknown;
let sendMessage: ReturnType<typeof vi.fn>;
let worker: ReturnType<typeof installStudyWorker>;
const tick = () => new Promise(r => setTimeout(r, 0));
beforeEach(async () => {
  vi.resetModules(); state = { ...initial };
  document.documentElement.innerHTML = html.replace(/<script[^>]*><\/script>/g, "");
  handler = action => action === "status" ? state : {};
  // Account messages get a scripted reply; study messages (backup, resets) reach a real study queue.
  worker = installStudyWorker();
  const study = worker.sendMessage;
  sendMessage = vi.fn(async (message: { type: string; requestId: string; payload: Record<string, unknown> }) => {
    if (!message.type.startsWith("sf:account:")) return study(message);
    try { return { ok: true, requestId: message.requestId, data: await handler(message.type.slice("sf:account:".length), message.payload) }; }
    catch (error) { return { ok: false, requestId: message.requestId, error: (error as Error).message }; }
  });
  vi.stubGlobal("chrome", { ...chrome, runtime: { ...chrome.runtime, sendMessage }, storage: { ...chrome.storage, onChanged: { addListener: vi.fn() } } });
  await import("../account/account.ts"); await tick();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("account page controlled DOM", () => {
  it("shows device-only state without initiating login, sync or a network request", () => {
    expect(document.getElementById("state")?.textContent).toMatch(/dispositivo.*desativada/);
    expect(sendMessage.mock.calls.map(([m]) => m.type)).toEqual(["sf:account:status"]);
  });
  it("clears the password and does not enable sync after login", async () => {
    const email = document.getElementById("email") as HTMLInputElement, password = document.getElementById("password") as HTMLInputElement;
    email.value = "a@example.test"; password.value = "example-password";
    handler = action => { if (action === "sign-in") state = { ...initial, signedIn: true, email: email.value }; return action === "status" ? state : {}; };
    document.getElementById("login")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await tick(); await tick();
    expect(password.value).toBe("");
    expect(sendMessage.mock.calls.map(([m]) => m.type)).not.toContain("sf:account:enable");
    expect(document.getElementById("state")?.textContent).toMatch(/desativada/);
    expect((document.getElementById("consent") as HTMLInputElement).checked).toBe(false);
  });
  it("marks a refused login as an error and clears that mark on the next attempt", async () => {
    (document.getElementById("email") as HTMLInputElement).value = "a@example.test";
    (document.getElementById("password") as HTMLInputElement).value = "example-password";
    handler = action => { if (action === "sign-in") throw new Error("E-mail ou senha incorretos."); return state; };
    const feedback = document.getElementById("feedback")!;
    document.getElementById("login")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await tick(); await tick();
    expect(feedback.textContent).toBe("E-mail ou senha incorretos."); expect(feedback.dataset.kind).toBe("error");
    handler = action => action === "status" ? state : {};
    document.getElementById("login")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(feedback.textContent).toBe("Processando…"); expect(feedback.dataset.kind).toBeUndefined();
  });
  it("never labels a failed sync as synchronized", async () => {
    handler = action => {
      if (action === "enable") state = { ...initial, signedIn: true, enabled: true, error: "Falha de rede" };
      return action === "status" ? state : {};
    };
    document.getElementById("enable")!.click(); await tick(); await tick();
    expect(document.getElementById("state")?.textContent).toMatch(/pendente/);
    expect(document.getElementById("error")?.textContent).toBe("Falha de rede");
  });
  it("renders conflict text literally and requires a choice for every item", async () => {
    const value = '<img src=x onerror="window.exploited=true">';
    handler = action => {
      if (action === "sync") state = { ...initial, signedIn: true, enabled: true, conflictCount: 1, conflictToken: "token", conflicts: [{ key: "word:en:hello", local: value, remote: null }] } as typeof state;
      return action === "status" ? state : {};
    };
    document.getElementById("sync")!.click(); await tick(); await tick();
    expect(document.querySelector("#conflicts img")).toBeNull(); expect(document.querySelector("#conflicts pre")?.textContent).toContain(value.replace(/"/g, '\\"'));
    const count = sendMessage.mock.calls.filter(([m]) => m.type === "sf:account:sync").length;
    document.getElementById("resolve")!.click(); await tick();
    expect(document.getElementById("feedback")?.textContent).toMatch(/cada conflito/);
    expect(sendMessage.mock.calls.filter(([m]) => m.type === "sf:account:sync")).toHaveLength(count);
  });
});

describe("backup and data in the Conta tab", () => {
  const feedback = () => document.getElementById("feedback")!;
  const choose = (file: File) => {
    const input = document.getElementById("import-data") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change"));
  };
  it("exports the complete study backup, named by date, without account data", async () => {
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult" });
    worker.storage.sfAccount = { email: "a@example.test", secret: "session" };
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:backup"; }); URL.revokeObjectURL = vi.fn();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    document.getElementById("export-data")!.click();
    await vi.waitFor(() => expect(feedback().textContent).toContain("Backup exportado"));
    expect(feedback().textContent).toContain("1 marcadas");
    expect(clicked[0].download).toMatch(/^streamfluent-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const text = await blobs[0].text();
    expect(text).toContain("hello"); expect(text).not.toMatch(/sfAccount|example\.test|session/);
  });
  it("imports a backup file and shows what came back", async () => {
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult" });
    const backup = (await requestStudy("export")).data;
    await requestStudy("reset-all");
    choose(new File([JSON.stringify(backup)], "backup.json", { type: "application/json" }));
    await vi.waitFor(() => expect(feedback().textContent).toContain("Backup importado"));
    expect(feedback().textContent).toContain("1 marcações");
    const { data } = await requestStudy<{ vocabulary: { languages: Record<string, { marks: Record<string, string> }> } }>("read");
    expect(data.vocabulary.languages.en.marks).toEqual({ hello: "difficult" });
  });
  it("says so, as an error, when the file is not a backup", async () => {
    choose(new File(["not json"], "notes.txt"));
    await vi.waitFor(() => expect(feedback().textContent).toBe("Esse arquivo não é um backup do StreamFluent."));
    expect(feedback().dataset.kind).toBe("error");
  });
  it("asks before wiping, warns that sync also clears the account, and keeps everything on no", async () => {
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult" });
    state = { ...initial, signedIn: true, enabled: true, email: "a@example.test" };
    document.getElementById("sync")!.click(); await tick(); await tick();
    const confirm = vi.fn(() => false); vi.stubGlobal("confirm", confirm);
    document.getElementById("reset-all")!.click();
    expect(confirm).toHaveBeenCalledOnce(); expect(confirm.mock.calls[0]).toEqual([expect.stringContaining("cópia na conta também será apagada")]);
    const marks = async () => (await requestStudy<{ vocabulary: { languages: Record<string, { marks: Record<string, string> }> } }>("read")).data.vocabulary.languages.en?.marks ?? {};
    expect(await marks()).toEqual({ hello: "difficult" });
    confirm.mockReturnValue(true);
    document.getElementById("reset-all")!.click();
    await vi.waitFor(() => expect(feedback().textContent).toContain("Nível e preferências foram mantidos"));
    expect(await marks()).toEqual({});
  });
});
