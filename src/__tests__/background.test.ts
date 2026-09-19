import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ fetchProviderJson: vi.fn() }));
vi.mock("../core/translation-request.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../core/translation-request.ts")>(),
  fetchProviderJson: provider.fetchProviderJson,
}));

type MessageListener = (message: unknown, sender: { id?: string }, respond: (result: unknown) => void) => boolean;
let listener: MessageListener;
let createTab: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  createTab = vi.fn().mockResolvedValue({});
  provider.fetchProviderJson.mockResolvedValue({ ok: true, data: ["Olá"] });
  vi.stubGlobal("chrome", {
    runtime: {
      id: "streamfluent-test",
      getURL: (path: string) => `chrome-extension://streamfluent-test/${path}`,
      onMessage: { addListener: (next: MessageListener) => { listener = next; } },
    },
    tabs: { create: createTab },
  });
  await import("../background/background.ts");
});

afterEach(() => vi.unstubAllGlobals());

describe("background message boundary", () => {
  it("ignores messages without this extension's sender identity", () => {
    const respond = vi.fn();
    expect(listener({ type: "sf:open-library" }, { id: "another-extension" }, respond)).toBe(false);
    expect(listener({ type: "sf:provider-json", url: "https://clients5.google.com/translate_a/t" }, {}, respond)).toBe(false);
    expect(createTab).not.toHaveBeenCalled();
    expect(provider.fetchProviderJson).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it("ignores unknown and malformed messages", () => {
    const respond = vi.fn();
    for (const message of [null, false, "sf:open-library", {}, { type: "other" }]) {
      expect(listener(message, { id: "streamfluent-test" }, respond)).toBe(false);
    }
    expect(createTab).not.toHaveBeenCalled();
    expect(provider.fetchProviderJson).not.toHaveBeenCalled();
  });

  it("refuses off-list network requests before fetching", () => {
    const respond = vi.fn();
    expect(listener({ type: "sf:provider-json", url: "https://evil.example/collect" }, { id: "streamfluent-test" }, respond)).toBe(false);
    expect(respond).toHaveBeenCalledWith({ ok: false });
    expect(provider.fetchProviderJson).not.toHaveBeenCalled();
  });

  it("keeps the response channel open while an allowed provider request resolves", async () => {
    const respond = vi.fn();
    const url = "https://clients5.google.com/translate_a/t?q=Hello";
    expect(listener({ type: "sf:provider-json", url }, { id: "streamfluent-test" }, respond)).toBe(true);
    await Promise.resolve();
    expect(provider.fetchProviderJson).toHaveBeenCalledWith(url);
    expect(respond).toHaveBeenCalledWith({ ok: true, data: ["Olá"] });
  });

  it("opens only the extension library through the tabs API", () => {
    const respond = vi.fn();
    listener({ type: "sf:open-library", url: "https://evil.example" }, { id: "streamfluent-test" }, respond);
    expect(createTab).toHaveBeenCalledWith({ url: "chrome-extension://streamfluent-test/library.html" });
    expect(respond).toHaveBeenCalledWith({ ok: true });
  });
});
