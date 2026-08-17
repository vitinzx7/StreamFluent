/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import {
  isExtensionElement,
  mutationHasExtensionNode,
  extractSubtitleText,
  EXTENSION_MARKER,
} from "../core/dom-utils.ts";

describe("isExtensionElement", () => {
  it("returns true for elements with the marker attribute", () => {
    const el = document.createElement("div");
    el.setAttribute(EXTENSION_MARKER, "");
    expect(isExtensionElement(el)).toBe(true);
  });

  it("returns false for normal elements", () => {
    const el = document.createElement("div");
    expect(isExtensionElement(el)).toBe(false);
  });

  it("returns true for children of marked parents", () => {
    const parent = document.createElement("div");
    parent.setAttribute(EXTENSION_MARKER, "");
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);

    expect(isExtensionElement(child)).toBe(true);
    parent.remove();
  });

  it("returns false for non-element nodes", () => {
    const text = document.createTextNode("hello");
    expect(isExtensionElement(text)).toBe(false);
  });
});

describe("mutationHasExtensionNode", () => {
  it("returns true when addedNodes contain extension element", () => {
    const el = document.createElement("div");
    el.setAttribute(EXTENSION_MARKER, "");
    const mutations = [
      { addedNodes: [el], removedNodes: [], target: document.body },
    ] as unknown as MutationRecord[];
    expect(mutationHasExtensionNode(mutations)).toBe(true);
  });

  it("returns false when no extension elements involved", () => {
    const el = document.createElement("div");
    const mutations = [
      { addedNodes: [el], removedNodes: [], target: document.body },
    ] as unknown as MutationRecord[];
    expect(mutationHasExtensionNode(mutations)).toBe(false);
  });

  it("returns true when target is extension element", () => {
    const el = document.createElement("div");
    el.setAttribute(EXTENSION_MARKER, "");
    const mutations = [
      { addedNodes: [], removedNodes: [], target: el },
    ] as unknown as MutationRecord[];
    expect(mutationHasExtensionNode(mutations)).toBe(true);
  });
});

describe("extractSubtitleText deduplication", () => {
  it("skips extension elements inside subtitle container", () => {
    const container = document.createElement("div");

    const normalSpan = document.createElement("span");
    normalSpan.textContent = "Hello world";
    container.appendChild(normalSpan);

    const extSpan = document.createElement("span");
    extSpan.setAttribute(EXTENSION_MARKER, "");
    extSpan.textContent = "Extension overlay";
    container.appendChild(extSpan);

    expect(extractSubtitleText(container)).toBe("Hello world");
  });

  it("extracts only non-extension spans", () => {
    const container = document.createElement("div");

    const span1 = document.createElement("span");
    span1.textContent = "Line one";
    container.appendChild(span1);

    const extDiv = document.createElement("div");
    extDiv.setAttribute(EXTENSION_MARKER, "");
    const extSpan = document.createElement("span");
    extSpan.textContent = "Should be skipped";
    extDiv.appendChild(extSpan);
    container.appendChild(extDiv);

    const span2 = document.createElement("span");
    span2.textContent = "Line two";
    container.appendChild(span2);

    expect(extractSubtitleText(container)).toBe("Line one Line two");
  });
});
