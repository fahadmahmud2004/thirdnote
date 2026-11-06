const { rpc, COLORS, icon, t } = NM;

const $ = (sel) => document.querySelector(sel);
const main = $('#main');
const view = { editing: null, tab: 'library', color: null, query: '', chooser: false, composer: false, shot: null, open: new Set(), allSources: new Set() };
let data = { topics: [], sources: [], highlights: [] };
let settings = NM.DEFAULT_SETTINGS;
let active = { topicId: null, on: false };

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

const ic = (name, size) => h('span', { class: 'icw', html: icon(name, size) }).firstChild;

const TILE_COLORS = ['#3f6fdb', '#2f9e6e', '#c2613f', '#8b5cf6', '#d4a017', '#0e8a9a', '#c2416b', '#5b6b8c'];
function tileColor(name) {
  let n = 0;
  for (const ch of name || '') n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLORS[n % TILE_COLORS.length];
}
function tile(topic, size = 30) {
  return h('span', { class: 'tile', style: `background:${tileColor(topic.name)};width:${size}px;height:${size}px` },
    (topic.name || '?').trim().charAt(0).toUpperCase());
}

function badge(src) {
  const site = NM.SITES[src.site];
  if (src.kind === 'note') return h('span', { class: 'badge', style: '--bg-badge:#8a6d3b' }, ic('notepad', 13));
  if (src.kind === 'page' || !site) return h('span', { class: 'badge', style: '--bg-badge:#8a857c' }, ic(src.pageKey?.includes('youtube.com') ? 'play' : 'globe', 13));
  return h('span', { class: `badge${src.tracked ? ' live' : ''}`, style: `--bg-badge:${site.color}` }, site.short);
}

function sourceTitle(src) {
  return src.kind === 'note' ? t('sp.myNotes') : src.title;
}

function sourceMeta(src) {
  const items = src.kind === 'page' ? NM.count(src.messageCount, 'sp.clips', 'sp.clip1')
    : src.kind === 'note' ? NM.count(src.messageCount, 'sp.notes', 'sp.note1')
      : NM.count(src.messageCount, 'sp.msgs', 'sp.msg1');
  const site = src.kind === 'note' ? '' : `${NM.siteName(src)} · `;
  return `${site}${items} · ${NM.timeAgo(src.updatedAt)}`;
}

function openReader(params) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`reader/reader.html?${new URLSearchParams(params)}`) });
}

function toast(text) {
  const el = $('#toast');
  el.innerHTML = icon('check', 14);
  el.append(text);
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2400);
}

// ---------------------------------------------------------------------------
// Data

async function load() {
  settings = await NM.getSettings();
  NM.applyPage(settings);
  active = await NM.getActive();
  const [lib, highlights] = await Promise.all([rpc('getLibrary'), rpc('getAllHighlights')]);
  data = { ...lib, highlights };
  if (active.topicId && !data.topics.some((x) => x.id === active.topicId)) active = { topicId: null, on: false };
  render();
}

let loadTimer = null;
function scheduleLoad() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => load().catch(showError), 250);
}

function showError(err) {
  main.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'Something went wrong'), h('p', {}, String(err.message || err))));
}

// ---------------------------------------------------------------------------
// Header

function renderHeader() {
  $('#theme').innerHTML = THEME_ICONS[settings.theme] || THEME_ICONS.system;
  $('#settings').innerHTML = icon('sliders', 17);
  if (!$('#search-wrap .ic')) $('#search-wrap').insertAdjacentHTML('afterbegin', icon('search', 15));
}

const THEME_ICONS = {
  system: icon('monitor', 17),
  light: '<svg class="ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  dark: '<svg class="ic" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
};

$('#theme').addEventListener('click', async () => {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(settings.theme || 'system') + 1) % order.length];
  settings = await NM.saveSettings({ theme: next });
});

// ---------------------------------------------------------------------------
// Collecting card

function activeTopic() {
  return data.topics.find((x) => x.id === active.topicId) || null;
}

