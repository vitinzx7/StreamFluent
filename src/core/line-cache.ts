/**
 * Translations of whole subtitle lines, kept in the worker's IndexedDB so a
 * line translated once comes back at once, also after a reload: rewatching an
 * episode shows the original and its translation together without waiting.
 * Only lines already shown (and already sent to the translator) are stored;
 * nothing leaves the machine. "Apagar todos os dados" clears it.
 */
export interface LineCache {
  get(key: string): Promise<string | null>;
  put(key: string, translation: string): Promise<void>;
  clear(): Promise<void>;
}

/** About 3 MB of lines; past it the oldest go first. */
export const LINE_CACHE_LIMIT = 20000;
const MAX_KEY = 1000;
const MAX_TRANSLATION = 2000;

/** For tests and as a reference implementation. */
export function createMemoryLineCache(limit = LINE_CACHE_LIMIT): LineCache {
  const lines = new Map<string, string>();
  return {
    get: async (key) => lines.get(key) ?? null,
    async put(key, translation) {
      lines.delete(key);
      lines.set(key, translation);
      for (const oldest of lines.keys()) {
        if (lines.size <= limit) break;
        lines.delete(oldest);
      }
    },
    clear: async () => lines.clear(),
  };
}

const DATABASE = "streamfluent-lines";
const STORE = "lines";
const BY_AGE = "at";

const settled = (request: IDBRequest | IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    if ("oncomplete" in request) {
      request.oncomplete = () => resolve();
      request.onabort = request.onerror = () => reject(request.error ?? new Error("IndexedDB abortou a gravação."));
    } else {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }
  });

/** Rows are `{ text, at }` keyed by direction and line; the `at` index finds the oldest. */
export function createIndexedDbLineCache(factory: () => IDBFactory = () => indexedDB, limit = LINE_CACHE_LIMIT): LineCache {
  let database: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory().open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE).createIndex(BY_AGE, BY_AGE);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      database = null;
      throw error;
    });
    return database;
  };

  return {
    async get(key) {
      const request = (await open()).transaction(STORE, "readonly").objectStore(STORE).get(key);
      await settled(request);
      const text = (request.result as { text?: unknown } | undefined)?.text;
      return typeof text === "string" ? text : null;
    },
    async put(key, translation) {
      const transaction = (await open()).transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      store.put({ text: translation, at: Date.now() }, key);
      const count = store.count();
      count.onsuccess = () => {
        // Trim a tenth below the limit at once, so this does not run on every line.
        let excess = count.result - limit;
        if (excess <= 0) return;
        excess += Math.floor(limit / 10);
        const cursor = store.index(BY_AGE).openKeyCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current || excess-- <= 0) return;
          store.delete(current.primaryKey);
          current.continue();
        };
      };
      await settled(transaction);
    },
    async clear() {
      const transaction = (await open()).transaction(STORE, "readwrite");
      transaction.objectStore(STORE).clear();
      await settled(transaction);
    },
  };
}

export interface LineCacheMessage {
  type: "sf:line-cache";
  op: "get" | "put";
  key: string;
  text?: string;
}

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

/** Worker side: the caller already checked the sender is this extension. */
export async function handleLineCacheMessage(cache: LineCache, message: unknown): Promise<{ ok: boolean; text?: string | null }> {
  const request = (message !== null && typeof message === "object" ? message : {}) as Partial<LineCacheMessage>;
  if (!isText(request.key, MAX_KEY)) return { ok: false };
  try {
    if (request.op === "get") return { ok: true, text: await cache.get(request.key) };
    if (request.op === "put" && isText(request.text, MAX_TRANSLATION)) {
      await cache.put(request.key, request.text);
      return { ok: true };
    }
  } catch {
    // A cache that cannot be read or written only means translating again.
  }
  return { ok: false };
}

/** Outside the extension (tests, the local fixture page) there is no worker to keep lines. */
export const canSaveLines = (): boolean => typeof chrome !== "undefined" && !!chrome.runtime?.id;

/** Content side: a stored translation, or null (none, or no extension around). */
export async function readSavedLine(key: string): Promise<string | null> {
  if (!canSaveLines()) return null;
  try {
    const reply = await chrome.runtime.sendMessage({ type: "sf:line-cache", op: "get", key } satisfies LineCacheMessage);
    return reply?.ok && typeof reply.text === "string" ? reply.text : null;
  } catch {
    return null;
  }
}

/** Content side: fire and forget; a failed write only means translating again next time. */
export function saveLine(key: string, translation: string): void {
  if (!canSaveLines()) return;
  void chrome.runtime.sendMessage({ type: "sf:line-cache", op: "put", key, text: translation } satisfies LineCacheMessage).catch(() => {});
}
