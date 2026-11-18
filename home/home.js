// The library in a full tab: collections down the side, and in the middle
// whatever is picked there (home, recent, highlights, or one collection).
// Routes live in the URL hash so the back button and reloads work.

const { rpc, COLORS, icon, t } = NM;

const $ = (sel) => document.querySelector(sel);
const side = $('#side');
const main = $('#main');

let data = { topics: [], sources: [], highlights: [] };
let settings = NM.DEFAULT_SETTINGS;
const view = { query: '', kind: 'all', color: null, closed: new Set() };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

// Puts a view on the page; parts that don't apply are passed as null.
const fill = (...nodes) => main.replaceChildren(...nodes.filter(Boolean));

const ic = (name, size = 16) => h('span', { class: 'icw', html: icon(name, size) }).firstChild;

// ---------------------------------------------------------------------------
// Small pieces shared by every view

const TILE_COLORS = ['#3f6fdb', '#2f9e6e', '#c2613f', '#8b5cf6', '#b8860b', '#0e8a9a', '#c2416b', '#5b6b8c'];
function tileColor(name) {
  let n = 0;
  for (const ch of name || '') n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLORS[n % TILE_COLORS.length];
}
function tile(topic, size) {
  return h('span', { class: 'tile', style: `--tile:${tileColor(topic.name)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px` },
    (topic.name || '?').trim().charAt(0).toUpperCase());
}

function badge(src) {
  const site = NM.SITES[src.site];
  if (src.kind === 'note') return h('span', { class: 'badge', style: '--b:#8a6d3b' }, ic('notepad', 13));
  if (src.kind === 'page' || !site) return h('span', { class: 'badge', style: '--b:#8a857c' }, ic(src.pageKey?.includes('youtube.com') ? 'play' : 'globe', 13));
  return h('span', { class: 'badge', style: `--b:${site.color}` }, site.short);
}

const sourceTitle = (src) => (src.kind === 'note' ? t('sp.myNotes') : src.title || '');
const kindOf = (src) => (src.kind === 'note' ? 'note' : src.kind === 'page' ? 'page' : 'chat');
const topicOf = (id) => data.topics.find((x) => x.id === id) || null;
const sourceOf = (id) => data.sources.find((x) => x.id === id) || null;
const sourcesIn = (topicId) => data.sources.filter((s) => s.topicId === topicId).sort((a, b) => b.updatedAt - a.updatedAt);
const hlCount = (srcs) => srcs.reduce((n, s) => n + (s.highlightCount || 0), 0);

function itemCount(src) {
  if (src.kind === 'page') return NM.count(src.messageCount, 'sp.clips', 'sp.clip1');
  if (src.kind === 'note') return NM.count(src.messageCount, 'sp.notes', 'sp.note1');
  return NM.count(src.messageCount, 'sp.msgs', 'sp.msg1');
}

function readerUrl(params) {
  return `../reader/reader.html?${new URLSearchParams(params)}`;
}
function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function toast(text) {
  const el = $('#toast');
  el.innerHTML = icon('check', 14);
  el.append(text);
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2400);
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, id] = hash.split('/');
  if (name === 'c' && id && topicOf(decodeURIComponent(id))) return { name: 'collection', id: decodeURIComponent(id) };
  if (name === 'recent' || name === 'highlights') return { name };
  return { name: 'home' };
}

// ---------------------------------------------------------------------------
// Data

async function load() {
  settings = await NM.getSettings();
  NM.applyPage(settings);
  const [lib, highlights] = await Promise.all([rpc('getLibrary'), rpc('getAllHighlights')]);
  data = { ...lib, highlights };
  render();
}

let loadTimer = null;
function scheduleLoad() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => load().catch(showError), 250);
}

function showError(err) {
  fill(h('div', { class: 'empty' }, h('h3', {}, 'Something went wrong'), h('p', {}, String(err.message || err))));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'nm-changed') scheduleLoad();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) scheduleLoad();
});
addEventListener('hashchange', () => {
  view.kind = 'all';
  render();
  main.scrollTop = 0;
  scrollTo(0, 0);
});

