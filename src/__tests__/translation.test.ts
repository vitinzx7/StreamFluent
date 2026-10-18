import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  cleanWord,
  clearTranslationCache,
  translateSentence,
  translateWord,
} from "../core/translation.ts";

const DICT_ENTRY = [
  {
    word: "run",
    phonetic: "/rʌn/",
    meanings: [
      { definitions: [{ definition: "To move swiftly on foot.", example: "I run daily." }] },
    ],
  },
];

/** Routes by host so each provider can be failed independently. */
function mockFetch(handlers: {
  google?: (url: string) => unknown;
  mymemory?: (url: string) => unknown;
  dictionary?: (url: string) => unknown;
}) {
  const fn = vi.fn(async (url: string) => {
    let body: unknown;
    if (url.includes("clients5.google.com")) body = handlers.google?.(url);
    else if (url.includes("mymemory")) body = handlers.mymemory?.(url);
    else body = handlers.dictionary?.(url);

    if (body === undefined) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => body };
  });

  vi.stubGlobal("fetch", fn);
  return fn;
}

const myMemoryOk = (text: string) => ({
  responseStatus: 200,
  responseData: { translatedText: text },
});

beforeEach(() => {
  clearTranslationCache();
  vi.unstubAllGlobals();
});

describe("cleanWord", () => {
  it("strips punctuation around a word", () => {
    expect(cleanWord("Hello,")).toBe("hello");
    expect(cleanWord('"Run!"')).toBe("run");
  });

  it("keeps accented Portuguese letters", () => {
    expect(cleanWord("Coração,")).toBe("coração");
    expect(cleanWord("não")).toBe("não");
  });

  it("keeps inner hyphens and apostrophes but trims outer ones", () => {
    expect(cleanWord("don't")).toBe("don't");
    expect(cleanWord("well-known")).toBe("well-known");
    expect(cleanWord("--word--")).toBe("word");
  });

  it("returns empty for input with no letters", () => {
    expect(cleanWord("...")).toBe("");
    expect(cleanWord("123")).toBe("");
  });
});