function renderCollect() {
  const box = $('#collect');
  const topic = activeTopic();
  const on = active.on && !!topic;
  box.classList.toggle('on', on);

  const sw = h('button', {
    class: 'switch', role: 'switch', 'aria-checked': String(on), title: on ? t('sp.collectingInto') : t('sp.collectOff'),
    onclick: async () => {
      if (!topic) {
        view.chooser = true;
        return renderCollect();
      }
      await NM.setActive({ on: !on });
    },
  });

  const pick = h('button', { class: 'collect-pick', onclick: () => { view.chooser = !view.chooser; renderCollect(); } },
    h('div', { class: 'collect-label' }, on ? t('sp.collectingInto') : t('sp.collectOff')),
    h('div', { class: 'collect-name' }, h('span', {}, topic ? topic.name : t('sp.chooseCollection')), ic('chevronDown', 15)),
  );

  const children = [
    h('div', { class: 'collect-row' },
      topic ? tile(topic, 40) : h('span', { class: 'collect-tile' }, ic('folder', 19)),
      pick, sw),
  ];
  if (!on) children.push(h('p', { class: 'collect-hint' }, t('sp.collectHint')));
  children.push(h('div', { class: 'collect-actions' },
    h('button', { class: 'btn', onclick: captureArea }, ic('crop', 15), t('sp.captureArea')),
    h('button', { class: `btn${view.composer ? ' primary' : ''}`, onclick: () => { view.composer = !view.composer; view.shot = null; renderCollect(); } },
      ic('notepad', 15), t('sp.writeNote')),
  ));
  if (view.composer) children.push(renderComposer());
  if (view.shot) children.push(renderShot());
  if (view.chooser) children.push(renderChooser());
  box.replaceChildren(...children);
  box.querySelector('.composer-area')?.focus();
}

function renderComposer() {
  const area = h('div', { class: 'composer-area' });
  const editor = NMEditor.make(area, { placeholder: t('sp.notePlaceholder') });
  const close = () => {
    NMEditor.hideBar();
    view.composer = false;
    renderCollect();
  };
  const saveNote = async () => {
    if (editor.isEmpty()) return editor.focus();
    const topic = await ensureTopic();
    if (!topic) return;
    await rpc('addNote', { topicId: topic.id, html: editor.html(), text: editor.text() });
    toast(t('toast.noteSaved', { name: topic.name }));
    close();
  };
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote();
    if (e.key === 'Escape') close();
  });
  return h('div', { class: 'composer' }, area,
    h('div', { class: 'row' },
      h('span', { class: 'kbd-hint grow' }, '⌘/Ctrl + Enter'),
      h('button', { class: 'btn small', onclick: close }, t('common.cancel')),
      h('button', { class: 'btn small primary', onclick: saveNote }, ic('check', 14), t('sp.saveNote'))));
}

// Screenshot taken from the side panel itself (pages that block content
// scripts, like PDFs).
function renderShot() {
  const ta = h('textarea', { placeholder: t('shot.note'), rows: '2' });
  const saveShot = async () => {
    const topic = await ensureTopic();
    if (!topic) return;
    const { image, tab } = view.shot;
    const note = ta.value.trim();
    const url = new URL(tab.url);
    const pageKey = `${url.origin}${url.pathname}${url.search}`;
    const id = `page:${topic.id}:${pageKey}`;
    if (!(await rpc('getSource', { id }))) {
      await rpc('trackSource', { id, kind: 'page', site: url.hostname, url: tab.url, pageKey, title: tab.title || url.hostname, topicId: topic.id, tracked: false });
    }
    const html = `<figure><img src="${image}" alt="">${note ? `<figcaption>${NM.escapeHtml(note)}</figcaption>` : ''}</figure>`;
    await rpc('addClip', { sourceId: id, html, text: note || t('shot.from', { title: tab.title || url.hostname }), color: 'yellow', note, image });
    view.shot = null;
    toast(t('toast.shotSaved', { name: topic.name }));
    renderCollect();
  };
  return h('div', { class: 'shot-preview' },
    h('p', { class: 'collect-hint' }, t('sp.fullCaptured')),
    h('img', { src: view.shot.image, alt: '' }), ta,
    h('div', { class: 'composer' }, h('div', { class: 'row' }, h('span', { class: 'grow' }),
      h('button', { class: 'btn small', onclick: () => { view.shot = null; renderCollect(); } }, t('common.cancel')),
      h('button', { class: 'btn small primary', onclick: saveShot }, ic('check', 14), t('common.save')))));
}

