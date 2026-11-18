// ThirdNote data in the extension host: the browser extension's api.js over minidb, plus VS Code's view of it
// (code highlights with their place in a file, the collection new saves go to, page storage).
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const KIND_SITE = 'VS Code';

const squeeze = (s) => (s || '').replace(/[\s​‌‍﻿]+/g, '');
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function codeHtml(text, language) {
  return `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(text)}</code></pre>`;
}
function textHtml(text) {
  return String(text || '').split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

class Core {
  constructor(context) {
    this.context = context;
    this._emitter = new vscode.EventEmitter();
    this.onDidChange = this._emitter.event; // { method, sourceId } after any change
    this._storageEmitter = new vscode.EventEmitter();
    this.onDidChangeStorage = this._storageEmitter.event; // items that changed
  }

  async init() {
    const dir = this.context.globalStorageUri.fsPath;
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(this.context.extensionPath, 'core');
    this.db = await import(pathToFileURL(path.join(base, 'minidb.mjs')).href);
    this.db.configure({ dbFile: path.join(dir, 'thirdnote-db.json') });
    const mod = await import(pathToFileURL(path.join(base, 'api.mjs')).href);
    this.api = mod.api;
    this.MUTATING = mod.MUTATING;
    await this.migrateV1(dir);
  }

  flush() { if (this.db) this.db.flush(); }

  // ---------- calls from pages and commands ----------
  async rpc(method, args = {}) {
    const fn = this.api[method];
    if (typeof fn !== 'function') return { ok: false, error: `Unknown method ${method}` };
    try {
      const result = await fn.call(this.api, args);
      if (this.MUTATING.has(method)) this.changed(method, args);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async call(method, args) {
    const res = await this.rpc(method, args);
    if (!res.ok) throw new Error(res.error);
    return res.result;
  }

  changed(method, args = {}) {
    const sourceId = args.sourceId || (/Source$/.test(method) ? args.id : undefined);
    this._codeCache = null;
    this._emitter.fire({ type: 'nm-changed', method, sourceId });
  }

  // ---------- page storage (chrome.storage.local) ----------
  get storage() { return this.context.globalState.get('tn.storage') || {}; }
  setStorage(items) {
    const next = { ...this.storage, ...items };
    this.context.globalState.update('tn.storage', next);
    this._storageEmitter.fire(items);
  }
  removeStorage(keys) {
    const next = { ...this.storage };
    for (const k of keys) delete next[k];
    this.context.globalState.update('tn.storage', next);
  }

  // ---------- collections ----------
  async topics() { return this.call('listTopics'); }

  // Where new saves go: the collection marked "Collecting", else the one picked last in VS Code, else "VS Code / Inbox".
  async targetTopic() {
    const st = this.storage;
    const topics = await this.topics();
    if (st.collecting && st.activeTopicId && topics.some((t) => t.id === st.activeTopicId)) return st.activeTopicId;
    if (st.vscodeTopicId && topics.some((t) => t.id === st.vscodeTopicId)) return st.vscodeTopicId;
    const t = await this.call('saveTopic', { subject: 'VS Code', name: 'Inbox' });
    this.setStorage({ vscodeTopicId: t.id });
    return t.id;
  }

  topicLabel(t) { return t ? `${t.subject} / ${t.name}` : ''; }

  // ---------- code highlights ----------
  async fileSource(doc, topicId) {
    const uri = doc.uri.toString();
    const id = `code:${topicId}:${uri}`;
    const rel = vscode.workspace.asRelativePath(doc.uri, true);
    await this.call('trackSource', { id, kind: 'page', site: KIND_SITE, url: uri, title: rel, topicId, tracked: false, pageKey: uri });
    return id;
  }

  // Saves a selection as a clip in the file's source. With an anchor it is drawn in the editor and follows edits.
  async addCode({ doc, range, text, color, note, anchor, topicId }) {
    topicId = topicId || (await this.targetTopic());
    const sourceId = await this.fileSource(doc, topicId);
    const hl = await this.call('addClip', { sourceId, html: codeHtml(text, doc.languageId), text, color, note: note || '' });
    if (anchor) {
      const rec = this.db.raw('highlights').get(hl.id);
      rec.code = { ...anchor, language: doc.languageId };
      this.db.touched();
      this.changed('updateHighlight', { sourceId });
    }
    return hl;
  }

  async addTextNote(text, topicId, { asCode = false, language = '' } = {}) {
    topicId = topicId || (await this.targetTopic());
    return this.call('addNote', { topicId, html: asCode ? codeHtml(text, language) : textHtml(text), text });
  }

  // All highlights drawn in editors, shaped for the decorations code.
  codeItems() {
    if (this._codeCache) return this._codeCache;
    const sources = this.db.raw('sources');
    const out = [];
    for (const h of this.db.raw('highlights').values()) {
      if (!h.code || !h.code.uri) continue;
      const src = sources.get(h.sourceId);
      out.push({ id: h.id, kind: 'highlight', text: h.text, note: h.note || '', color: h.color || 'yellow', collectionId: src ? src.topicId : null, sourceId: h.sourceId, source: h.code, language: h.code.language || '' });
    }
    this._codeCache = out;
    return out;
  }
  get items() { return this.codeItems(); }
  item(id) { return this.codeItems().find((x) => x.id === id); }
  itemsForUri(uri) { return this.codeItems().filter((x) => x.source.uri === uri); }

  // Called by the decorations code as code moves or changes: keep the stored text and place current.
  updateItem(id, patch, { quiet = false } = {}) {
    const h = this.db.raw('highlights').get(id);
    if (!h) return;
    if (patch.source) h.code = { ...h.code, ...patch.source };
    if (typeof patch.text === 'string' && patch.text !== h.text) {
      h.text = patch.text;
      h.exact = squeeze(patch.text);
      const m = this.db.raw('messages').get(`${h.sourceId}|${h.messageKey}`);
      // Keep the clip in step with the code, unless it was rewritten in the reader.
      if (m && /^<pre><code[^>]*>[^<]*<\/code><\/pre>$/.test(m.html || '')) {
        m.html = codeHtml(patch.text, h.code && h.code.language);
        m.text = patch.text;
        m.updatedAt = Date.now();
      }
    }
    this._codeCache = null;
    this.db.touched();
    if (!quiet) this.changed('updateHighlight', { sourceId: h.sourceId });
  }

  touch() { this.db.touched(); this.changed('updateHighlight', {}); }

  async deleteItem(id) { await this.call('deleteHighlight', { id }); }

  // ---------- version 1.0 data ----------
  async migrateV1(dir) {
    const old = path.join(dir, 'thirdnote.json');
    if (!fs.existsSync(old) || this.context.globalState.get('tn.migrated')) return;
    try {
      const v1 = JSON.parse(fs.readFileSync(old, 'utf8'));
      const topicFor = {};
      const topicId = async (cid) => {
        const name = cid && cid !== 'inbox' ? ((v1.collections || []).find((c) => c.id === cid) || {}).name || 'Inbox' : 'Inbox';
        if (!topicFor[name]) topicFor[name] = (await this.call('saveTopic', { subject: 'VS Code', name })).id;
        return topicFor[name];
      };
      for (const it of v1.items || []) {
        const tid = await topicId(it.collectionId);
        if ((it.kind === 'highlight' || it.kind === 'snippet' || it.kind === 'file') && it.source && it.source.uri) {
          const fake = { uri: vscode.Uri.parse(it.source.uri), languageId: it.language || '' };
          const sourceId = await this.fileSource(fake, tid);
          const hl = await this.call('addClip', { sourceId, html: codeHtml(it.text, it.language), text: it.text, color: it.color, note: [it.title, it.note].filter(Boolean).join(' · ') });
          if (it.kind === 'highlight') { this.db.raw('highlights').get(hl.id).code = { ...it.source, language: it.language || '' }; }
        } else {
          const text = [it.title, it.kind === 'note' ? it.note : it.text, it.kind === 'note' ? '' : it.note].filter(Boolean).join('\n\n');
          if (text.trim()) await this.call('addNote', { topicId: tid, html: it.kind === 'clip' ? codeHtml(it.text) + (it.note ? textHtml(it.note) : '') : textHtml(text), text });
        }
      }
      this.db.touched();
      this.context.globalState.update('tn.migrated', true);
      fs.renameSync(old, path.join(dir, 'thirdnote-v1-backup.json'));
    } catch (err) {
      vscode.window.showWarningMessage(`ThirdNote could not bring over some older notes: ${err.message}`);
    }
  }
}

module.exports = { Core, codeHtml, textHtml, escapeHtml };