describe("translateSentence", () => {
  it("shares an in-flight request between the overlay and word card", async () => {
    let resolve!: (response: unknown) => void;
    const fetchFn = vi.fn(() => new Promise((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchFn);

    const first = translateSentence("Good morning.");
    const second = translateSentence("Good morning.");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    resolve({ ok: true, json: async () => ["Bom dia."] });
    expect(await Promise.all([first, second])).toEqual(["Bom dia.", "Bom dia."]);
  });

  it("does not let a cleared in-flight response populate the cache", async () => {
    let resolve!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
    const old = translateSentence("Good morning.");
    clearTranslationCache();
    resolve({ ok: true, json: async () => ["Antiga"] });
    await old;
    const freshFetch = mockFetch({ google: () => ["Bom dia."] });
    expect(await translateSentence("Good morning.")).toBe("Bom dia.");
    expect(freshFetch).toHaveBeenCalledTimes(1);
  });

  it("translates the whole line and reports the language pair", async () => {
    const fetchFn = mockFetch({ google: () => ["Mais um. Só mais um, por favor."] });

    const result = await translateSentence("One more. Just one more, please.", "en-pt");

    expect(result).toBe("Mais um. Só mais um, por favor.");
    expect(fetchFn.mock.calls[0][0]).toContain("sl=en");
    expect(fetchFn.mock.calls[0][0]).toContain("tl=pt-BR");
  });

  it("joins the chunks when the endpoint splits a line", async () => {
    mockFetch({ google: () => [["Mais um. ", "Só mais um."]] });

    expect(await translateSentence("One more. Just one more.", "en-pt")).toBe(
      "Mais um. Só mais um."
    );
  });

  it("caches per line so repeated subtitles cost nothing", async () => {
    const fetchFn = mockFetch({ google: () => ["Vamos"] });

    await translateSentence("Let's go", "en-pt");
    await translateSentence("Let's go", "en-pt");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await translateSentence("Let's go", "pt-en");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not cache an empty result", async () => {
    const fetchFn = mockFetch({});

    await translateSentence("Let's go", "en-pt");
    await translateSentence("Let's go", "en-pt");

    // 2 providers tried per attempt.
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("skips blank input entirely", async () => {
    const fetchFn = mockFetch({ google: () => ["x"] });

    expect(await translateSentence("   ", "en-pt")).toBe("");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("falls back to MyMemory when the primary endpoint fails", async () => {
    const fetchFn = mockFetch({ mymemory: () => myMemoryOk("Vamos") });

    expect(await translateSentence("Let's go", "en-pt")).toBe("Vamos");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("translateWord", () => {
  it("translates en->pt and adds the English definition", async () => {
    const fetchFn = mockFetch({
      google: () => ["correr"],
      dictionary: () => DICT_ENTRY,
    });

    const result = await translateWord("Run,", "en-pt");

    expect(result.translation).toBe("correr");
    expect(result.definition).toBe("To move swiftly on foot.");
    expect(result.phonetic).toBe("/rʌn/");
    expect(result.error).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("skips the English-only dictionary when translating pt->en", async () => {
    const fetchFn = mockFetch({ google: () => ["heart"] });

    const result = await translateWord("coração", "pt-en");

    expect(result.translation).toBe("heart");
    expect(result.definition).toBe("");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toContain("sl=pt-BR");
  });

  it("treats a MyMemory quota warning as no translation", async () => {
    mockFetch({
      mymemory: () =>
        myMemoryOk("MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY"),
    });

    const result = await translateWord("run", "pt-en");

    expect(result.translation).toBe("");
    expect(result.error).not.toBeNull();
  });

  it("ignores a non-200 responseStatus from MyMemory", async () => {
    mockFetch({ mymemory: () => ({ responseStatus: 403, responseData: { translatedText: "x" } }) });

    expect((await translateWord("run", "pt-en")).translation).toBe("");
  });

  it("still shows the definition when every translation provider fails", async () => {
    mockFetch({ dictionary: () => DICT_ENTRY });

    const result = await translateWord("run", "en-pt");

    expect(result.translation).toBe("");
    expect(result.definition).toBe("To move swiftly on foot.");
    expect(result.error).toBeNull();
  });

  it("reports an error when both lookups come back empty", async () => {
    mockFetch({});

    expect((await translateWord("run", "en-pt")).error).toBe("Translation unavailable.");
  });

  it("does not call the network for a word with no letters", async () => {
    const fetchFn = mockFetch({ google: () => ["x"] });

    const result = await translateWord("...", "en-pt");

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.error).not.toBeNull();
  });

  it("caches a successful lookup per word and direction", async () => {
    const fetchFn = mockFetch({ google: () => ["correr"], dictionary: () => DICT_ENTRY });

    await translateWord("run", "en-pt");
    await translateWord("Run!", "en-pt");
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await translateWord("run", "pt-en");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not cache a failed lookup", async () => {
    const fetchFn = mockFetch({});

    await translateWord("run", "en-pt");
    const afterFirst = fetchFn.mock.calls.length;
    await translateWord("run", "en-pt");

    expect(fetchFn.mock.calls.length).toBe(afterFirst * 2);
  });

  it("survives a network rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );

    expect((await translateWord("run", "en-pt")).error).toBe("Translation unavailable.");
  });
});

describe("a slow provider does not hold the translated line", () => {
  /** fetch whose providers answer after the given delays (ms), or fail when null. */
  function timedFetch(delays: { google: number | null; mymemory: number | null }) {
    const reply = (ok: boolean, body: unknown) => ({ ok, json: async () => body });
    const fn = vi.fn((url: string) => {
      const google = url.includes("clients5.google.com");
      const delay = google ? delays.google : delays.mymemory;
      const body = google ? [["Olá do Google"]] : myMemoryOk("Olá do MyMemory");
      return new Promise((resolve) => setTimeout(() => resolve(delay === null ? reply(false, {}) : reply(true, body)), delay ?? 0));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const asked = (fn: ReturnType<typeof vi.fn>, host: string) => fn.mock.calls.filter(([url]) => String(url).includes(host)).length;

  it("uses Google alone when it answers quickly", async () => {
    vi.useFakeTimers();
    const fn = timedFetch({ google: 300, mymemory: 0 });

    const result = translateSentence("Hello", "en-pt");
    await vi.advanceTimersByTimeAsync(300);

    expect(await result).toBe("Olá do Google");
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked(fn, "mymemory")).toBe(0);
    vi.useRealTimers();
  });

  it("asks MyMemory after 1.2 s and takes its answer while Google still hangs", async () => {
    vi.useFakeTimers();
    const fn = timedFetch({ google: 8000, mymemory: 200 });

    const result = translateSentence("Hello", "en-pt");
    await vi.advanceTimersByTimeAsync(1199);
    expect(asked(fn, "mymemory")).toBe(0);
    await vi.advanceTimersByTimeAsync(201);

    expect(await result).toBe("Olá do MyMemory");
    vi.useRealTimers();
  });

  it("asks MyMemory at once when Google fails", async () => {
    vi.useFakeTimers();
    const fn = timedFetch({ google: null, mymemory: 100 });

    const result = translateSentence("Hello", "en-pt");
    await vi.advanceTimersByTimeAsync(100);

    expect(asked(fn, "mymemory")).toBe(1);
    expect(await result).toBe("Olá do MyMemory");
    vi.useRealTimers();
  });

  it("reports no translation when both fail", async () => {
    vi.useFakeTimers();
    timedFetch({ google: null, mymemory: null });

    const result = translateSentence("Hello", "en-pt");
    await vi.advanceTimersByTimeAsync(2000);

    expect(await result).toBe("");
    vi.useRealTimers();
  });
});
