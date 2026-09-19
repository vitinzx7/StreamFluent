/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { extractSubtitleText } from "../core/dom-utils.ts";

describe("extractSubtitleText", () => {
  it("extracts text from span elements", () => {
    const container = document.createElement("div");
    const span1 = document.createElement("span");
    span1.textContent = "Hello";
    const span2 = document.createElement("span");
    span2.textContent = "world";
    container.appendChild(span1);
    container.appendChild(span2);

    expect(extractSubtitleText(container)).toBe("Hello world");
  });

  it("extracts text directly from container when no spans", () => {
    const container = document.createElement("div");
    container.textContent = "Direct text";

    expect(extractSubtitleText(container)).toBe("Direct text");
  });

  it("returns null for empty container", () => {
    const container = document.createElement("div");
    expect(extractSubtitleText(container)).toBeNull();
  });

  it("returns null for whitespace-only content", () => {
    const container = document.createElement("div");
    container.textContent = "   ";
    expect(extractSubtitleText(container)).toBeNull();
  });

  it("trims whitespace from spans", () => {
    const container = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "  spaced  ";
    container.appendChild(span);

    expect(extractSubtitleText(container)).toBe("spaced");
  });

  it("does not repeat words when the player nests its cue spans", () => {
    // Netflix ships <span><span>text</span></span>; reading per element counted
    // every word once per level.
    const container = document.createElement("div");
    container.innerHTML =
      "<span><span>One more.</span></span><span><span>Just one more.</span></span>";

    expect(extractSubtitleText(container)).toBe("One more. Just one more.");
  });

  it("reads every line of a multi-line cue", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="line"><span>I told you</span></div>' +
      '<div class="line"><span>not to come back.</span></div>';

    expect(extractSubtitleText(root)).toBe("I told you not to come back.");
  });

  it("ignores text inside our own injected elements", () => {
    const container = document.createElement("div");
    container.innerHTML = "<span>Original</span>";
    const injected = document.createElement("span");
    injected.setAttribute("data-streamfluent", "");
    injected.textContent = "Tradução";
    container.appendChild(injected);

    expect(extractSubtitleText(container)).toBe("Original");
  });

  it("skips empty spans", () => {
    const container = document.createElement("div");
    const span1 = document.createElement("span");
    span1.textContent = "";
    const span2 = document.createElement("span");
    span2.textContent = "only";
    container.appendChild(span1);
    container.appendChild(span2);

    expect(extractSubtitleText(container)).toBe("only");
  });
});
