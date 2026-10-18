/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandFor, installShortcuts, type ShortcutTarget, type StudyCommand } from "../core/keyboard-shortcuts.ts";

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

function setup(overrides: Partial<ShortcutTarget> = {}, roots: ShadowRoot[] = []) {
  const target = {
    isActive: vi.fn(() => true),
    canRun: vi.fn((_command: StudyCommand) => true),
    run: vi.fn(),
    explain: vi.fn(),
    ...overrides,
  };
  uninstall = installShortcuts(window, target, { selectionRoots: () => roots });
  return target;
}

function press(key: string, init: KeyboardEventInit = {}, on: EventTarget = document.body, type = "keydown") {
  const event = new KeyboardEvent(type, {
    key,
    code: key === " " ? "Space" : `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  on.dispatchEvent(event);
  return event;
}

describe("which key means what", () => {
  it.each([
    ["a", "previous"],
    ["A", "previous"],
    ["s", "repeat"],
    ["d", "forward"],
    [" ", "toggle"],
    ["q", "auto-pause"],
    ["R", "save-line"],
  ])("%s → %s", (key, command) => {
    expect(commandFor(new KeyboardEvent("keydown", { key, shiftKey: key !== key.toLowerCase() }))).toBe(command);
  });

  it("copies only on exactly Ctrl+C or ⌘C", () => {
    expect(commandFor(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe("copy-line");
    expect(commandFor(new KeyboardEvent("keydown", { key: "c", metaKey: true }))).toBe("copy-line");
    expect(commandFor(new KeyboardEvent("keydown", { key: "C", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, altKey: true }))).toBeNull();
    expect(commandFor(new KeyboardEvent("keydown", { key: "c" }))).toBeNull();
  });

  it("rejects the other letters when a modifier is held", () => {
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(commandFor(new KeyboardEvent("keydown", { key: "a", ...init }))).toBeNull();
    }
    expect(commandFor(new KeyboardEvent("keydown", { key: "L", ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("taking a key over", () => {
  it("runs the command once and keeps the player from also reacting", () => {
    const target = setup();
    const player = vi.fn();
    document.body.addEventListener("keydown", player);

    const event = press("d");

    expect(target.run).toHaveBeenCalledExactlyOnceWith("forward");
    expect(event.defaultPrevented).toBe(true);
    expect(player).not.toHaveBeenCalled();
  });

  it("also swallows the keyup of a consumed key, and only that one", () => {
    setup();
    const player = vi.fn();
    document.body.addEventListener("keyup", player);

    press(" ");
    press(" ", {}, document.body, "keyup");
    press("x", { code: "KeyX" }, document.body, "keyup");

    expect(player).toHaveBeenCalledTimes(1);
  });

  it("leaves the key to the page when the command cannot run", () => {
    const target = setup({ canRun: vi.fn(() => false) });

    const event = press("s");

    expect(target.run).not.toHaveBeenCalled();
    expect(target.explain).toHaveBeenCalledWith("repeat");
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing at all while the instance owns no active player", () => {
    const target = setup({ isActive: vi.fn(() => false) });

    const event = press("a");

    expect(target.canRun).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("K03: a held key acts once but its repeats are still swallowed", () => {
    const target = setup();

    press("d");
    const repeated = press("d", { repeat: true });

    expect(target.run).toHaveBeenCalledTimes(1);
    expect(repeated.defaultPrevented).toBe(true);
  });

  it("ignores keys while an IME is composing", () => {
    const target = setup();

    press("a", { isComposing: true });

    expect(target.run).not.toHaveBeenCalled();
  });

  it("removes every listener when uninstalled", () => {
    const target = setup();
    uninstall?.();
    uninstall = undefined;

    press("a");

    expect(target.run).not.toHaveBeenCalled();
  });
});

describe("K01: typing stays typing", () => {
  it.each(["input", "textarea", "select"])("in a %s", (tag) => {
    const target = setup();
    const field = document.createElement(tag);
    document.body.append(field);

    for (const key of ["a", "s", "d", "q", "r", " "]) press(key, {}, field);
    press("c", { ctrlKey: true }, field);

    expect(target.run).not.toHaveBeenCalled();
  });

  it("in a contenteditable element", () => {
    const target = setup();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    // jsdom does not compute isContentEditable.
    Object.defineProperty(editor, "isContentEditable", { value: true });
    document.body.append(editor);

    press("r", {}, editor);

    expect(target.run).not.toHaveBeenCalled();
  });

  it("in a field inside a shadow root", () => {
    const target = setup();
    const host = document.createElement("div");
    document.body.append(host);
    const input = document.createElement("input");
    host.attachShadow({ mode: "open" }).append(input);

    press("q", {}, input);

    expect(target.run).not.toHaveBeenCalled();
  });
});

describe("K02: Space on a focused control", () => {
  it.each([
    ["button", () => document.createElement("button")],
    ["link", () => Object.assign(document.createElement("a"), { href: "#x" })],
    ["subtitle word (role=button)", () => {
      const word = document.createElement("span");
      word.setAttribute("role", "button");
      return word;
    }],
    ["video with controls", () => {
      const video = document.createElement("video");
      video.setAttribute("controls", "");
      return video;
    }],
  ])("belongs to the %s", (_name, make) => {
    const target = setup();
    const control = make();
    document.body.append(control);

    const event = press(" ", {}, control);

    expect(target.run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("while letters on that button still work", () => {
    const target = setup();
    const button = document.createElement("button");
    document.body.append(button);

    press("d", {}, button);

    expect(target.run).toHaveBeenCalledWith("forward");
  });
});

describe("Ctrl/⌘+C", () => {
  it("K05: copies the line when nothing is selected", () => {
    const target = setup();

    const event = press("c", { ctrlKey: true });

    expect(target.run).toHaveBeenCalledWith("copy-line");
    expect(event.defaultPrevented).toBe(true);
  });

  it("K04: keeps the native copy of a page selection", () => {
    const target = setup();
    const text = document.createElement("p");
    text.textContent = "Selected words";
    document.body.append(text);
    window.getSelection()!.selectAllChildren(text);

    const event = press("c", { metaKey: true });

    expect(target.run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the native copy of a selection inside our shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    Object.assign(root, { getSelection: () => ({ toString: () => "card text" }) });
    const target = setup({}, [root]);

    press("c", { ctrlKey: true });

    expect(target.run).not.toHaveBeenCalled();
  });
});
