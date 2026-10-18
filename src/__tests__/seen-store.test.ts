import { describe, expect, it } from "vitest";
import { createMemorySeenStore } from "../core/seen-store.ts";

describe("seen-word store", () => {
  it("reports a word as fresh only the first time, per language", async () => {
    const store = createMemorySeenStore({ en: ["hello"] });

    expect(await store.add("en", ["hello", "world", "world"])).toEqual(["world"]);
    expect(await store.add("en", ["world"])).toEqual([]);
    expect(await store.add("pt-BR", ["world"])).toEqual(["world"]);
  });

  it("does not count a word as seen when its write failed", async () => {
    const store = createMemorySeenStore();
    store.failNextWrite();

    await expect(store.add("en", ["hello"])).rejects.toThrow();
    expect(await store.add("en", ["hello"])).toEqual(["hello"]);
  });

  it("lists everything for backups and forgets one language or all", async () => {
    const store = createMemorySeenStore({ en: ["a"], "pt-BR": ["b"] });

    expect(await store.all()).toEqual({ en: ["a"], "pt-BR": ["b"] });
    await store.clear("en");
    expect(await store.add("en", ["a"])).toEqual(["a"]);
    await store.clear();
    expect(await store.all()).toEqual({});
  });
});
