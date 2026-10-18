/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import html from "../../public/library.html?raw";
import source from "../../public/library.js?raw";
import { installStudyWorker } from "./helpers/study-worker.ts";
import { requestStudy } from "../core/study-messages.ts";
import { PhraseRepository } from "../core/storage.ts";
beforeEach(() => { document.documentElement.innerHTML = html; history.replaceState({}, "", "/library.html?tab=difficult"); installStudyWorker(); });
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