// ---------------------------------------------------------------------------
// Sidebar

function render() {
  renderSide();
  renderMain();
}

function renderSide() {
  const r = route();
  const navItem = (hash, iconName, label, count, on) => h('a', { class: `nav${on ? ' on' : ''}`, href: hash },
    ic(iconName, 16), h('span', { class: 'grow' }, label), count != null ? h('span', { class: 'n' }, String(count)) : null);

  const search = h('input', { type: 'search', placeholder: t('sp.search'), value: view.query });
  search.addEventListener('input', () => {
    view.query = search.value.trim().toLowerCase();
    renderMain();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = '';
      view.query = '';
      renderMain();
    }
  });

  const groups = new Map();
  for (const topic of [...data.topics].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!groups.has(topic.subject)) groups.set(topic.subject, []);
    groups.get(topic.subject).push(topic);
  }
  const colls = [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((subject) => {
    const closed = view.closed.has(subject);
    return h('div', { class: `sgroup${closed ? ' closed' : ''}` },
      h('button', {
        class: 'sgroup-head',
        onclick: () => {
          if (closed) view.closed.delete(subject);
          else view.closed.add(subject);
          renderSide();
        },
      }, ic('chevronDown', 12), h('span', {}, subject)),
      closed ? null : h('div', { class: 'sgroup-body' },
        ...groups.get(subject).map((topic) => h('a', {
          class: `nav coll${r.name === 'collection' && r.id === topic.id ? ' on' : ''}`,
          href: `#/c/${encodeURIComponent(topic.id)}`,
          title: topic.name,
        }, tile(topic, 18), h('span', { class: 'grow name' }, topic.name), h('span', { class: 'n' }, String(sourcesIn(topic.id).length))))));
  });

  side.replaceChildren(
    h('div', { class: 'side-top' },
      h('a', { class: 'brand', href: '#/' }, h('img', { src: '../icons/icon32.png', width: 22, height: 22, alt: '' }), h('span', {}, 'ThirdNote')),
      h('label', { class: 'search' }, ic('search', 15), search)),
    h('nav', { class: 'side-nav' },
      navItem('#/', 'home', t('home.overview'), null, r.name === 'home'),
      navItem('#/recent', 'clock', t('home.recent'), data.sources.length, r.name === 'recent'),
      navItem('#/highlights', 'highlighter', t('sp.highlights'), data.highlights.length, r.name === 'highlights')),
    h('div', { class: 'side-label' },
      h('span', { class: 'grow' }, t('home.collections')),
      h('button', { class: 'icon-btn small', title: t('sp.newCollection'), onclick: newCollection }, ic('plus', 15))),
    h('div', { class: 'side-colls' }, ...colls),
    h('div', { class: 'side-foot' },
      h('button', { class: 'icon-btn', title: t('sp.theme'), onclick: cycleTheme, html: THEME_ICONS[settings.theme] || THEME_ICONS.system }),
      h('a', { class: 'icon-btn', href: '../options/options.html', title: t('common.settings') }, ic('sliders', 17))),
  );
  side.querySelector('.side-nav .on, .side-colls .on')?.scrollIntoView({ block: 'nearest' });
}

const THEME_ICONS = {
  system: icon('monitor', 17),
  light: '<svg class="ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  dark: '<svg class="ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
};

async function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(settings.theme || 'light') + 1) % order.length];
  settings = await NM.saveSettings({ theme: next });
  NM.applyPage(settings);
  renderSide();
}

async function newCollection() {
  const name = prompt(t('home.newPrompt'));
  if (!name || !name.trim()) return;
  const subject = prompt(t('home.groupPrompt'), '') || 'General';
  const topic = await rpc('saveTopic', { subject, name });
  await load();
  go(`#/c/${encodeURIComponent(topic.id)}`);
}

// ---------------------------------------------------------------------------
// Main area

