// Every read and write of ThirdNote data goes through these methods. The
// background worker exposes them to content scripts and pages over messaging.

import { tx, reqP } from './db.js';

const uid = () => crypto.randomUUID();
const now = () => Date.now();
const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
const squeeze = (s) => (s || '').replace(/[\s​‌‍﻿]+/g, '');

function getAll(t, store, index, key) {
  const s = t.objectStore(store);
  return reqP(index ? s.index(index).getAll(key) : s.getAll());
}

async function deleteSourceIn(t, sourceId) {
  const msgs = t.objectStore('messages');
  const hls = t.objectStore('highlights');
  for (const key of await reqP(msgs.index('sourceId').getAllKeys(sourceId))) msgs.delete(key);
  for (const key of await reqP(hls.index('sourceId').getAllKeys(sourceId))) hls.delete(key);
  t.objectStore('sources').delete(sourceId);
}

async function withCounts(t, source) {
  if (!source) return null;
  const [messageCount, highlightCount] = await Promise.all([
    reqP(t.objectStore('messages').index('sourceId').count(source.id)),
    reqP(t.objectStore('highlights').index('sourceId').count(source.id)),
  ]);
  return { ...source, messageCount, highlightCount };
}

async function sourceFull(t, id) {
  const source = await reqP(t.objectStore('sources').get(id));
  if (!source) return null;
  const messages = (await getAll(t, 'messages', 'sourceId', id)).sort((a, b) => a.order - b.order);
  const highlights = (await getAll(t, 'highlights', 'sourceId', id)).sort((a, b) => a.createdAt - b.createdAt);
  return { source, messages, highlights };
}

function touch(t, sourceId) {
  const s = t.objectStore('sources');
  return reqP(s.get(sourceId)).then((src) => {
    if (src) s.put({ ...src, updatedAt: now() });
  });
}

export const MUTATING = new Set([
  'saveTopic', 'updateTopic', 'deleteTopic',
  'trackSource', 'setTracked', 'updateSource', 'deleteSource', 'restoreDeleted',
  'syncMessages', 'addClip', 'addNote', 'updateMessage', 'setMessageExcluded', 'deleteMessage',
  'addHighlight', 'updateHighlight', 'deleteHighlight',
  'importAll',
]);

