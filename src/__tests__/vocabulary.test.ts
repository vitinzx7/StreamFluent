import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createVocabularyStore, wordKey, type VocabularyStore } from "../core/vocabulary.ts";

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

let storage: Record<string, unknown>;
let listeners: Listener[];
let failNextSet: boolean;
const stores: VocabularyStore[] = [];

/** Real timers with a zero delay: lets each async write finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function create(flushDelayMs = 0): VocabularyStore {
  const store = createVocabularyStore(flushDelayMs);
  stores.push(store);
  return store;
}

/** What another tab or page writing the vocabulary looks like from here. */
async function writeFromElsewhere(value: unknown) {
  await chrome.storage.local.set({ vocabulary: value });
}

beforeEach(() => {
  storage = {};
  listeners = [];
  failNextSet = false;

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(storage[key]) }),
        set: async (items: Record<string, unknown>) => {
          if (failNextSet) {
            failNextSet = false;
            throw new Error("QUOTA_BYTES quota exceeded");
          }
          Object.assign(storage, structuredClone(items));
          const changes = Object.fromEntries(
            Object.entries(items).map(([k, v]) => [k, { newValue: structuredClone(v) }])
          );
          listeners.forEach((l) => l(changes, "local"));
        },
      },
      onChanged: {
        addListener: (l: Listener) => listeners.push(l),
        removeListener: (l: Listener) => {
          listeners = listeners.filter((x) => x !== l);
        },
      },
    },
  });
});

afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose());
  vi.unstubAllGlobals();
});

const stored = () => storage.vocabulary as Record<string, { seen: string[]; marks: Record<string, string> }>;

describe("wordKey", () => {
  it("normalises like the lookups do", () => {
    expect(wordKey("Hello,")).toBe("hello");
    expect(wordKey("Coração!")).toBe("coração");
    expect(wordKey("don't")).toBe("don't");
    expect(wordKey("...")).toBe("");
  });
});

describe("new words", () => {
  it("reports nothing as new before the stored words have loaded", async () => {
    const store = create();

    expect(store.observeLine("Hello world", "en").size).toBe(0);

    await store.ready;
    expect([...store.observeLine("Hello world", "en")]).toEqual(["hello", "world"]);
  });

  it("is new only the first time, whatever the case or punctuation", async () => {
    const store = create();
    await store.ready;

    expect([...store.observeLine("Hello, world!", "en")]).toEqual(["hello", "world"]);
    expect(store.observeLine("hello WORLD", "en").size).toBe(0);
    expect([...store.observeLine("Hello there.", "en")]).toEqual(["there"]);
  });

  it("ignores tokens with no letters", async () => {
    const store = create();
    await store.ready;

    expect(store.observeLine("- ♪ ... 123", "en").size).toBe(0);
  });

  it("keeps languages apart", async () => {
    const store = create();
    await store.ready;
    store.observeLine("a casa", "pt-BR");

    expect([...store.observeLine("a house", "en")]).toEqual(["a", "house"]);
  });

  it("remembers words seen in an earlier session", async () => {
    storage.vocabulary = { en: { seen: ["hello"], marks: {} } };
    const store = create();
    await store.ready;

    expect([...store.observeLine("Hello world", "en")]).toEqual(["world"]);
  });

  it("writes seen words to storage after the delay", async () => {
    const store = create();
    await store.ready;
    store.observeLine("Hello world", "en");
    await settle();

    expect(stored().en.seen).toEqual(["hello", "world"]);
  });
});

describe("marks", () => {
  it("sets, reads regardless of case, and clears a mark", async () => {
    const store = create();
    await store.ready;

    store.setMark("Hello", "en", "difficult");
    expect(store.getMark("HELLO,", "en")).toBe("difficult");
    expect(store.getMark("Hello", "pt-BR")).toBeNull();

    store.setMark("hello", "en", null);
    expect(store.getMark("Hello", "en")).toBeNull();
  });

  it("persists a mark and can clear it from storage", async () => {
    const store = create();
    await store.ready;

    store.setMark("Hello", "en", "marked");
    await settle();
    expect(stored().en.marks).toEqual({ hello: "marked" });

    store.setMark("Hello", "en", null);
    await settle();
    expect(stored().en.marks).toEqual({});
  });

  it("loads marks from an earlier session", async () => {
    storage.vocabulary = { en: { seen: ["fear"], marks: { fear: "difficult" } } };
    const store = create();
    await store.ready;

    expect(store.getMark("Fear", "en")).toBe("difficult");
  });
});

describe("several tabs", () => {
  it("merges its writes with what another tab stored meanwhile", async () => {
    const store = create(30);
    await store.ready;
    store.setMark("hello", "en", "marked");
    store.observeLine("hello", "en");

    await writeFromElsewhere({ en: { seen: ["other"], marks: { other: "difficult" } } });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(new Set(stored().en.seen)).toEqual(new Set(["other", "hello"]));
    expect(stored().en.marks).toEqual({ other: "difficult", hello: "marked" });
  });

  it("drops a mark that was cleared elsewhere and tells its listeners", async () => {
    storage.vocabulary = { en: { seen: ["hello"], marks: { hello: "difficult" } } };
    const store = create();
    await store.ready;
    const changed = vi.fn();
    store.onChange(changed);

    await writeFromElsewhere({ en: { seen: ["hello"], marks: {} } });

    expect(store.getMark("hello", "en")).toBeNull();
    expect(changed).toHaveBeenCalled();
  });

  it("keeps an unsaved local mark when another tab writes first", async () => {
    const store = create(30);
    await store.ready;
    store.setMark("hello", "en", "marked");

    await writeFromElsewhere({ en: { seen: [], marks: {} } });

    expect(store.getMark("hello", "en")).toBe("marked");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(stored().en.marks).toEqual({ hello: "marked" });
  });
});

describe("robustness", () => {
  it("ignores malformed stored data instead of failing", async () => {
    storage.vocabulary = {
      en: { seen: [1, "ok", "", null], marks: { a: "bogus", b: "marked" } },
      broken: 5,
    };
    const store = create();
    await store.ready;

    expect([...store.observeLine("ok fine", "en")]).toEqual(["fine"]);
    expect(store.getMark("b", "en")).toBe("marked");
    expect(store.getMark("a", "en")).toBeNull();
  });

  it("keeps changes from a failed write and saves them with the next one", async () => {
    const store = create();
    await store.ready;
    failNextSet = true;
    store.observeLine("hello", "en");
    await settle();
    expect(storage.vocabulary).toBeUndefined();

    store.observeLine("world", "en");
    await settle();
    expect(new Set(stored().en.seen)).toEqual(new Set(["hello", "world"]));
  });

  it("writes what is pending on dispose and stops notifying", async () => {
    const store = create(60_000);
    await store.ready;
    const changed = vi.fn();
    store.onChange(changed);
    store.observeLine("hello", "en");

    store.dispose();
    await settle();
    expect(stored().en.seen).toEqual(["hello"]);

    changed.mockClear();
    await writeFromElsewhere({ en: { seen: [], marks: {} } });
    expect(changed).not.toHaveBeenCalled();
  });
});