function renderChooser() {
  const recent = [];
  const sorted = [...data.topics].sort((a, b) => a.subject.localeCompare(b.subject) || a.name.localeCompare(b.name));
  for (const topic of sorted) {
    recent.push(h('button', {
      class: `opt${topic.id === active.topicId ? ' on' : ''}`,
      onclick: async () => {
        view.chooser = false;
        await NM.setActive({ topicId: topic.id, on: true });
      },
    }, tile(topic), h('span', { class: 't' }, h('span', { class: 'n' }, topic.name), h('span', { class: 's' }, topic.subject)),
    topic.id === active.topicId ? h('span', { class: 'check', html: icon('check', 16) }) : null));
  }
  const name = h('input', { type: 'text', placeholder: t('picker.name') });
  const group = h('input', { type: 'text', placeholder: t('picker.group'), list: 'sp-groups' });
  const groups = h('datalist', { id: 'sp-groups' }, ...[...new Set(data.topics.map((x) => x.subject))].map((s) => h('option', { value: s })));
  const create = async () => {
    if (!name.value.trim()) return name.focus();
    const topic = await rpc('saveTopic', { subject: group.value || 'General', name: name.value });
    view.chooser = false;
    await NM.setActive({ topicId: topic.id, on: true });
  };
  for (const input of [name, group]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') create();
      if (e.key === 'Escape') { view.chooser = false; renderCollect(); }
    });
  }
  const box = h('div', { class: 'chooser' }, ...recent,
    h('div', { class: 'new' },
      h('div', { class: 'collect-label' }, ic('plus', 12), t('sp.newCollection')),
      name, group, groups,
      h('button', { class: 'btn primary', onclick: create }, ic('plus', 15), t('picker.create'))));
  setTimeout(() => (data.topics.length ? null : name.focus()), 0);
  return box;
}

document.addEventListener('mousedown', (e) => {
  if (view.chooser && !e.target.closest('.chooser') && !e.target.closest('.collect-pick') && !e.target.closest('.switch')) {
    view.chooser = false;
    renderCollect();
  }
});

// Returns the active collection, or opens the chooser and returns null.
async function ensureTopic() {
  const topic = activeTopic();
  if (topic) return topic;
  view.chooser = true;
  renderCollect();
  return null;
}

async function captureArea() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const ok = await chrome.tabs.sendMessage(tab.id, { type: 'nm-capture', mode: 'area' }).catch(() => false);
  if (ok) return;
  try {
    const image = await rpc('captureVisible', { windowId: tab.windowId });
    view.shot = { image, tab };
    view.composer = false;
    renderCollect();
  } catch {
    toast(t('err.noCapture'));
  }
}

// ---------------------------------------------------------------------------
// Tabs, search, filters

function renderControls() {
  const tabs = $('#tabs');
  tabs.replaceChildren(
    h('button', { class: view.tab === 'library' ? 'on' : '', onclick: () => setTab('library') },
      ic('folder', 15), t('sp.library'), h('span', { class: 'n' }, String(data.topics.length))),
    h('button', { class: view.tab === 'highlights' ? 'on' : '', onclick: () => setTab('highlights') },
      ic('highlighter', 15), t('sp.highlights'), h('span', { class: 'n' }, String(data.highlights.length))),
  );
  const colors = $('#colors');
  colors.hidden = view.tab !== 'highlights';
  colors.replaceChildren(
    h('button', { class: `chip${view.color ? '' : ' on'}`, onclick: () => setColor(null) }, t('common.all')),
    ...COLORS.map((c) => h('button', { class: `chip${view.color === c.id ? ' on' : ''}`, onclick: () => setColor(c.id) },
      h('span', { class: `swatch sw-${c.id}` }), NM.label(c.id))),
  );
}

function setColor(c) {
  view.color = c;
  render();
}

function setTab(tab) {
  view.tab = tab;
  render();
}

$('#q').addEventListener('input', (e) => {
  view.query = e.target.value.trim().toLowerCase();
  renderList();
});

// ---------------------------------------------------------------------------
// Lists

function render() {
  renderHeader();
  renderCollect();
  renderControls();
  renderList();
}

function renderList() {
  if (view.tab === 'library') renderLibrary();
  else renderHighlights();
}

function emptyState() {
  return h('div', { class: 'empty' },
    h('div', { html: ILLUSTRATION }),
    h('p', { class: 'tagline' }, t('brand.tagline')),
    h('h3', {}, t('sp.emptyTitle')),
    h('div', { class: 'steps' },
      h('div', { class: 'step' }, h('b', {}, '1'), h('span', {}, t('sp.step1'))),
      h('div', { class: 'step' }, h('b', {}, '2'), h('span', {}, t('sp.step2'))),
      h('div', { class: 'step' }, h('b', {}, '3'), h('span', {}, t('sp.step3')))));
}

