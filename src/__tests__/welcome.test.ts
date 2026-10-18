/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import html from "../../public/welcome.html?raw";
import source from "../../public/welcome.js?raw";
import { installStudyWorker } from "./helpers/study-worker.ts";
import { requestStudy } from "../core/study-messages.ts";

let worker: ReturnType<typeof installStudyWorker>;

beforeEach(() => {
  document.documentElement.innerHTML = html;
  worker = installStudyWorker();
});

async function open(): Promise<void> {
  new Function("studyRequest", source)(
    async (action: Parameters<typeof requestStudy>[0], payload: unknown) => (await requestStudy(action, payload)).data,
  );
  await vi.waitFor(() => expect(worker.sendMessage).toHaveBeenCalled());
}

describe("welcome page", () => {
  it("offers the six levels and saves the chosen one with the lilac on", async () => {
    await open();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-level]")];
    expect(buttons.map((button) => button.dataset.level)).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);

    buttons[2].click();

    await vi.waitFor(() => expect(worker.storage.settings).toMatchObject({ level: "B1", highlightSpecialWords: true }));
    expect(buttons[2].getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("status")!.textContent).toContain("B1");
  });

  it("respects the lilac switch and keeps the other preferences", async () => {
    worker.storage.settings = { direction: "en-pt", subtitleBottom: 40, autoPause: true };
    await open();
    (document.getElementById("highlight") as HTMLInputElement).checked = false;

    document.querySelector<HTMLButtonElement>('[data-level="C1"]')!.click();

    await vi.waitFor(() => expect(worker.storage.settings).toMatchObject({ level: "C1", highlightSpecialWords: false, subtitleBottom: 40, autoPause: true }));
  });

  it("credits the word-list sources", () => {
    expect(document.querySelector("footer")!.textContent).toMatch(/CEFR-J[\s\S]*Octanove[\s\S]*CC BY-SA 4\.0/);
  });
});
