/**
 * Every word ever shown in a subtitle, per language — the history behind
 * "new" (blue) and "seen" (white). It only grows, can reach tens of
 * thousands of words, and is read on every subtitle line, so it lives in the
 * worker's IndexedDB, one row per word, with an in-memory index: a line costs
 * a few Set lookups, and only words never seen before are written.
 */
export interface SeenStore {
  /** Records `keys`, resolving with the ones seen for the first time — once they are durable. */
  add(language: string, keys: readonly string[]): Promise<string[]>;
  /** Every language's words, for backups. */
  all(): Promise<Record<string, string[]>>;
  /** Forgets one language, or every one. */
  clear(language?: string): Promise<void>;
}

/** Shared bookkeeping: an index per language, loaded once, updated only after a write lands. */
function createIndexedStore(backend: {
  load(language: string): Promise<string[]>;
  write(language: string, keys: string[]): Promise<void>;
  all(): Promise<Record<string, string[]>>;
  clear(language?: string): Promise<void>;
}): SeenStore {
  const index = new Map<string, Set<string>>();
  const loaded = async (language: string): Promise<Set<string>> => {
    let words = index.get(language);
    if (!words) {
      words = new Set(await backend.load(language));
      index.set(language, words);
    }
    return words;
  };

  return {
    async add(language, keys) {
      const words = await loaded(language);
      const fresh = [...new Set(keys)].filter((key) => !words.has(key));
      if (fresh.length) {
        await backend.write(language, fresh);
        for (const key of fresh) words.add(key);
      }
      return fresh;
    },
    all: () => backend.all(),
    async clear(language) {
      await backend.clear(language);
      if (language === undefined) index.clear();
      else index.delete(language);
    },
  };
}

/** For tests and as a reference implementation. */
export function createMemorySeenStore(initial: Record<string, string[]> = {}): SeenStore & { failNextWrite(): void } {
  const data = new Map(Object.entries(initial).map(([language, words]) => [language, new Set(words)]));
  let fail = false;
  const store = createIndexedStore({
    load: async (language) => [...(data.get(language) ?? [])],
    async write(language, keys) {
      if (fail) {
        fail = false;
        throw new Error("Falha ao gravar o histórico.");
      }
      const words = data.get(language) ?? new Set<string>();
      for (const key of keys) words.add(key);
      data.set(language, words);
    },
    all: async () => Object.fromEntries([...data].map(([language, words]) => [language, [...words]])),
    async clear(language) {
      if (language === undefined) data.clear();
      else data.delete(language);
    },
  });
  return { ...store, failNextWrite: () => { fail = true; } };
}

const DATABASE = "streamfluent";
const STORE = "seen";

const done = (request: IDBRequest | IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    if ("oncomplete" in request) {
      request.oncomplete = () => resolve();
      request.onabort = request.onerror = () => reject(request.error ?? new Error("IndexedDB abortou a gravação."));
    } else {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }
  });

/**
 * Rows are keyed `[language, word]`. In IndexedDB key order every array sorts
 * after every string, so `[language, ""]`…`[language, []]` spans one language.
 */
export function createIndexedDbSeenStore(factory: () => IDBFactory = () => indexedDB): SeenStore {
  let database: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory().open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another context upgrading must not be blocked by us: reopen next time.
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
  const range = (language: string): IDBKeyRange => IDBKeyRange.bound([language, ""], [language, []]);
  const keysOf = async (query?: IDBKeyRange): Promise<IDBValidKey[]> => {
    const store = (await open()).transaction(STORE, "readonly").objectStore(STORE);
    const request = store.getAllKeys(query);
    await done(request);
    return request.result;
  };

  return createIndexedStore({
    async load(language) {
      return (await keysOf(range(language))).map((key) => (key as [string, string])[1]);
    },
    async write(language, keys) {
      const transaction = (await open()).transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const key of keys) store.put(1, [language, key]);
      await done(transaction);
    },
    async all() {
      const result: Record<string, string[]> = Object.create(null);
      for (const key of await keysOf()) {
        const [language, word] = key as [string, string];
        (result[language] ??= []).push(word);
      }
      return result;
    },
    async clear(language) {
      const transaction = (await open()).transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      if (language === undefined) store.clear();
      else store.delete(range(language));
      await done(transaction);
    },
  });
}
