/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createSubtitleOverlay } from "../core/ui/subtitle-overlay.ts";
import { DEFAULT_SETTINGS, type Settings } from "../core/settings.ts";

let overlay: ReturnType<typeof createSubtitleOverlay> | null = null;

function create(settings: Partial<Settings> = {}) {
  const onWordSelect = vi.fn();
  const onSettingsChange = vi.fn();
  const onOpenLibrary = vi.fn();

  overlay = createSubtitleOverlay({
    onWordSelect,
    onSettingsChange,
    onOpenLibrary,
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