export const api = {
  // ---- topics -------------------------------------------------------------

  async listTopics() {
    const topics = await tx(['topics'], 'readonly', (t) => getAll(t, 'topics'));
    return topics.sort((a, b) => a.subject.localeCompare(b.subject) || a.name.localeCompare(b.name));
  },

  async saveTopic({ subject, name }) {
    subject = norm(subject) || 'General';
    name = norm(name) || 'Untitled';
    return tx(['topics'], 'readwrite', async (t) => {
      const existing = (await getAll(t, 'topics')).find(
        (x) => x.subject.toLowerCase() === subject.toLowerCase() && x.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return existing;
      const topic = { id: uid(), subject, name, createdAt: now() };
      t.objectStore('topics').put(topic);
      return topic;
    });
  },

  async updateTopic({ id, subject, name }) {
    return tx(['topics'], 'readwrite', async (t) => {
      const s = t.objectStore('topics');
      const topic = await reqP(s.get(id));
      if (!topic) throw new Error('Topic not found');
      const next = { ...topic, subject: norm(subject) || topic.subject, name: norm(name) || topic.name };
      s.put(next);
      return next;
    });
  },

  async deleteTopic({ id }) {
    return tx(['topics', 'sources', 'messages', 'highlights'], 'readwrite', async (t) => {
      for (const src of await getAll(t, 'sources', 'topicId', id)) await deleteSourceIn(t, src.id);
      t.objectStore('topics').delete(id);
      return true;
    });
  },

  // ---- sources (a tracked chat, an imported share link, or a web page) -----

  async getSource({ id }) {
    return tx(['sources', 'messages', 'highlights'], 'readonly', async (t) =>
      withCounts(t, await reqP(t.objectStore('sources').get(id))));
  },

  async trackSource({ id, kind, site, url, title, topicId, tracked, pageKey }) {
    return tx(['sources', 'messages', 'highlights'], 'readwrite', async (t) => {
      const s = t.objectStore('sources');
      const existing = await reqP(s.get(id));
      const next = existing
        ? {
            ...existing,
            url: url || existing.url,
            topicId: topicId || existing.topicId,
            tracked: tracked ?? existing.tracked,
            title: existing.titleEdited ? existing.title : title || existing.title,
            updatedAt: now(),
          }
        : { id, kind, site, url, pageKey, title: title || 'Untitled', topicId, tracked: !!tracked, createdAt: now(), updatedAt: now() };
      s.put(next);
      return withCounts(t, next);
    });
  },

  async setTracked({ id, tracked }) {
    return tx(['sources'], 'readwrite', async (t) => {
      const s = t.objectStore('sources');
      const src = await reqP(s.get(id));
      if (!src) throw new Error('Source not found');
      s.put({ ...src, tracked: !!tracked });
      return true;
    });
  },

  async updateSource({ id, title, topicId }) {
    return tx(['sources'], 'readwrite', async (t) => {
      const s = t.objectStore('sources');
      const src = await reqP(s.get(id));
      if (!src) throw new Error('Source not found');
      const next = { ...src };
      if (title !== undefined && norm(title)) Object.assign(next, { title: norm(title), titleEdited: true });
      if (topicId) next.topicId = topicId;
      s.put(next);
      return next;
    });
  },

  // Forget which chat messages were deleted, so the next sync brings them back.
  async restoreDeleted({ id }) {
    return tx(['sources'], 'readwrite', async (t) => {
      const s = t.objectStore('sources');
      const src = await reqP(s.get(id));
      if (!src) throw new Error('Source not found');
      const n = (src.deletedKeys || []).length;
      s.put({ ...src, deletedKeys: [] });
      return n;
    });
  },

  async deleteSource({ id }) {
    return tx(['sources', 'messages', 'highlights'], 'readwrite', async (t) => {
      await deleteSourceIn(t, id);
      return true;
    });
  },

  // ---- messages -------------------------------------------------------------

  // Upserts captured chat messages by their stable key. Never un-hides a
  // message the user excluded, and never brings back one they deleted.
  async syncMessages({ sourceId, title, url, messages }) {
    return tx(['sources', 'messages'], 'readwrite', async (t) => {
      const ss = t.objectStore('sources');
      const src = await reqP(ss.get(sourceId));
      if (!src) throw new Error('This chat is not tracked');
      const ms = t.objectStore('messages');
      let added = 0;
      let updated = 0;
      const deleted = new Set(src.deletedKeys || []);
      for (const m of messages || []) {
        if (deleted.has(m.key)) continue;
        const id = `${sourceId}|${m.key}`;
        const ex = await reqP(ms.get(id));
        if (!ex) {
          ms.put({ id, sourceId, key: m.key, role: m.role, html: m.html, text: m.text, order: m.order, excluded: false, savedAt: now(), updatedAt: now() });
          added++;
        } else if (ex.edited) {
          if (ex.order !== m.order) ms.put({ ...ex, order: m.order });
        } else if (ex.html !== m.html || ex.order !== m.order) {
          ms.put({ ...ex, role: m.role, html: m.html, text: m.text, order: m.order, updatedAt: now() });
          updated++;
        }
      }
      const next = { ...src };
      if (title && !src.titleEdited) next.title = title;
      if (url) next.url = url;
      if (added || updated) next.updatedAt = now();
      ss.put(next);
      const total = await reqP(ms.index('sourceId').count(sourceId));
      return { added, updated, total };
    });
  },

  // Page sources are per collection, so the same page can feed several.
  async getPageSources({ pageKey }) {
    return tx(['sources'], 'readonly', async (t) =>
      (await getAll(t, 'sources')).filter((s) => s.kind === 'page' && s.pageKey === pageKey));
  },

  // A selection or screenshot saved from a web page: stored as its own
  // message, fully covered by one highlight. `image` is a data: URL.
  async addClip({ sourceId, html, text, color, note, pageQuote, image }) {
    return tx(['sources', 'messages', 'highlights'], 'readwrite', async (t) => {
      if (!(await reqP(t.objectStore('sources').get(sourceId)))) throw new Error('Page source not found');
      const key = `clip-${uid()}`;
      t.objectStore('messages').put({
        id: `${sourceId}|${key}`, sourceId, key, role: 'clip', html, text, order: now(), excluded: false, savedAt: now(), updatedAt: now(),
      });
      const highlight = {
        id: uid(), sourceId, messageKey: key, exact: squeeze(text), prefix: '', suffix: '', text,
        color: color || 'yellow', note: norm(note), pageQuote: pageQuote || null, image: image || null, createdAt: now(),
      };
      t.objectStore('highlights').put(highlight);
      await touch(t, sourceId);
      return highlight;
    });
  },

  // A note typed by hand into a collection. Each collection has one "Notes"
  // source that collects them.
  async addNote({ topicId, html, text }) {
    if (!norm(text)) throw new Error('The note is empty');
    return tx(['topics', 'sources', 'messages'], 'readwrite', async (t) => {
      if (!(await reqP(t.objectStore('topics').get(topicId)))) throw new Error('Collection not found');
      const sourceId = `note:${topicId}`;
      const ss = t.objectStore('sources');
      const src = await reqP(ss.get(sourceId));
      ss.put(src
        ? { ...src, updatedAt: now() }
        : { id: sourceId, kind: 'note', site: 'notes', title: 'My notes', topicId, tracked: false, createdAt: now(), updatedAt: now() });
      const key = `note-${uid()}`;
      const msg = { id: `${sourceId}|${key}`, sourceId, key, role: 'note', html, text, order: now(), excluded: false, savedAt: now(), updatedAt: now() };
      t.objectStore('messages').put(msg);
      return msg;
    });
  },

  async setMessageExcluded({ id, excluded }) {
    return tx(['messages'], 'readwrite', async (t) => {
      const s = t.objectStore('messages');
      const m = await reqP(s.get(id));
      if (!m) throw new Error('Message not found');
      s.put({ ...m, excluded: !!excluded });
      return true;
    });
  },

  // Rewrite a message (a note, or a chat message the user trimmed). Edited
  // chat messages are never overwritten by a later sync. Highlights are
  // re-anchored on display.
  async updateMessage({ id, html, text }) {
    if (!norm(text)) throw new Error('The note is empty');
    return tx(['messages'], 'readwrite', async (t) => {
      const s = t.objectStore('messages');
      const m = await reqP(s.get(id));
      if (!m) throw new Error('Message not found');
      const next = { ...m, html, text, edited: true, updatedAt: now() };
      s.put(next);
      return next;
    });
  },

  async deleteMessage({ id }) {
    return tx(['sources', 'messages', 'highlights'], 'readwrite', async (t) => {
      const m = await reqP(t.objectStore('messages').get(id));
      if (!m) return false;
      // Remember deleted chat messages so the next sync doesn't re-add them.
      const ss = t.objectStore('sources');
      const src = await reqP(ss.get(m.sourceId));
      if (src && src.kind === 'chat') ss.put({ ...src, deletedKeys: [...new Set([...(src.deletedKeys || []), m.key])] });
      const hs = t.objectStore('highlights');
      for (const h of await getAll(t, 'highlights', 'sourceId', m.sourceId)) {
        if (h.messageKey === m.key) hs.delete(h.id);
      }
      t.objectStore('messages').delete(id);
      return true;
    });
  },

  // ---- highlights -----------------------------------------------------------

  async addHighlight({ sourceId, messageKey, exact, prefix, suffix, text, color, note }) {
    if (!exact) throw new Error('Empty highlight');
    return tx(['sources', 'highlights'], 'readwrite', async (t) => {
      const highlight = {
        id: uid(), sourceId, messageKey, exact, prefix: prefix || '', suffix: suffix || '', text: (text || '').trim(),
        color: color || 'yellow', note: norm(note), createdAt: now(),
      };
      t.objectStore('highlights').put(highlight);
      await touch(t, sourceId);
      return highlight;
    });
  },

  async updateHighlight({ id, color, note }) {
    return tx(['highlights'], 'readwrite', async (t) => {
      const s = t.objectStore('highlights');
      const h = await reqP(s.get(id));
      if (!h) throw new Error('Highlight not found');
      const next = { ...h };
      if (color) next.color = color;
      if (note !== undefined) next.note = norm(note);
      s.put(next);
      return next;
    });
  },

  async deleteHighlight({ id }) {
    return tx(['highlights'], 'readwrite', (t) => {
      t.objectStore('highlights').delete(id);
      return true;
    });
  },

  async listHighlights({ sourceId }) {
    return tx(['highlights'], 'readonly', (t) => getAll(t, 'highlights', 'sourceId', sourceId));
  },

  // ---- views ----------------------------------------------------------------

  async getSourceFull({ id }) {
    return tx(['topics', 'sources', 'messages', 'highlights'], 'readonly', async (t) => {
      const full = await sourceFull(t, id);
      if (!full) return null;
      const topic = await reqP(t.objectStore('topics').get(full.source.topicId));
      return { ...full, topic: topic || null };
    });
  },

  async getTopicFull({ id }) {
    return tx(['topics', 'sources', 'messages', 'highlights'], 'readonly', async (t) => {
      const topic = await reqP(t.objectStore('topics').get(id));
      if (!topic) return null;
      const sources = (await getAll(t, 'sources', 'topicId', id)).sort((a, b) => a.createdAt - b.createdAt);
      const sections = [];
      for (const src of sources) sections.push(await sourceFull(t, src.id));
      return { topic, sections };
    });
  },

  async getLibrary() {
    return tx(['topics', 'sources', 'messages', 'highlights'], 'readonly', async (t) => {
      const topics = await getAll(t, 'topics');
      const sources = [];
      for (const src of await getAll(t, 'sources')) sources.push(await withCounts(t, src));
      return { topics, sources };
    });
  },

  async getAllHighlights() {
    return tx(['highlights'], 'readonly', async (t) =>
      (await getAll(t, 'highlights')).sort((a, b) => b.createdAt - a.createdAt));
  },

  // ---- backup ---------------------------------------------------------------

  async exportAll() {
    return tx(['topics', 'sources', 'messages', 'highlights'], 'readonly', async (t) => ({
      app: 'ThirdNote',
      version: 1,
      exportedAt: new Date().toISOString(),
      topics: await getAll(t, 'topics'),
      sources: await getAll(t, 'sources'),
      messages: await getAll(t, 'messages'),
      highlights: await getAll(t, 'highlights'),
    }));
  },

  async importAll({ data }) {
    if (!data || !['ThirdNote', 'NoteMate'].includes(data.app)) throw new Error('This is not an ThirdNote backup file');
    const stores = ['topics', 'sources', 'messages', 'highlights'];
    return tx(stores, 'readwrite', (t) => {
      const counts = {};
      for (const store of stores) {
        const rows = Array.isArray(data[store]) ? data[store] : [];
        rows.forEach((row) => row && row.id && t.objectStore(store).put(row));
        counts[store] = rows.length;
      }
      return counts;
    });
  },
};
