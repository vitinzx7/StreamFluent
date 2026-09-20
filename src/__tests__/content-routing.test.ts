import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ top: vi.fn(), embedded: vi.fn(), getAdapter: vi.fn(), stop: vi.fn() }));
vi.mock("../content/cinetaro-session.ts", () => ({ startCinetaroTop: mocks.top, startEmbeddedPlayer: mocks.embedded }));
vi.mock("../adapters/registry.ts", () => ({ getAdapter: mocks.getAdapter }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.top.mockReturnValue(mocks.stop);
  mocks.embedded.mockReturnValue(mocks.stop);
  mocks.getAdapter.mockReturnValue(null);
});
afterEach(() => {
  const lifecycle = globalThis as typeof globalThis & { __streamfluentCleanup?: () => void };
  lifecycle.__streamfluentCleanup?.();
  delete lifecycle.__streamfluentCleanup;
  vi.unstubAllGlobals();
});

async function boot(url: string, child = false) {
  const fakeWindow = { top: null as unknown, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  fakeWindow.top = child ? {} : fakeWindow;
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("location", new URL(url));
  await import("../content/content.ts");
}

describe("content frame routing", () => {
  it("starts the coordinator only in the Cinetaro top document", async () => {
    await boot("https://cinetaro.to/watch/1");
    expect(mocks.top).toHaveBeenCalledTimes(1);
    expect(mocks.embedded).not.toHaveBeenCalled();
    expect(mocks.getAdapter).not.toHaveBeenCalled();
  });

  it("starts the embedded player for a cinextream child frame", async () => {
    await boot("https://cinextream.cc/embed/1", true);
    expect(mocks.embedded).toHaveBeenCalledTimes(1);
    expect(mocks.top).not.toHaveBeenCalled();
    expect(mocks.getAdapter).not.toHaveBeenCalled();
  });

  it("does not activate cinextream when opened as a standalone site", async () => {
    await boot("https://cinextream.cc/embed/1");
    expect(mocks.embedded).not.toHaveBeenCalled();
    expect(mocks.top).not.toHaveBeenCalled();
  });
});
