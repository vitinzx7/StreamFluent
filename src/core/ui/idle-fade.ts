/** Class added while the button rests; each overlay styles it (faded, no pointer events). */
export const IDLE_CLASS = "sf-idle";
const IDLE_MS = 3000;

/**
 * Shows `button` while the mouse moves and fades it after a pause, the way
 * the player's own controls behave, so it never sits on top of the picture.
 * It stays visible while `isPinned()` (its panel is open) or while focused.
 */
export function createIdleFade(button: HTMLElement, isPinned: () => boolean, idleMs = IDLE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let doc: Document | null = null;

  const focused = (): boolean => (button.getRootNode() as Document | ShadowRoot).activeElement === button;
  const rest = (): void => {
    if (isPinned() || focused()) {
      timer = setTimeout(rest, idleMs);
      return;
    }
    button.classList.add(IDLE_CLASS);
  };
  const wake = (): void => {
    button.classList.remove(IDLE_CLASS);
    clearTimeout(timer);
    timer = setTimeout(rest, idleMs);
  };

  button.addEventListener("focus", wake);
  return {
    wake,
    /** Follows the document the player lives in (it can change with frames). */
    attach(next: Document): void {
      if (doc === next) return;
      doc?.removeEventListener("mousemove", wake);
      doc = next;
      doc.addEventListener("mousemove", wake);
      wake();
    },
    destroy(): void {
      clearTimeout(timer);
      doc?.removeEventListener("mousemove", wake);
      button.removeEventListener("focus", wake);
      doc = null;
    },
  };
}

/**
 * Clicks on our own controls must not reach the player underneath: Netflix
 * toggles playback on click and fullscreen on double click. mouseup is left
 * alone — the subtitle drag ends on it at document level.
 */
export function isolatePointer(root: EventTarget): void {
  for (const type of ["click", "dblclick", "mousedown", "pointerdown"]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
}
