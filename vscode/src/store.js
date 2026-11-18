// Local storage for ThirdNote. One JSON file in the extension's global storage folder,
// so highlights and notes follow you across workspaces on this machine.
const vscode = require('vscode');

const COLORS = ['yellow', 'red', 'green', 'blue'];
const COLOR_LABELS = { yellow: 'Yellow', red: 'Red', green: 'Green', blue: 'Blue' };
const INBOX = 'inbox';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyData() {
  return { version: 1, collections: [], items: [], collecting: null };
}

class Store {
  constructor(context) {
    this.context = context;
    this.dir = context.globalStorageUri;
    this.file = vscode.Uri.joinPath(this.dir, 'thirdnote.json');
    this.data = emptyData();
    this._emitter = new vscode.EventEmitter();
    this.onDidChange = this._emitter.event;
    this._timer = null;
    this._writing = Promise.resolve();
  }

  async load() {
    try {
      const raw = await vscode.workspace.fs.readFile(this.file);
      const parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
      this.data = normalise(parsed);
    } catch (err) {
      if (!(err instanceof vscode.FileSystemError) && err && err.code !== 'FileNotFound') {
        // A broken file is kept aside so nothing is lost, then we start fresh.
        try {
          await vscode.workspace.fs.copy(this.file, vscode.Uri.joinPath(this.dir, `thirdnote-broken-${Date.now()}.json`), { overwrite: true });
        } catch { /* nothing to keep */ }
      }
      this.data = emptyData();
    }
  }

  // Write soon, coalescing bursts of changes (typing in a note, re-anchoring after edits).
  _schedule(fire = true) {
    if (fire) this._emitter.fire();
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this._timer);
    this._timer = null;
    const json = JSON.stringify(this.data, null, 1);
    this._writing = this._writing.then(async () => {
      await vscode.workspace.fs.createDirectory(this.dir);
      await vscode.workspace.fs.writeFile(this.file, Buffer.from(json, 'utf8'));
    }).catch((err) => {
      vscode.window.showErrorMessage(`ThirdNote could not save: ${err.message || err}`);
    });
    return this._writing;
  }

  // Persist changes made directly to items (for example after a file rename).
  touch() { this._schedule(); }

  // Collections
  get collections() { return this.data.collections; }
  collection(id) { return this.data.collections.find((c) => c.id === id); }
  collectionName(id) {
    if (!id || id === INBOX) return 'Inbox';
    const c = this.collection(id);
    return c ? c.name : 'Inbox';
  }
  addCollection(name) {
    const c = { id: uid(), name: name.trim(), createdAt: Date.now() };
    this.data.collections.push(c);
    this._schedule();
    return c;
  }
  renameCollection(id, name) {
    const c = this.collection(id);
    if (!c) return;
    c.name = name.trim();
    this._schedule();
  }
  deleteCollection(id, { keepItems = true } = {}) {
    this.data.collections = this.data.collections.filter((c) => c.id !== id);
    if (keepItems) {
      for (const it of this.data.items) if (it.collectionId === id) it.collectionId = INBOX;
    } else {
      this.data.items = this.data.items.filter((it) => it.collectionId !== id);
    }
    if (this.data.collecting === id) this.data.collecting = null;
    this._schedule();
  }

  get collecting() {
    const id = this.data.collecting;
    return id && (id === INBOX || this.collection(id)) ? id : null;
  }
  setCollecting(id) {
    this.data.collecting = id || null;
    this._schedule();
  }

  // Items
  get items() { return this.data.items; }
  item(id) { return this.data.items.find((it) => it.id === id); }
  itemsIn(collectionId) {
    return this.data.items
      .filter((it) => (it.collectionId || INBOX) === collectionId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  itemsForUri(uriString) {
    return this.data.items.filter((it) => it.kind === 'highlight' && it.source && it.source.uri === uriString);
  }
  addItem(fields) {
    const now = Date.now();
    const it = {
      id: uid(),
      kind: 'note',
      title: '',
      text: '',
      note: '',
      color: 'yellow',
      language: '',
      collectionId: INBOX,
      source: null,
      review: { seen: 0, known: 0, last: 0 },
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
    this.data.items.push(it);
    this._schedule();
    return it;
  }
  updateItem(id, patch, { quiet = false } = {}) {
    const it = this.item(id);
    if (!it) return null;
    Object.assign(it, patch);
    if (!quiet) it.updatedAt = Date.now();
    this._schedule(!quiet);
    return it;
  }
  deleteItem(id) {
    const before = this.data.items.length;
    this.data.items = this.data.items.filter((it) => it.id !== id);
    if (this.data.items.length !== before) this._schedule();
  }

  replaceAll(data) {
    this.data = normalise(data);
    this._schedule();
  }

  // Merge a backup: items and collections with ids we already have are skipped.
  merge(data) {
    const incoming = normalise(data);
    const haveC = new Set(this.data.collections.map((c) => c.id));
    const haveI = new Set(this.data.items.map((i) => i.id));
    let added = 0;
    for (const c of incoming.collections) if (!haveC.has(c.id)) this.data.collections.push(c);
    for (const it of incoming.items) if (!haveI.has(it.id)) { this.data.items.push(it); added++; }
    this._schedule();
    return added;
  }
}

function normalise(d) {
  const out = emptyData();
  if (!d || typeof d !== 'object') return out;
  if (Array.isArray(d.collections)) {
    out.collections = d.collections.filter((c) => c && c.id && typeof c.name === 'string');
  }
  if (Array.isArray(d.items)) {
    out.items = d.items
      .filter((it) => it && it.id)
      .map((it) => ({
        kind: 'note', title: '', text: '', note: '', color: 'yellow', language: '', collectionId: INBOX, source: null,
        review: { seen: 0, known: 0, last: 0 }, createdAt: Date.now(), updatedAt: Date.now(),
        ...it,
        color: COLORS.includes(it.color) ? it.color : 'yellow',
      }));
  }
  out.collecting = typeof d.collecting === 'string' ? d.collecting : null;
  return out;
}

module.exports = { Store, COLORS, COLOR_LABELS, INBOX, uid };