function renderMain() {
  if (view.query) return renderSearch();
  const r = route();
  if (r.name === 'collection') return renderCollection(topicOf(r.id));
  if (r.name === 'recent') return renderRecent();
  if (r.name === 'highlights') return renderHighlights();
  return renderHome();
}

function pageHead(title, sub, actions) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'grow' }, h('h1', {}, title), sub ? h('p', { class: 'sub' }, sub) : null),
    actions ? h('div', { class: 'head-acts' }, ...actions) : null);
}

function section(title, link, ...body) {
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', {}, title), link || null),
    ...body);
}

function statsLine() {
  return [
    NM.count(data.topics.length, 'home.colls', 'home.coll1'),
    t('home.items', { n: data.sources.length }),
    NM.count(data.highlights.length, 'sp.hls', 'sp.hl1'),
  ].join('  ·  ');
}

function renderHome() {
  document.title = 'ThirdNote';
  if (!data.topics.length) return fill(pageHead(t('home.title')), emptyState());
  const recent = [...data.sources].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const subjects = [...new Set(data.topics.map((x) => x.subject))].sort((a, b) => a.localeCompare(b));
  fill(
    pageHead(t('home.title'), statsLine()),
    recent.length ? section(t('home.continue'), h('a', { class: 'link', href: '#/recent' }, t('home.seeAll')), rows(recent, true)) : null,
    section(t('home.collections'), null,
      ...subjects.map((subject) => h('div', { class: 'subject' },
        subjects.length > 1 ? h('h3', {}, subject) : null,
        h('div', { class: 'cards' }, ...data.topics.filter((x) => x.subject === subject)
          .sort((a, b) => a.name.localeCompare(b.name)).map(card))))),
  );
}

function card(topic) {
  const srcs = sourcesIn(topic.id);
  const hls = hlCount(srcs);
  const open = () => go(`#/c/${encodeURIComponent(topic.id)}`);
  return h('article', { class: 'card', tabindex: '0', onclick: open, onkeydown: (e) => e.key === 'Enter' && open() },
    h('div', { class: 'card-top' },
      tile(topic, 34),
      h('div', { class: 'grow' },
        h('div', { class: 'card-name' }, topic.name),
        h('div', { class: 'card-meta' }, `${NM.count(srcs.length, 'sp.sources', 'sp.source1')} · ${NM.count(hls, 'sp.hls', 'sp.hl1')}`))),
    srcs.length
      ? h('ul', { class: 'card-list' }, ...srcs.slice(0, 3).map((s) => h('li', {}, badge(s), h('span', {}, sourceTitle(s)))))
      : h('p', { class: 'card-empty' }, t('home.nothingHere')),
    h('div', { class: 'card-foot' },
      h('span', { class: 'faint' }, srcs[0] ? NM.timeAgo(srcs[0].updatedAt) : ''),
      h('span', { class: 'grow' }),
      h('a', { class: 'mini', href: readerUrl({ topic: topic.id, mode: 'board' }), onclick: (e) => e.stopPropagation(), title: t('sp.board') }, ic('board', 14)),
      hls ? h('a', { class: 'mini', href: readerUrl({ topic: topic.id, mode: 'review' }), onclick: (e) => e.stopPropagation(), title: t('sp.review') }, ic('cap', 14)) : null));
}

// A table-like list of saved chats, pages and notes.
function rows(srcs, showCollection) {
  if (!srcs.length) return h('p', { class: 'muted pad' }, t('sp.noMatches'));
  return h('div', { class: 'rows' }, ...srcs.map((s) => {
    const topic = topicOf(s.topicId);
    return h('a', { class: 'row', href: readerUrl({ source: s.id }) },
      badge(s),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, sourceTitle(s)),
        h('div', { class: 'row-meta' }, [s.kind === 'note' ? null : NM.siteName(s), itemCount(s)].filter(Boolean).join(' · '))),
      showCollection && topic ? h('span', { class: 'chip-coll' }, tile(topic, 14), topic.name) : null,
      s.highlightCount ? h('span', { class: 'row-hl', title: NM.count(s.highlightCount, 'sp.hls', 'sp.hl1') }, ic('highlighter', 13), String(s.highlightCount)) : h('span', { class: 'row-hl' }),
      h('span', { class: 'row-time' }, NM.timeAgo(s.updatedAt)),
      h('button', {
        class: 'icon-btn small danger row-del',
        title: t('common.delete'),
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          deleteSource(s);
        },
      }, ic('trash', 14)));
  }));
}