function renderLibrary() {
  const { topics, sources } = data;
  if (!topics.length) return main.replaceChildren(emptyState());
  const q = view.query;
  const groups = new Map();
  for (const topic of [...topics].sort((a, b) => a.name.localeCompare(b.name))) {
    const all = sources.filter((s) => s.topicId === topic.id).sort((a, b) => b.updatedAt - a.updatedAt);
    const topicMatch = !q || topic.name.toLowerCase().includes(q) || topic.subject.toLowerCase().includes(q);
    const srcs = topicMatch ? all : all.filter((s) => sourceTitle(s).toLowerCase().includes(q));
    if (q && !srcs.length && !topicMatch) continue;
    if (!groups.has(topic.subject)) groups.set(topic.subject, []);
    groups.get(topic.subject).push({ topic, srcs });
  }
  if (!groups.size) return main.replaceChildren(h('div', { class: 'empty' }, h('p', {}, t('sp.noMatches'))));
  main.replaceChildren(...[...groups.keys()].sort((a, b) => a.localeCompare(b)).map((subject) => {
    const items = groups.get(subject);
    const g = h('section', { class: `group${view.open.has(`closed:${subject}`) ? ' closed' : ''}` },
      h('button', {
        class: 'group-head',
        onclick: () => {
          const k = `closed:${subject}`;
          if (view.open.has(k)) view.open.delete(k);
          else view.open.add(k);
          g.classList.toggle('closed');
        },
      }, ic('chevronDown', 13), subject, h('span', { class: 'n' }, String(items.length))),
      h('div', { class: 'group-body' }, ...items.map(({ topic, srcs }) => renderCollection(topic, srcs))));
    return g;
  }));
}

function renderCollection(topic, srcs) {
  const stars = srcs.reduce((n, s) => n + s.highlightCount, 0);
  const isActive = active.on && active.topicId === topic.id;
  const showAll = view.allSources.has(topic.id) || view.query;
  const shown = showAll ? srcs : srcs.slice(0, 3);
  return h('article', { class: `coll${isActive ? ' active' : ''}` },
    h('div', { class: 'coll-head', onclick: () => openReader({ topic: topic.id }) },
      tile(topic, 36),
      h('div', { class: 't' },
        h('div', { class: 'n' }, h('span', {}, topic.name), isActive ? h('span', { class: 'tag' }, t('sp.collectingInto')) : null),
        h('div', { class: 'm' }, `${NM.count(srcs.length, 'sp.sources', 'sp.source1')} · ${NM.count(stars, 'sp.hls', 'sp.hl1')}`))),
    h('div', { class: 'coll-acts' },
      h('button', { class: 'btn small', onclick: () => openReader({ topic: topic.id }) }, ic('book', 14), t('common.open')),
      h('button', { class: 'btn small', onclick: () => openReader({ topic: topic.id, mode: 'board' }) }, ic('board', 14), t('sp.board')),
      h('button', { class: 'btn small', onclick: () => openReader({ topic: topic.id, mode: 'review' }), disabled: !stars }, ic('cap', 14), t('sp.review')),
      h('button', { class: 'icon-btn small', title: t('common.rename'), onclick: () => renameTopic(topic) }, ic('pencil', 14)),
      h('button', { class: 'icon-btn small danger', title: t('common.delete'), onclick: () => deleteTopic(topic) }, ic('trash', 14))),
    srcs.length ? h('div', { class: 'srcs' },
      ...shown.map((s) => h('div', { class: 'src', onclick: () => openReader({ source: s.id }) },
        badge(s),
        h('div', { class: 't' }, h('div', { class: 'n', title: sourceTitle(s) }, sourceTitle(s)), h('div', { class: 'm' }, sourceMeta(s))),
        s.highlightCount ? h('span', { class: 'faint count', style: 'font-size:12px' }, String(s.highlightCount)) : null,
        h('button', {
          class: 'icon-btn small danger row-del',
          title: t('common.delete'),
          onclick: (e) => {
            e.stopPropagation();
            deleteSource(s);
          },
        }, ic('trash', 14)))),
      srcs.length > shown.length
        ? h('button', { class: 'more-srcs', onclick: () => { view.allSources.add(topic.id); renderList(); } }, `+${srcs.length - shown.length}`)
        : null) : null);
}

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
  if (active.topicId === topic.id) await NM.setActive({ topicId: null, on: false });
  toast(t('toast.deleted'));
  load();
}

async function deleteSource(src) {
  if (!confirm(t('sp.confirmSource', { title: sourceTitle(src) }))) return;
  await rpc('deleteSource', { id: src.id });
  toast(t('toast.deleted'));
  load();
}

