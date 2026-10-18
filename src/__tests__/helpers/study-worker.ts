import { vi } from "vitest";
import { createStudyStorageService } from "../../core/study-storage.ts";
import { createMemorySeenStore } from "../../core/seen-store.ts";

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

/** Exercises clients against the real queue, with an in-process MV3 transport. */
export function installStudyWorker(initial: Record<string, unknown> = {}) {
  const storage: Record<string, unknown> = structuredClone(initial);
  const listeners = new Set<Listener>();
  let failure: Error | null = null;
  const local = {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      const requested = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : keys ? Object.keys(keys) : Object.keys(storage);
      return structuredClone(Object.fromEntries(requested.map((key) => [key, storage[key]])));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      if (failure) { const error = failure; failure = null; throw error; }
      const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { oldValue: storage[key], newValue: structuredClone(value) }]));
      Object.assign(storage, structuredClone(items));
      listeners.forEach((listener) => listener(changes, "local"));
    }),
  };
  const extensionId = "a".repeat(32);
  // The seen history survives restarts like the worker's IndexedDB does.
  const seen = createMemorySeenStore();
  const create = () => createStudyStorageService(local as unknown as Pick<chrome.storage.LocalStorageArea, "get" | "set">, seen);
  let service = create();
  const sendMessage = vi.fn(async (message: unknown) => service.handle(message, {
    id: extensionId, url: `chrome-extension://${extensionId}/library.html`, frameId: 0,
  }));
  vi.stubGlobal("chrome", {
    runtime: { id: extensionId, sendMessage },
    storage: { local, onChanged: { addListener: (listener: Listener) => listeners.add(listener), removeListener: (listener: Listener) => listeners.delete(listener) } },
  });
  return {
    storage, local, sendMessage,
    failNextWrite(error = new Error("QUOTA_BYTES quota exceeded")) { failure = error; },
    seen,
    restart() { service = create(); },
    emit(changes: Record<string, chrome.storage.StorageChange>) { listeners.forEach((listener) => listener(changes, "local")); },
  };
}
