import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchProviderJson, isAllowedProviderUrl, requestProviderJson } from "../core/translation-request.ts";
import { clearTranslationCache, translateSentence } from "../core/translation.ts";

const GOOGLE = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=pt-BR&q=Hello";

beforeEach(() => {
  vi.stubGlobal("chrome", undefined);
  clearTranslationCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("provider URL boundary", () => {
  it.each([
    GOOGLE,
    "https://api.mymemory.translated.net/get?q=Hello&langpair=en%7Cpt-BR",
    "https://api.dictionaryapi.dev/api/v2/entries/en/hello",
  ])("accepts the existing provider endpoint: %s", (url) => {
    expect(isAllowedProviderUrl(url)).toBe(true);
  });

  it.each([
    "http://clients5.google.com/translate_a/t",
    "https://clients5.google.com.evil.example/translate_a/t",
    "https://clients5.google.com/other",
    "https://user:password@clients5.google.com/translate_a/t",
    "https://clients5.google.com:8443/translate_a/t",
    "https://api.dictionaryapi.dev/api/v2/entries/en/hello/extra",
    "https://api.dictionaryapi.dev/api/v2/entries/en/../private",
    "https://api.mymemory.translated.net/account",
    "data:application/json,{}",
    "//clients5.google.com/translate_a/t",
    "not a URL",
    null,
    { url: GOOGLE },
    `${GOOGLE}${"x".repeat(16000)}`,
  ])("rejects arbitrary URLs, credentials, paths and oversized input: %s", (url) => {
    expect(isAllowedProviderUrl(url)).toBe(false);
  });

  it("does not fetch a rejected URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchProviderJson("https://evil.example/collect")).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("provider transport", () => {
  it("omits cookies and referrers, refuses redirects and bounds request duration", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ["Olá"] });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchProviderJson(GOOGLE)).toEqual({ ok: true, data: ["Olá"] });
    expect(fetchMock).toHaveBeenCalledWith(GOOGLE, expect.objectContaining({
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
    expect(timeout).toHaveBeenCalledWith(10000);
  });

  it.each(["http", "json", "network"])("returns a failure for %s errors", async (failure) => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failure === "network") throw new TypeError("Network failure or rejected redirect");
      return {
        ok: failure !== "http",
        json: async () => { throw new SyntaxError("Invalid JSON"); },
      };
    }));
    expect(await fetchProviderJson(GOOGLE)).toEqual({ ok: false });
  });

  it("uses the service worker from a content script without a page fetch", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data: ["Olá"] });
    const fetchMock = vi.fn();
    vi.stubGlobal("chrome", { runtime: { id: "extension-id", sendMessage } });
    vi.stubGlobal("fetch", fetchMock);

    expect(await requestProviderJson(GOOGLE)).toEqual(["Olá"]);
    expect(sendMessage).toHaveBeenCalledWith({ type: "sf:provider-json", url: GOOGLE });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not treat worker rejection as translated text", async () => {
    vi.stubGlobal("chrome", { runtime: {
      id: "extension-id",
      sendMessage: vi.fn().mockResolvedValue({ ok: false, data: "not a translation" }),
    } });
    expect(await requestProviderJson(GOOGLE)).toBeNull();
  });

  it("falls back after a timed out primary request instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds);
      return controller.signal;
    });
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      if (url.includes("clients5.google.com")) {
        return new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("Timed out")), { once: true });
        });
      }
      return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: "Olá" } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = translateSentence("Hello", "en-pt");
    await vi.advanceTimersByTimeAsync(10000);

    expect(await pending).toBe("Olá");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("api.mymemory.translated.net/get");
  });
});
