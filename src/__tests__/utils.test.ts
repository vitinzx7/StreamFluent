import { describe, it, expect } from "vitest";
import { generateId } from "../core/utils.ts";

describe("generateId", () => {
  it("returns a string", () => {
    expect(typeof generateId()).toBe("string");
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it("contains a dash separator", () => {
    const id = generateId();
    expect(id).toContain("-");
  });
});
