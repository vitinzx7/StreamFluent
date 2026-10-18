/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import html from "../../public/library.html?raw";
import source from "../../public/library.js?raw";
import { installStudyWorker } from "./helpers/study-worker.ts";
import { requestStudy } from "../core/study-messages.ts";
import { PhraseRepository } from "../core/storage.ts";
beforeEach(() => { document.documentElement.innerHTML = html; history.replaceState({}, "", "/library.html?tab=difficult"); installStudyWorker(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  const library = new Function("studyRequest", "chrome", source + "\nreturn { refresh };")(
    async (action: Parameters<typeof requestStudy>[0], payload: unknown) => (await requestStudy(action, payload)).data, chrome,
  );
  await library.refresh();
}
const byText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;
describe("live study library", () => {
  it("updates from player operations and moves marks across views without losing phrases", async () => {
    await PhraseRepository.save({ kind: "sentence", sentence: "hello world", sourceLanguage: "en", targetLanguage: "pt-BR", platform: "Netflix", mediaTitle: "Test", season: 1, episode: 1 });
    await open(); expect(document.getElementById("list")!.textContent).toContain("botão direito");
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult" });
    await vi.waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(1));
    byText("Marcar como aprendida").click();
    await vi.waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(0));
    byText("Palavras aprendidas").click(); expect(document.querySelectorAll("article")).toHaveLength(1);
    byText("Remover marcação").click();
    await vi.waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(0));
    byText("Frases salvas").click(); expect(document.querySelectorAll("article")).toHaveLength(1);
  });
  it("renders untrusted text literally, filters each language, and preserves filters on updates", async () => {
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult", details: { displayWord: "<img src=x onerror=alert(1)>", context: { sentence: "<script>bad()</script> context", sourceLanguage: "en", platform: "Test", mediaTitle: "<b>title</b>", season: null, episode: null } } });
    await requestStudy("set-mark", { language: "pt-BR", word: "hello", mark: "difficult" });
    await open(); expect(document.querySelectorAll("article")).toHaveLength(2);
    expect(document.querySelector("article img, article script, article b")).toBeNull();
    const language = document.getElementById("languageFilter") as HTMLSelectElement;
    language.value = "en"; language.dispatchEvent(new Event("change"));
    const search = document.getElementById("search") as HTMLInputElement; search.value = "context"; search.dispatchEvent(new Event("input")); search.focus();
    await requestStudy("set-mark", { language: "en", word: "other", mark: "difficult" });
    await vi.waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(1));
    expect(search.value).toBe("context"); expect(language.value).toBe("en"); expect(document.activeElement).toBe(search);
  });
});

describe("your data", () => {
  const status = () => document.getElementById("dataStatus")!.textContent;

  it("exports a backup file named by date", async () => {
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult" });
    const createObjectURL = vi.fn(() => "blob:backup");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    await open();

    byText("Exportar backup").click();

    await vi.waitFor(() => expect(status()).toContain("Backup exportado"));
    expect(clicked[0].download).toMatch(/^streamfluent-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(status()).toContain("1 marcadas");
  });

  it("imports a backup file and shows what came back", async () => {
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult" });
    const backup = (await requestStudy("export")).data;
    installStudyWorker();
    await open();
    const input = document.getElementById("importData") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File([JSON.stringify(backup)], "backup.json", { type: "application/json" })] });

    input.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(status()).toContain("Backup importado"));
    expect(status()).toContain("1 marcações");
    await vi.waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(1));
  });

  it("says so when the file is not a backup", async () => {
    await open();
    const input = document.getElementById("importData") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["not json"], "notes.txt")] });

    input.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(status()).toBe("Esse arquivo não é um backup do StreamFluent."));
  });

  it("asks before wiping, and keeps everything when the answer is no", async () => {
    await requestStudy("set-mark", { language: "en", word: "hello", mark: "difficult" });
    await open();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);

    byText("Apagar todos os dados de estudo").click();
    expect(confirm).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("article")).toHaveLength(1);

    confirm.mockReturnValue(true);
    byText("Apagar todos os dados de estudo").click();
    await vi.waitFor(() => expect(document.querySelectorAll("article")).toHaveLength(0));
    expect(status()).toContain("Nível e preferências foram mantidos");
  });
});
