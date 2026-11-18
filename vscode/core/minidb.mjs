// A small stand-in for the IndexedDB calls ThirdNote's api.js makes, kept in memory and saved to one JSON file.
// Supports what api.js uses: object stores keyed by `id`, the topicId/sourceId indexes, get/put/delete/getAll,
// index getAll/getAllKeys/count, and transactions that roll back when they fail.
import fs from 'fs';
import path from 'path';

const STORES = ['topics', 'sources', 'messages', 'highlights', 'boards'];
const INDEXES = { sources: ['topicId'], messages: ['sourceId'], highlights: ['sourceId'] };

let file = null;
let data = null; // { storeName: Map(id -> value) }
let timer = null;
let onWrite = null;

const clone = (v) => (v === undefined ? v : structuredClone(v));

export function configure({ dbFile, onChange }) {
  file = dbFile;
  onWrite = onChange || null;
  data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const s of STORES) for (const v of raw[s] || []) if (v && v.id != null) data[s].set(v.id, v);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      try { fs.copyFileSync(file, `${file}.broken-${Date.now()}`); } catch { /* nothing to keep */ }
    }
  }
}

function snapshot() {
  return JSON.stringify(Object.fromEntries(STORES.map((s) => [s, [...data[s].values()]])));
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(flush, 200);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  if (!file || !data) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, snapshot());
  fs.renameSync(tmp, file);
}

// Direct access for the extension (code highlight anchors, migration). Writes are saved like api writes.
export function raw(store) { return data[store]; }
export function touched() { schedule(); if (onWrite) onWrite(); }

const done = (result) => ({ result });

function storeApi(name, journal, writable) {
  const map = data[name];
  if (!map) throw new Error(`No object store ${name}`);
  const remember = (id) => { if (writable && !journal.has(`${name}|${id}`)) journal.set(`${name}|${id}`, [name, id, map.has(id) ? map.get(id) : undefined]); };
  const api = {
    get: (id) => done(clone(map.get(id))),
    getAll: () => done([...map.values()].map(clone)),
    getAllKeys: () => done([...map.keys()]),
    count: () => done(map.size),
    put(v) {
      if (!writable) throw new Error('Read-only transaction');
      remember(v.id); map.set(v.id, clone(v)); return done(v.id);
    },
    add(v) {
      if (map.has(v.id)) throw new Error('Key already exists');
      return api.put(v);
    },
    delete(id) {
      if (!writable) throw new Error('Read-only transaction');
      remember(id); map.delete(id); return done(undefined);
    },
    clear() {
      if (!writable) throw new Error('Read-only transaction');
      for (const id of [...map.keys()]) api.delete(id);
      return done(undefined);
    },
    index(field) {
      if (!(INDEXES[name] || []).includes(field)) throw new Error(`No index ${field} on ${name}`);
      const match = (key) => [...map.values()].filter((v) => v[field] === key);
      return {
        getAll: (key) => done(match(key).map(clone)),
        getAllKeys: (key) => done(match(key).map((v) => v.id)),
        count: (key) => done(match(key).length),
      };
    },
  };
  return api;
}

export function reqP(req) {
  return Promise.resolve(req.result);
}

export async function openDb() {
  if (!data) throw new Error('ThirdNote storage is not ready');
  return true;
}

// Runs fn as one transaction. On error every change made inside it is undone.
export async function tx(stores, mode, fn) {
  await openDb();
  const writable = mode === 'readwrite';
  const journal = new Map();
  const t = { objectStore: (name) => storeApi(name, journal, writable) };
  try {
    const result = await fn(t);
    if (writable && journal.size) touched();
    return result;
  } catch (err) {
    for (const [, [name, id, prev]] of [...journal].reverse()) {
      if (prev === undefined) data[name].delete(id); else data[name].set(id, prev);
    }
    throw err;
  }
}