function kindFilter(srcs) {
  const kinds = [...new Set(srcs.map(kindOf))];
  if (kinds.length < 2) return null;
  const opts = [['all', 'common.all'], ['chat', 'home.chats'], ['page', 'home.pages'], ['note', 'home.notes']]
    .filter(([k]) => k === 'all' || kinds.includes(k));
  return h('div', { class: 'seg' }, ...opts.map(([k, label]) => h('button', {
    class: view.kind === k ? 'on' : '',
    onclick: () => {
      view.kind = k;
      renderMain();
    },
  }, t(label))));
}

const byKind = (srcs) => (view.kind === 'all' ? srcs : srcs.filter((s) => kindOf(s) === view.kind));

function renderRecent() {
  document.title = `${t('home.recent')} · ThirdNote`;
  const all = [...data.sources].sort((a, b) => b.updatedAt - a.updatedAt);
  fill(
    pageHead(t('home.recent'), t('home.items', { n: all.length })),
    h('div', { class: 'toolbar' }, kindFilter(all)),
    all.length ? rows(byKind(all), true) : emptyState(),
  );
}

function renderCollection(topic) {
  document.title = `${topic.name} · ThirdNote`;
  const srcs = sourcesIn(topic.id);
  const hls = hlCount(srcs);
  const ids = new Set(srcs.map((s) => s.id));
  const latest = data.highlights.filter((x) => ids.has(x.sourceId));
  fill(
    h('header', { class: 'page-head' },
      tile(topic, 48),
      h('div', { class: 'grow' },
        h('div', { class: 'eyebrow' }, topic.subject),
        h('h1', {}, topic.name),
        h('p', { class: 'sub' }, `${NM.count(srcs.length, 'sp.sources', 'sp.source1')}  ·  ${NM.count(hls, 'sp.hls', 'sp.hl1')}`)),
      h('div', { class: 'head-acts' },
        h('a', { class: 'btn primary', href: readerUrl({ topic: topic.id }) }, ic('book', 15), t('home.readAll')),
        h('a', { class: 'btn', href: readerUrl({ topic: topic.id, mode: 'board' }) }, ic('board', 15), t('sp.board')),
        hls ? h('a', { class: 'btn', href: readerUrl({ topic: topic.id, mode: 'review' }) }, ic('cap', 15), t('sp.review')) : null,
        h('button', { class: 'icon-btn', title: t('common.rename'), onclick: () => renameTopic(topic) }, ic('pencil', 16)),
        h('button', { class: 'icon-btn danger', title: t('common.delete'), onclick: () => deleteTopic(topic) }, ic('trash', 16)))),
    srcs.length
      ? section(t('home.saved'), kindFilter(srcs), rows(byKind(srcs), false))
      : h('p', { class: 'muted pad' }, t('home.nothingHere')),
    latest.length
      ? section(t('home.latestHls'), latest.length > 8 ? h('span', { class: 'faint' }, t('home.moreHls', { n: latest.length - 8 })) : null,
        hlGrid(latest.slice(0, 8)))
      : null,
  );
}

