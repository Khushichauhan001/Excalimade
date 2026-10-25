// Minimal promise wrapper around IndexedDB (no deps). One DB, three object stores.
export type IDBStoreName = "scene" | "files" | "library";

const DB_NAME = "excalimade-io";
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const name of ["scene", "files", "library"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

async function tx<T>(store: IDBStoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void) {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    let result: T;
    if (r) r.onsuccess = () => (result = r.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("Transaction aborted"));
  });
}

export const idbGet = <T>(store: IDBStoreName, key: string) => tx<T | undefined>(store, "readonly", (s) => s.get(key));
export const idbSet = (store: IDBStoreName, key: string, value: unknown) =>
  tx<IDBValidKey>(store, "readwrite", (s) => s.put(value, key)).then(() => undefined);
export const idbDelete = (store: IDBStoreName, key: string) =>
  tx<undefined>(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
export const idbKeys = (store: IDBStoreName) =>
  tx<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()).then((k) => (k ?? []).map(String));

/** Write many records in one transaction (keeps file autosave cheap). */
export async function idbPutMany(store: IDBStoreName, entries: [string, unknown][], deletes: string[] = []) {
  if (!entries.length && !deletes.length) return;
  await tx<undefined>(store, "readwrite", (s) => {
    for (const [k, v] of entries) s.put(v, k);
    for (const k of deletes) s.delete(k);
  });
}

/** Read all [key, value] pairs of a store. */
export async function idbEntries<T>(store: IDBStoreName): Promise<[string, T][]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const s = t.objectStore(store);
    const keysReq = s.getAllKeys();
    const valsReq = s.getAll();
    t.oncomplete = () => resolve(keysReq.result.map((k, i) => [String(k), valsReq.result[i] as T]));
    t.onerror = () => reject(t.error);
  });
}

export const isQuotaError = (err: unknown) =>
  err instanceof DOMException &&
  (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22);