function renderHighlights() {
  const sources = new Map(data.sources.map((s) => [s.id, s]));
  const topics = new Map(data.topics.map((x) => [x.id, x]));
  const q = view.query;
  const list = data.highlights.filter((hl) =>
    (!view.color || hl.color === view.color) &&
    (!q || (hl.text || '').toLowerCase().includes(q) || (hl.note || '').toLowerCase().includes(q) ||
      (sources.get(hl.sourceId)?.title || '').toLowerCase().includes(q)));
  if (!list.length) {
    return main.replaceChildren(h('div', { class: 'empty' }, h('p', {}, data.highlights.length ? t('sp.noMatches') : t('sp.noHighlights'))));
  }
  main.replaceChildren(...list.slice(0, 300).map((hl) => {
    const src = sources.get(hl.sourceId);
    const topic = topics.get(src?.topicId);
    if (view.editing === hl.id) return editCard(hl);
    return h('article', { class: `hl bar-${hl.color}`, onclick: () => openReader({ source: hl.sourceId, hl: hl.id }) },
      h('div', { class: 'hl-acts' },
        h('button', { class: 'icon-btn small', title: t('common.edit'), onclick: (e) => { e.stopPropagation(); view.editing = hl.id; renderList(); } }, ic('pencil', 14)),
        h('button', { class: 'icon-btn small danger', title: t('common.delete'), onclick: (e) => { e.stopPropagation(); deleteHighlight(hl); } }, ic('trash', 14))),
      hl.image ? h('img', { src: hl.image, alt: '' }) : null,
      hl.image ? null : h('div', { class: 'text' }, hl.text || ''),
      hl.note ? h('div', { class: 'note' }, ic('pencil', 12), h('span', {}, hl.note)) : null,
      h('div', { class: 'meta' },
        h('span', { class: `swatch sw-${hl.color}` }),
        h('span', {}, `${NM.label(hl.color)} · ${topic ? topic.name : ''} · ${src ? sourceTitle(src) : t('sp.deleted')}`)));
  }));
  main.querySelector('.hl-edit textarea')?.focus();
}

// A highlight card turned into an editor: colour, note, delete.
function editCard(hl) {
  let color = hl.color;
  const ta = h('textarea', { rows: '3', placeholder: t('sp.notePh') });
  ta.value = hl.note || '';
  const dots = COLORS.map((c) => h('button', {
    class: `dot${c.id === color ? ' on' : ''}`, style: `--c:${c.swatch}`, title: NM.label(c.id),
    onclick: (e) => {
      color = c.id;
      e.currentTarget.parentElement.querySelectorAll('.dot').forEach((d) => d.classList.toggle('on', d === e.currentTarget));
    },
  }));
  const close = () => { view.editing = null; renderList(); };
  const save = async () => {
    await rpc('updateHighlight', { id: hl.id, color, note: ta.value });
    view.editing = null;
    toast(t('toast.saved'));
    load();
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
    if (e.key === 'Escape') close();
  });
  return h('article', { class: `hl hl-edit bar-${hl.color}` },
    hl.image ? h('img', { src: hl.image, alt: '' }) : h('div', { class: 'text' }, hl.text || ''),
    h('div', { class: 'dots' }, ...dots), ta,
    h('div', { class: 'edit-row' },
      h('button', { class: 'btn small ghost danger', onclick: () => deleteHighlight(hl) }, ic('trash', 14), t('common.delete')),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn small', onclick: close }, t('common.cancel')),
      h('button', { class: 'btn small primary', onclick: save }, ic('check', 14), t('common.save'))));
}

async function deleteHighlight(hl) {
  if (!confirm(t('sp.confirmHl'))) return;
  await rpc('deleteHighlight', { id: hl.id });
  view.editing = null;
  toast(t('toast.deleted'));
  load();
}

const ILLUSTRATION = `<svg class="illus" width="132" height="92" viewBox="0 0 132 92" fill="none" aria-hidden="true">
  <rect x="14" y="6" width="104" height="80" rx="14" fill="var(--surface)" stroke="var(--line)"/>
  <rect x="28" y="22" width="56" height="7" rx="3.5" fill="var(--line)"/>
  <rect x="26" y="37" width="80" height="11" rx="3" fill="var(--mk-yellow)"/>
  <rect x="28" y="39" width="70" height="7" rx="3.5" fill="var(--line-strong)"/>
  <rect x="28" y="56" width="62" height="7" rx="3.5" fill="var(--line)"/>
  <rect x="26" y="68" width="44" height="11" rx="3" fill="var(--mk-blue)"/>
  <rect x="28" y="70" width="36" height="7" rx="3.5" fill="var(--line-strong)"/>
  <circle cx="108" cy="72" r="13" fill="var(--ink)"/>
  <path d="m103 72 3.5 3.5L113 69" stroke="var(--on-ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'nm-changed') scheduleLoad();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings || changes.activeTopicId || changes.collecting) scheduleLoad();
});

load().catch(showError);
