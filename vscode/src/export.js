// Markdown export: one heading per collection, each item with its source, code and note.
const { INBOX, COLOR_LABELS } = require('./store');

const KIND = { highlight: 'Highlight', snippet: 'Snippet', file: 'File', note: 'Note', clip: 'Clip' };

function fence(text, lang) {
  const longest = Math.max(2, ...((text.match(/`+/g) || []).map((m) => m.length)));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang || ''}\n${text.replace(/\n$/, '')}\n${ticks}`;
}

function stamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function itemMd(it) {
  const out = [];
  const title = it.title || (it.kind === 'note' ? (it.note || '').split('\n')[0] : '') || KIND[it.kind];
  out.push(`### ${title.replace(/\n/g, ' ')}`);
  const meta = [`${KIND[it.kind]}`, COLOR_LABELS[it.color], stamp(it.createdAt)];
  if (it.source && it.source.path) meta.push(`\`${it.source.path}${it.source.start ? `:${it.source.start.line + 1}` : ''}\``);
  out.push(`_${meta.join(' · ')}_`);
  if (it.kind === 'note') {
    const body = it.title ? it.note : (it.note || '').split('\n').slice(1).join('\n').trim();
    if (body) out.push(body);
  } else {
    if (it.text) out.push(fence(it.text, it.language));
    if (it.note) out.push(it.note.split('\n').map((l) => `> ${l}`).join('\n'));
  }
  return out.join('\n\n');
}

function toMarkdown(store, items, scope) {
  const groups = new Map();
  for (const it of items) {
    const key = it.collectionId || INBOX;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const head = scope ? store.collectionName(scope) : 'ThirdNote';
  const lines = [`# ${head}`, '', `_Exported ${stamp(Date.now())} · ${items.length} item${items.length === 1 ? '' : 's'}_`, ''];
  const order = [INBOX, ...store.collections.map((c) => c.id)];
  for (const key of order) {
    const list = groups.get(key);
    if (!list || !list.length) continue;
    if (!scope) lines.push(`## ${store.collectionName(key)}`, '');
    for (const it of list) lines.push(itemMd(it), '');
  }
  return lines.join('\n');
}

module.exports = { toMarkdown };