function renderHighlights() {
  document.title = `${t('sp.highlights')} · ThirdNote`;
  const list = data.highlights.filter((x) => !view.color || x.color === view.color);
  const chips = h('div', { class: 'chips' },
    h('button', { class: `chip${view.color ? '' : ' on'}`, onclick: () => { view.color = null; renderMain(); } }, t('common.all')),
    ...COLORS.map((c) => h('button', {
      class: `chip${view.color === c.id ? ' on' : ''}`,
      onclick: () => { view.color = c.id; renderMain(); },
    }, h('span', { class: `swatch sw-${c.id}` }), NM.label(c.id), h('span', { class: 'faint' }, String(data.highlights.filter((x) => x.color === c.id).length)))));
  fill(
    pageHead(t('sp.highlights'), NM.count(data.highlights.length, 'sp.hls', 'sp.hl1')),
    h('div', { class: 'toolbar' }, chips),
    list.length ? hlGrid(list.slice(0, 400)) : h('p', { class: 'muted pad' }, data.highlights.length ? t('sp.noMatches') : t('sp.noHighlights')),
  );
}

function hlGrid(list) {
  return h('div', { class: 'hl-grid' }, ...list.map((hl) => {
    const src = sourceOf(hl.sourceId);
    const topic = src && topicOf(src.topicId);
    return h('a', { class: `hl bar-${hl.color}`, href: readerUrl({ source: hl.sourceId, hl: hl.id }) },
      hl.image ? h('img', { src: hl.image, alt: '' }) : h('div', { class: 'hl-text' }, hl.text || ''),
      hl.note ? h('div', { class: 'hl-note' }, ic('pencil', 12), h('span', {}, hl.note)) : null,
      h('div', { class: 'hl-meta' },
        h('span', { class: `swatch sw-${hl.color}` }),
        h('span', { class: 'ellipsis' }, [topic?.name, src ? sourceTitle(src) : t('sp.deleted')].filter(Boolean).join(' · '))));
  }));
}

function renderSearch() {
  const q = view.query;
  // Every word must appear somewhere, in any order.
  const words = q.split(/\s+/).filter(Boolean);
  const has = (...fields) => {
    const hay = fields.join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const topics = data.topics.filter((x) => has(x.name, x.subject));
  const srcs = data.sources.filter((s) => has(sourceTitle(s), s.url || '', topicOf(s.topicId)?.name || '')).sort((a, b) => b.updatedAt - a.updatedAt);
  const hls = data.highlights.filter((x) => has(x.text || '', x.note || ''));
  fill(
    pageHead(t('home.results', { q })),
    !topics.length && !srcs.length && !hls.length ? h('p', { class: 'muted pad' }, t('sp.noMatches')) : null,
    topics.length ? section(t('home.collections'), null, h('div', { class: 'cards' }, ...topics.map(card))) : null,
    srcs.length ? section(t('home.saved'), null, rows(srcs.slice(0, 50), true)) : null,
    hls.length ? section(t('sp.highlights'), null, hlGrid(hls.slice(0, 60))) : null,
  );
}

function emptyState() {
  return h('div', { class: 'empty' },
    h('h3', {}, t('sp.emptyTitle')),
    h('ol', { class: 'steps' },
      h('li', {}, t('sp.step1')),
      h('li', {}, t('sp.step2')),
      h('li', {}, t('sp.step3'))));
}

// ---------------------------------------------------------------------------
// Changes

async function renameTopic(topic) {
  const name = prompt(t('sp.renamePrompt'), topic.name);
  if (!name || !name.trim() || name.trim() === topic.name) return;
  await rpc('updateTopic', { id: topic.id, name });
  toast(t('toast.renamed'));
  load();
}

async function deleteTopic(topic) {
  if (!confirm(t('sp.confirmTopic', { title: topic.name }))) return;
  await rpc('deleteTopic', { id: topic.id });
  const active = await NM.getActive();
  if (active.topicId === topic.id) await NM.setActive({ topicId: null, on: false });
  toast(t('toast.deleted'));
  await load();
  go('#/');
}

async function deleteSource(src) {
  if (!confirm(t('sp.confirmSource', { title: sourceTitle(src) }))) return;
  await rpc('deleteSource', { id: src.id });
  toast(t('toast.deleted'));
  load();
}

// "/" jumps to search, as in most libraries.
addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input, textarea, [contenteditable]')) {
    e.preventDefault();
    side.querySelector('input[type="search"]')?.focus();
  }
});

load().catch(showError);
