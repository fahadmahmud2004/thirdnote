// IndexedDB storage. Lives in the extension origin, so it is shared by the
// background worker and every extension page (side panel, reader, options).

const DB_NAME = 'notemate';
const DB_VERSION = 2;

let dbPromise = null;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const has = (name) => db.objectStoreNames.contains(name);
        if (!has('topics')) db.createObjectStore('topics', { keyPath: 'id' });
        if (!has('sources')) db.createObjectStore('sources', { keyPath: 'id' }).createIndex('topicId', 'topicId');
        if (!has('messages')) db.createObjectStore('messages', { keyPath: 'id' }).createIndex('sourceId', 'sourceId');
        if (!has('highlights')) db.createObjectStore('highlights', { keyPath: 'id' }).createIndex('sourceId', 'sourceId');
        // v2: one free-form board per collection, keyed by its topic id.
        if (!has('boards')) db.createObjectStore('boards', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

export function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Runs fn inside one transaction and resolves with fn's return value once the
// transaction commits. fn may await IDB requests (via reqP) but nothing else.
export async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve()
      .then(() => fn(t))
      .then(
        (r) => { result = r; },
        (err) => {
          try { t.abort(); } catch { /* already finished */ }
          reject(err);
        },
      );
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}
