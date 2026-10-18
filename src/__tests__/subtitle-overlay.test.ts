/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createSubtitleOverlay,
  type CardContent,
  type OverlayOptions,
} from "../core/ui/subtitle-overlay.ts";
import { DEFAULT_SETTINGS, type Settings } from "../core/settings.ts";

let overlay: ReturnType<typeof createSubtitleOverlay> | null = null;

function create(
  settings: Partial<Settings> = {},
  getWordStatus?: OverlayOptions["getWordStatus"]
) {
  const onWordSelect = vi.fn();
  const onSettingsChange = vi.fn();
  const onOpenLibrary = vi.fn();

  overlay = createSubtitleOverlay({
    onWordSelect,
    onSettingsChange,
    onOpenLibrary,
    getWordStatus,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  });

  return { overlay, onWordSelect, onSettingsChange, onOpenLibrary };
}

const overlayEl = () => document.querySelector<HTMLElement>(".sf-overlay")!;
const targetLine = () => document.querySelector(".sf-line-target");
const panel = () => document.querySelector<HTMLElement>(".sf-panel")!;
const fab = () => document.querySelector<HTMLElement>(".sf-fab")!;

function drag(fromY: number, toY: number) {
  overlayEl().dispatchEvent(new MouseEvent("mousedown", { button: 0, clientY: fromY, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mousemove", { clientY: toY, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

afterEach(() => {
  overlay?.destroy();
  overlay = null;
});

describe("subtitle lines", () => {
  it("renders each word of the original line as a clickable span", () => {
    create().overlay.update("One more please");

    const words = Array.from(document.querySelectorAll(".sf-word")).map((w) => w.textContent);
    expect(words).toEqual(["One", "more", "please"]);
  });

  it("shows the translation for the line currently on screen", () => {
    const { overlay: o } = create();
    o.update("One more please");
    o.setTranslation("One more please", "Mais um por favor");

    expect(targetLine()?.textContent).toBe("Mais um por favor");
  });

  it("drops a translation that arrives after the subtitle changed", () => {
    const { overlay: o } = create();
    o.update("One more please");
    o.update("Something else");

    o.setTranslation("One more please", "Mais um por favor");

    expect(targetLine()?.textContent).toBe("");
  });

  it("clears the previous translation as soon as a new line arrives", () => {
    const { overlay: o } = create();
    o.update("One more please");
    o.setTranslation("One more please", "Mais um por favor");

    o.update("Something else");

    expect(targetLine()?.textContent).toBe("");
  });

  it("hides the overlay and clears both lines when the cue ends", () => {
    const { overlay: o } = create();
    o.update("One more please");
    o.setTranslation("One more please", "Mais um por favor");

    o.update(null);

    expect(overlayEl().classList.contains("sf-hidden")).toBe(true);
    expect(document.querySelectorAll(".sf-word").length).toBe(0);
    expect(targetLine()?.textContent).toBe("");
  });

  it("ignores a translation when no line is showing", () => {
    const { overlay: o } = create();
    o.update(null);

    o.setTranslation("", "qualquer coisa");

    expect(targetLine()?.textContent).toBe("");
  });
});

describe("settings panel", () => {
  it("stays closed until the icon is clicked, and toggles", () => {
    create();
    expect(panel().classList.contains("sf-hidden")).toBe(true);

    fab().click();
    expect(panel().classList.contains("sf-hidden")).toBe(false);

    fab().click();
    expect(panel().classList.contains("sf-hidden")).toBe(true);
  });

  it("reports a change to the translated-line option", () => {
    const { onSettingsChange } = create({ showTranslation: true });

    const input = panel().querySelector<HTMLInputElement>('[data-sf="translation"]')!;
    expect(input.checked).toBe(true);

    input.checked = false;
    input.dispatchEvent(new Event("change"));

    expect(onSettingsChange).toHaveBeenCalledWith({ showTranslation: false });
  });

  it("reports a change of direction", () => {
    const { onSettingsChange } = create({ direction: "en-pt" });

    const select = panel().querySelector<HTMLSelectElement>('[data-sf="direction"]')!;
    expect(select.value).toBe("en-pt");

    select.value = "pt-en";
    select.dispatchEvent(new Event("change"));

    expect(onSettingsChange).toHaveBeenCalledWith({ direction: "pt-en" });
  });

  it("clears the translated line the moment the option is switched off", () => {
    const { overlay: o } = create({ showTranslation: true });
    o.update("One more please");
    o.setTranslation("One more please", "Mais um por favor");

    o.applySettings({ ...DEFAULT_SETTINGS, showTranslation: false });

    expect(targetLine()?.textContent).toBe("");
  });

  it("opens the library from the panel", () => {
    const { onOpenLibrary } = create();

    panel().querySelector<HTMLElement>('[data-sf="library"]')!.click();

    expect(onOpenLibrary).toHaveBeenCalled();
  });
});

describe("dragging the subtitle", () => {
  it("starts at the stored position", () => {
    create({ subtitleBottom: 30 });
    expect(overlayEl().style.bottom).toBe("30%");
  });

  it("moves up when dragged up and saves the new position", () => {
    const { onSettingsChange } = create({ subtitleBottom: 12 });

    drag(500, 400); // 100px up

    const bottom = parseFloat(overlayEl().style.bottom);
    expect(bottom).toBeGreaterThan(12);
    expect(onSettingsChange).toHaveBeenCalledWith({ subtitleBottom: bottom });
  });

  it("moves down when dragged down", () => {
    create({ subtitleBottom: 50 });

    drag(300, 400); // 100px down

    expect(parseFloat(overlayEl().style.bottom)).toBeLessThan(50);
  });

  it("keeps the subtitle on screen however far it is dragged", () => {
    create({ subtitleBottom: 12 });

    drag(500, -100000);

    expect(parseFloat(overlayEl().style.bottom)).toBeLessThanOrEqual(88);
  });

  it("treats a few pixels of jitter as a click, not a drag", () => {
    const { onSettingsChange } = create({ subtitleBottom: 12 });

    drag(500, 498);

    expect(overlayEl().style.bottom).toBe("12%");
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it("does not select a word on the click that ends a drag", () => {
    const { overlay: o, onWordSelect } = create();
    o.update("One more please");

    const word = document.querySelector<HTMLElement>(".sf-word")!;
    overlayEl().dispatchEvent(new MouseEvent("mousedown", { button: 0, clientY: 500, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientY: 400, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    word.click();

    expect(onWordSelect).not.toHaveBeenCalled();
  });

  it("still selects a word when the pointer did not move", () => {
    const { overlay: o, onWordSelect } = create();
    o.update("One more please");

    const word = document.querySelector<HTMLElement>(".sf-word")!;
    overlayEl().dispatchEvent(new MouseEvent("mousedown", { button: 0, clientY: 500, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    word.click();

    expect(onWordSelect).toHaveBeenCalledWith("One", "One more please");
  });
});

describe("word colours", () => {
  const wordEl = (text: string) =>
    Array.from(document.querySelectorAll<HTMLElement>(".sf-word")).find((w) => w.textContent === text)!;

  it("colours each word by the status it is given", () => {
    const statuses: Record<string, "new" | "difficult" | "learned"> = { fear: "difficult", fitting: "new" };
    create({}, (word) => statuses[word] ?? null).overlay.update("your fear of not fitting");

    expect(wordEl("fear").classList.contains("sf-word-difficult")).toBe(true);
    expect(wordEl("fitting").classList.contains("sf-word-new")).toBe(true);
    expect(wordEl("your").className).toBe("sf-word");
  });

  it("re-reads colours in place when asked, without rebuilding the line", () => {
    const statuses: Record<string, "new" | "difficult" | "learned" | null> = { fear: "new" };
    const { overlay: o } = create({}, (word) => statuses[word] ?? null);
    o.update("your fear");
    const before = wordEl("fear");

    statuses.fear = "learned";
    o.refreshWordStatuses();

    expect(wordEl("fear")).toBe(before);
    expect(before.classList.contains("sf-word-learned")).toBe(true);
    expect(before.classList.contains("sf-word-new")).toBe(false);

    statuses.fear = null;
    o.refreshWordStatuses();
    expect(before.className).toBe("sf-word");
  });

  it("leaves words plain when no status function is given", () => {
    create().overlay.update("your fear");

    expect(wordEl("fear").className).toBe("sf-word");
  });
});

describe("marking from the card", () => {
  const content = (patch: Partial<CardContent> = {}): CardContent => ({
    word: "fear",
    translation: "medo",
    definition: "",
    sentence: "your fear",
    sentenceTranslation: "",
    directionLabel: "EN → PT",
    state: "ready",
    mark: null,
    ...patch,
  });
  const button = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>(".sf-card-mark")).find(
      (b) => b.textContent === label
    )!;

  it("shows the word's current mark as active", () => {
    create().overlay.showCard(content({ mark: "difficult" }), vi.fn(), vi.fn());

    expect(button("Difícil").classList.contains("sf-active")).toBe(true);
    expect(button("Aprendida").classList.contains("sf-active")).toBe(false);
  });

  it("switches between marks and removes one explicitly", async () => {
    const onMark = vi.fn();
    create().overlay.showCard(content(), vi.fn(), onMark);

    button("Aprendida").click();
    await Promise.resolve();
    expect(onMark).toHaveBeenLastCalledWith("learned");
    expect(button("Aprendida").classList.contains("sf-active")).toBe(true);

    button("Difícil").click();
    await Promise.resolve();
    expect(onMark).toHaveBeenLastCalledWith("difficult");
    expect(button("Aprendida").classList.contains("sf-active")).toBe(false);
    expect(button("Difícil").classList.contains("sf-active")).toBe(true);

    button("Remover marcação").click();
    await Promise.resolve();
    expect(onMark).toHaveBeenLastCalledWith(null);
    expect(button("Difícil").classList.contains("sf-active")).toBe(false);
  });

  it("can mark while the translation is still loading", async () => {
    const onMark = vi.fn();
    create().overlay.showCard(content({ state: "loading", translation: "" }), vi.fn(), onMark);

    button("Difícil").click();
    await Promise.resolve();

    expect(onMark).toHaveBeenCalledWith("difficult");
  });

  it("keeps the card open after marking", async () => {
    create().overlay.showCard(content(), vi.fn(), vi.fn());

    button("Aprendida").click();
    await Promise.resolve();

    expect(document.querySelector(".sf-card")?.classList.contains("sf-hidden")).toBe(false);
  });

  it("offers no mark buttons when the caller cannot save marks", () => {
    create().overlay.showCard(content(), vi.fn());

    expect(document.querySelectorAll(".sf-card-mark:not([hidden])").length).toBe(0);
  });
});

describe("new-word colour option", () => {
  it("reflects the setting and reports a change", () => {
    const { overlay: o, onSettingsChange } = create({ highlightNewWords: true });
    const input = panel().querySelector<HTMLInputElement>('[data-sf="new-words"]')!;
    expect(input.checked).toBe(true);

    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(onSettingsChange).toHaveBeenCalledWith({ highlightNewWords: false });

    o.applySettings({ ...DEFAULT_SETTINGS, highlightNewWords: false });
    expect(input.checked).toBe(false);
  });
});

describe("quick marking and durable card actions", () => {
  it("keeps punctuation, spaces and line breaks and only intercepts valid word context menus", () => {
    const difficult = vi.fn(), select = vi.fn();
    overlay = createSubtitleOverlay({ settings: DEFAULT_SETTINGS, onSettingsChange: vi.fn(), onOpenLibrary: vi.fn(), onWordSelect: select, onWordDifficult: difficult });
    const text = "  Don’t—stop,\nwell-known! ...";
    overlay.update(text);
    expect(document.querySelector(".sf-line-source")?.textContent).toBe(text);
    const word = document.querySelector(".sf-word")!;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    word.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(difficult).toHaveBeenCalledWith("Don’t", text);
    expect(select).not.toHaveBeenCalled();
    const outside = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.querySelector(".sf-line-source")!.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
  });
  it("lets keyboard activate a word without dragging or losing text", () => {
    const { onWordSelect, overlay: o } = create(); o.update("Hello!");
    const word = document.querySelector<HTMLElement>(".sf-word")!;
    expect(word.tabIndex).toBe(0); word.focus();
    word.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(onWordSelect).toHaveBeenCalledWith("Hello", "Hello!");
  });
  it("saves originals while translation loads and never announces a rejected save", async () => {
    const { overlay: o } = create();
    let reject!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    o.showCard({ word: "hello", sentence: "hello world", translation: "", definition: "", sentenceTranslation: "", directionLabel: "EN → PT", state: "loading" }, save);
    document.querySelector<HTMLButtonElement>(".sf-card-btn")!.click();
    expect(save).toHaveBeenCalledOnce();
    expect(document.querySelector(".sf-card-feedback")?.textContent).toBe("Salvando…");
    reject(new Error("quota")); await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector(".sf-card-feedback")?.textContent).toContain("Não foi possível");
    expect(document.querySelector<HTMLButtonElement>(".sf-card-btn")!.disabled).toBe(false);
  });
  it("keeps focus when translation arrives and ignores an old failed marking response", async () => {
    const { overlay: o } = create();
    let reject!: (error: Error) => void;
    const mark = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    const card: CardContent = { identity: "click-1", word: "hello", sentence: "hello", translation: "", definition: "", sentenceTranslation: "", directionLabel: "EN → PT", state: "loading" };
    o.showCard(card, vi.fn(), mark);
    const hard = document.querySelector<HTMLButtonElement>('[data-mark="difficult"]')!;
    hard.focus(); hard.click();
    o.showCard({ ...card, translation: "olá", state: "ready" }, vi.fn(), mark);
    expect(document.activeElement).toBe(hard);
    const learned = document.querySelector<HTMLButtonElement>('[data-mark="learned"]')!; learned.click();
    await Promise.resolve(); reject(new Error("old")); await Promise.resolve(); await Promise.resolve();
    expect(learned.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".sf-card-feedback")?.textContent).toContain("aprendida");
  });
});

describe("line actions in the panel", () => {
  it("'Copiar fala' and 'Salvar fala' call the same handlers as the shortcuts", () => {
    const onStudyCommand = vi.fn();
    overlay = createSubtitleOverlay({
      onWordSelect: vi.fn(),
      onSettingsChange: vi.fn(),
      onOpenLibrary: vi.fn(),
      onStudyCommand,
      settings: DEFAULT_SETTINGS,
    });

    document.querySelector<HTMLButtonElement>('[data-sf="copy-line"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-sf="save-line"]')!.click();

    expect(onStudyCommand.mock.calls).toEqual([["copy-line"], ["save-line"]]);
  });

  it("shows a refused copy as a selected, read-only field that Escape closes", () => {
    const { overlay: o } = create();

    o.showCopyFallback("Line <b>one</b>\nline two");

    const field = document.querySelector<HTMLTextAreaElement>(".sf-copy-text")!;
    expect(field.value).toBe("Line <b>one</b>\nline two");
    expect(field.readOnly).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(document.querySelector(".sf-copy b")).toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".sf-copy")!.classList.contains("sf-hidden")).toBe(true);
  });

  it("clears a feedback message after a moment", () => {
    vi.useFakeTimers();
    const { overlay: o } = create();

    o.showFeedback("Fala salva");
    expect(document.querySelector(".sf-feedback")!.textContent).toBe("Fala salva");
    vi.advanceTimersByTime(3000);

    expect(document.querySelector(".sf-feedback")!.textContent).toBe("");
    vi.useRealTimers();
  });
});

describe("placement and fullscreen", () => {
  const setFullscreen = (element: Element | null) => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: element });
    document.dispatchEvent(new Event("fullscreenchange"));
  };

  afterEach(() => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    vi.useRealTimers();
  });

  it("fades the settings button while the mouse rests, and shows it again on movement", () => {
    vi.useFakeTimers();
    create();

    vi.advanceTimersByTime(3000);
    expect(fab().classList.contains("sf-idle")).toBe(true);

    document.dispatchEvent(new MouseEvent("mousemove"));
    expect(fab().classList.contains("sf-idle")).toBe(false);
  });

  it("keeps the button visible while its panel is open", () => {
    vi.useFakeTimers();
    create();
    fab().click();

    vi.advanceTimersByTime(10000);

    expect(fab().classList.contains("sf-idle")).toBe(false);
  });

  it("moves every piece into the player's fullscreen element and back out", () => {
    const { overlay: o } = create();
    o.update("Hello there");
    const player = document.createElement("div");
    document.body.append(player);

    setFullscreen(player);
    for (const selector of [".sf-overlay", ".sf-panel", ".sf-fab", ".sf-card", ".sf-feedback", ".sf-copy"]) {
      expect(document.querySelector(selector)!.parentElement).toBe(player);
    }

    setFullscreen(null);
    expect(overlayEl().parentElement).toBe(document.body);
    player.remove();
  });

  it("stays in the page when the fullscreen element is the video itself", () => {
    create();
    const video = document.createElement("video");
    document.body.append(video);

    setFullscreen(video);

    expect(overlayEl().parentElement).toBe(document.body);
    video.remove();
  });

  it("comes back when the player re-renders its container without us", () => {
    const { overlay: o } = create();
    const player = document.createElement("div");
    document.body.append(player);
    setFullscreen(player);

    player.replaceChildren();
    o.update("Next line");

    expect(overlayEl().parentElement).toBe(player);
    player.remove();
  });

  it("keeps clicks on words and controls from reaching the player underneath", () => {
    const { overlay: o, onWordSelect } = create();
    const player = document.createElement("div");
    document.body.append(player);
    setFullscreen(player);
    const playerClick = vi.fn();
    const playerDoubleClick = vi.fn();
    player.addEventListener("click", playerClick);
    player.addEventListener("dblclick", playerDoubleClick);
    o.update("Hello there");

    document.querySelector<HTMLElement>(".sf-word")!.click();
    fab().click();
    overlayEl().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(onWordSelect).toHaveBeenCalledWith("Hello", "Hello there");
    expect(playerClick).not.toHaveBeenCalled();
    expect(playerDoubleClick).not.toHaveBeenCalled();
    player.remove();
  });
});

describe("English level", () => {
  it("reports a level chosen in the panel, and shows the stored one", () => {
    const { overlay: o, onSettingsChange } = create({ level: "B1" });
    const select = document.querySelector<HTMLSelectElement>('[data-sf="level"]')!;
    expect(select.value).toBe("B1");

    select.value = "C1";
    select.dispatchEvent(new Event("change"));
    expect(onSettingsChange).toHaveBeenCalledWith({ level: "C1" });

    o.applySettings({ ...DEFAULT_SETTINGS, level: null });
    expect(select.value).toBe("");
  });

  it("turns the lilac on with the first level chosen in the panel", () => {
    const { onSettingsChange } = create();
    const select = document.querySelector<HTMLSelectElement>('[data-sf="level"]')!;

    select.value = "A2";
    select.dispatchEvent(new Event("change"));

    expect(onSettingsChange).toHaveBeenCalledWith({ level: "A2", highlightSpecialWords: true });
  });

  it("asks with one click per level, turning the lilac on, and closes when answered", () => {
    const { overlay: o, onSettingsChange } = create();
    const prompt = () => document.querySelector<HTMLElement>(".sf-level-prompt")!;
    expect(prompt().classList.contains("sf-hidden")).toBe(true);

    o.askLevel();
    expect(prompt().classList.contains("sf-hidden")).toBe(false);
    expect([...prompt().querySelectorAll("[data-level]")].map((b) => b.getAttribute("data-level"))).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
    prompt().querySelector<HTMLButtonElement>('[data-level="A2"]')!.click();

    expect(onSettingsChange).toHaveBeenCalledWith({ level: "A2", highlightSpecialWords: true });
    expect(prompt().classList.contains("sf-hidden")).toBe(true);
  });

  it("can be put off for now", () => {
    const { overlay: o, onSettingsChange } = create();
    o.askLevel();

    document.querySelector<HTMLButtonElement>('[data-sf="level-later"]')!.click();

    expect(document.querySelector(".sf-level-prompt")!.classList.contains("sf-hidden")).toBe(true);
    expect(onSettingsChange).not.toHaveBeenCalled();
  });
});
