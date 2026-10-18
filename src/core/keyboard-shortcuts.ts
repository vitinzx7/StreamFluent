/**
 * The one keyboard listener of an active player: A, S, D, Space, Q, R and
 * Ctrl/⌘+C. Installed in the capture phase of the window that holds the
 * player, so the player cannot act on a key before we decide whether it is ours.
 */
export type StudyCommand =
  | "previous"
  | "repeat"
  | "forward"
  | "toggle"
  | "auto-pause"
  | "save-line"
  | "copy-line";

export interface ShortcutTarget {
  /** False while this instance does not own an active player: every key is left alone. */
  isActive(): boolean;
  /** Synchronous: whether the command can run now. Only then is the key consumed. */
  canRun(command: StudyCommand): boolean;
  /** Runs a command whose key was consumed. Must not throw. */
  run(command: StudyCommand): void;
  /** The key is ours but nothing can be done: explain, without consuming the key. */
  explain?(command: StudyCommand): void;
}

export interface ShortcutOptions {
  /** Shadow roots whose text selection must win over Ctrl/⌘+C. */
  selectionRoots?: () => ShadowRoot[];
}

const LETTERS: Record<string, StudyCommand> = {
  a: "previous",
  s: "repeat",
  d: "forward",
  q: "auto-pause",
  r: "save-line",
};

const CONTROL_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "option", "slider"]);

function isElement(node: EventTarget): node is HTMLElement {
  return typeof (node as Element).tagName === "string";
}

/** Typing an "a" in a search box, a select or our own fields must stay an "a". */
function isEditable(node: EventTarget): boolean {
  if (!isElement(node)) return false;
  if (node.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

/** Space and Enter on a focused button, link or media control belong to that control. */
function isControl(node: EventTarget): boolean {
  if (!isElement(node)) return false;
  const role = node.getAttribute("role");
  if (role && CONTROL_ROLES.has(role)) return true;
  switch (node.tagName) {
    case "BUTTON":
    case "SUMMARY":
      return true;
    case "A":
      return node.hasAttribute("href");
    case "VIDEO":
    case "AUDIO":
      // Native controls toggle playback on Space themselves.
      return node.hasAttribute("controls");
    default:
      return false;
  }
}

/** The command for this key, or null. Only the exact Ctrl/⌘+C combination copies. */
export function commandFor(event: KeyboardEvent): StudyCommand | null {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    return key === "c" ? "copy-line" : null;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === " " || event.code === "Space") return "toggle";
  // Shift or Caps Lock still mean the same letter.
  return LETTERS[key] ?? null;
}

function isShadowRoot(node: EventTarget): node is ShadowRoot {
  return (node as Node).nodeType === 11 && "host" in node;
}

/** A non-empty selection anywhere the user can see it keeps the native copy. */
function hasSelection(view: Window, path: EventTarget[], roots: ShadowRoot[]): boolean {
  if (view.getSelection()?.toString()) return true;
  const candidates = new Set<ShadowRoot>(roots);
  for (const node of path) if (isShadowRoot(node)) candidates.add(node);
  for (const root of candidates) {
    // Chromium exposes the selection inside a shadow root only through the root.
    const selection = (root as ShadowRoot & { getSelection?(): Selection | null }).getSelection?.();
    if (selection?.toString()) return true;
  }
  return false;
}

/** Installs the router; the returned function removes every listener it added. */
export function installShortcuts(view: Window, target: ShortcutTarget, options: ShortcutOptions = {}): () => void {
  /** Keys whose keydown we consumed: their keyup/keypress must not reach the player either. */
  const consumed = new Set<string>();

  const swallow = (event: KeyboardEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (!target.isActive()) return;
    if (event.isComposing || event.keyCode === 229) return;
    const command = commandFor(event);
    if (!command) return;

    const path = event.composedPath();
    if (path.some(isEditable)) return;
    if (command === "toggle" && path.some(isControl)) return;
    if (command === "copy-line" && hasSelection(view, path, options.selectionRoots?.() ?? [])) return;

    if (!target.canRun(command)) {
      if (!event.repeat) target.explain?.(command);
      return;
    }

    swallow(event);
    consumed.add(event.code || event.key);
    // Holding a key down: keep the browser from scrolling and the player from
    // acting, but do the action only once.
    if (event.repeat) return;
    target.run(command);
  };

  const onFollowUp = (event: KeyboardEvent): void => {
    const key = event.code || event.key;
    if (!consumed.has(key)) return;
    if (event.type === "keyup") consumed.delete(key);
    swallow(event);
  };

  view.addEventListener("keydown", onKeydown, true);
  view.addEventListener("keypress", onFollowUp, true);
  view.addEventListener("keyup", onFollowUp, true);
  return () => {
    view.removeEventListener("keydown", onKeydown, true);
    view.removeEventListener("keypress", onFollowUp, true);
    view.removeEventListener("keyup", onFollowUp, true);
    consumed.clear();
  };
}
