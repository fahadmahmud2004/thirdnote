const { rpc, COLORS, icon, t } = NM;

const params = new URLSearchParams(location.search);
const st = {
  kind: params.has('topic') ? 'topic' : 'source',
  id: params.get('topic') || params.get('source'),
  mode: ['full', 'highlights', 'review'].includes(params.get('mode')) ? params.get('mode') : 'full',
  focus: params.get('hl'),
  color: null,
  topic: null,
  sections: [],
  topics: [],
  settings: NM.DEFAULT_SETTINGS,
  deck: null, // review session: { queue, index, revealed, got, again, total }
};

const barEl = document.getElementById('bar');
const heroEl = document.getElementById('hero');
const mainEl = document.getElementById('main');

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
const ic = (name, size) => h('span', { html: icon(name, size) }).firstChild;

const oneLine = (s, n = 180) => {
  const x = (s || '').replace(/\s+/g, ' ').trim();
  return x.length > n ? `${x.slice(0, n)}…` : x;
};
const sourceTitle = (src) => (src.kind === 'note' ? t('sp.myNotes') : src.title);
function roleLabel(src, m) {
  if (m.role === 'user') return t('rd.you');
  if (m.role === 'clip') return t('rd.clip');
  if (m.role === 'note') return t('rd.note');
  return NM.siteName(src);
}

function toast(text) {
  const el = document.getElementById('toast');
  el.innerHTML = icon('check', 14);
  el.append(text);
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2200);
}

const readerUrl = (p) => `reader.html?${new URLSearchParams(p)}`;

// ---------------------------------------------------------------------------
// Data

async function load() {
  st.settings = await NM.getSettings();
  NM.applyPage(st.settings);
  st.topics = await rpc('listTopics');
  if (st.kind === 'source') {
    const d = await rpc('getSourceFull', { id: st.id });
    st.topic = d?.topic || null;
    st.sections = d ? [{ source: d.source, messages: d.messages, highlights: d.highlights }] : [];
  } else {
    const d = await rpc('getTopicFull', { id: st.id });
    st.topic = d?.topic || null;
    st.sections = d?.sections || [];
  }
  st.sections.forEach(prepare);
}

// For every highlight: its message, its position in that message, and the
// question asked before it (the prompt in Review).
function prepare(sec) {
  const byKey = new Map(sec.messages.map((m) => [m.key, m]));
  const lastQuestion = new Map();
  let q = null;
  for (const m of sec.messages) {
    lastQuestion.set(m.key, m.role === 'user' ? null : q);
    if (m.role === 'user' && !m.excluded) q = m.text;
  }
  const bodies = new Map();
  for (const hl of sec.highlights) {
    const m = byKey.get(hl.messageKey) || null;
    hl._msg = m;
    hl._sec = sec;
    hl._cue = m ? lastQuestion.get(m.key) : null;
    hl._pos = -1;
    if (m && !hl.image) {
      if (!bodies.has(m.key)) {
        const div = document.createElement('div');
        div.innerHTML = NMSanitize.cleanHtml(m.html);
        bodies.set(m.key, div);
      }
      hl._pos = NMAnchor.position(bodies.get(m.key), hl);
    }
  }
  sec.ordered = [...sec.highlights].sort((a, b) =>
    (a._msg?.order ?? Infinity) - (b._msg?.order ?? Infinity) || a._pos - b._pos || a.createdAt - b.createdAt);
}

function findHighlight(id) {
  for (const sec of st.sections) {
    const hl = sec.highlights.find((x) => x.id === id);
    if (hl) return hl;
  }
  return null;
}

function visibleHighlights(sec) {
  return sec.ordered.filter((hl) => (!st.color || hl.color === st.color) && !hl._msg?.excluded);
}

async function reload() {
  const y = scrollY;
  await load();
  render();
  scrollTo(0, y);
}

// ---------------------------------------------------------------------------
// Bar and hero

function render() {
  if (!st.sections.length && !(st.kind === 'topic' && st.topic)) {
    renderBar();
    heroEl.replaceChildren();
    mainEl.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, t('rd.notFound')), h('p', {}, t('rd.notFoundText'))));
    return;
  }
  renderBar();
  renderHero();
  if (st.mode === 'full') renderFull();
  else if (st.mode === 'highlights') renderHighlightList();
  else renderReview();
}

function renderBar() {
  const src = st.kind === 'source' ? st.sections[0]?.source : null;
  const crumbs = h('div', { class: 'crumbs' }, h('img', { src: '../icons/icon32.png', width: 20, height: 20, alt: '' }));
  if (st.topic) {
    crumbs.append(h('span', { class: 'sep' }, st.topic.subject), h('span', { class: 'sep' }, '/'));
    crumbs.append(src ? h('a', { href: readerUrl({ topic: st.topic.id }) }, st.topic.name) : h('span', {}, st.topic.name));
  }

  const seg = h('div', { class: 'seg' },
    ...[['full', 'book', 'rd.read'], ['highlights', 'highlighter', 'rd.highlights'], ['review', 'cap', 'rd.review']].map(([m, i, k]) =>
      h('button', { class: st.mode === m ? 'on' : '', onclick: () => setMode(m) }, ic(i, 15), t(k))));

  const exportMenu = menu(h('span', {}, ic('download', 15), t('rd.export')), [
    h('button', { onclick: exportMarkdown }, ic('download', 15), t('rd.exportMd')),
    h('button', { onclick: () => print() }, ic('book', 15), t('rd.exportPdf')),
  ]);

  const moreItems = [];
  if (src) {
    moreItems.push(h('div', { class: 'menu-label' }, t('rd.moveTo')),
      h('div', { class: 'menu-scroll' },
        ...st.topics.map((x) => h('button', { onclick: () => moveTo(src, x.id) },
          x.id === src.topicId ? ic('check', 15) : ic('folder', 15), `${x.name}`, h('span', { class: 'faint', style: 'margin-left:auto;font-size:12px' }, x.subject))),
        h('button', { onclick: () => moveTo(src, '__new') }, ic('plus', 15), t('rd.newCollection'))),
      h('div', { class: 'sep' }));
  }
  moreItems.push(h('button', { class: 'danger', onclick: onDelete }, ic('trash', 15), t('common.delete')));
  const more = menu(ic('more', 17), moreItems, true);

  barEl.replaceChildren(h('div', { class: 'bar-inner' }, crumbs, seg, h('div', { class: 'bar-right' }, exportMenu, more)));
}

// A button that opens a dropdown menu.
function menu(label, items, iconOnly = false) {
  const wrap = h('div', { class: 'menu-wrap' });
  const list = h('div', { class: 'menu', hidden: true }, ...items);
  const btn = h('button', {
    class: iconOnly ? 'icon-btn' : 'btn',
    title: iconOnly ? t('rd.more') : null,
    onclick: (e) => {
      e.stopPropagation();
      const open = list.hidden;
      document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
      list.hidden = !open;
    },
  }, label);
  list.addEventListener('click', (e) => {
    if (e.target.closest('button')) list.hidden = true;
  });
  wrap.append(btn, list);
  return wrap;
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap')) document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
});

function renderHero() {
  const src = st.kind === 'source' ? st.sections[0]?.source : null;
  const titleText = src ? sourceTitle(src) : st.topic?.name || '';
  document.title = `${titleText} · ThirdNote`;
  const total = st.sections.reduce((n, s) => n + s.highlights.length, 0);
  const title = h('h1', { contenteditable: src?.kind === 'note' ? 'false' : 'true', spellcheck: 'false', title: t('rd.rename') }, titleText);
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      title.blur();
    }
  });
  title.addEventListener('blur', async () => {
    const next = title.textContent.trim();
    if (!next || next === titleText) return;
    if (src) await rpc('updateSource', { id: src.id, title: next });
    else await rpc('updateTopic', { id: st.topic.id, name: next });
    toast(t('toast.renamed'));
    reload();
  });

  const dot = () => h('span', { class: 'mdot' });
  const meta = h('div', { class: 'meta' });
  if (src) {
    const n = st.sections[0].messages.length;
    const items = src.kind === 'page' ? NM.count(n, 'sp.clips', 'sp.clip1')
      : src.kind === 'note' ? NM.count(n, 'sp.notes', 'sp.note1') : NM.count(n, 'sp.msgs', 'sp.msg1');
    if (src.kind !== 'note') meta.append(h('span', {}, NM.siteName(src)), dot());
    meta.append(h('span', {}, items), dot(), h('span', {}, NM.count(total, 'sp.hls', 'sp.hl1')));
    if (src.tracked) meta.append(h('span', { class: 'pill-live', title: t('rd.liveTip') }, t('rd.live')));
    if (src.url) meta.append(dot(), h('a', { href: src.url, target: '_blank', rel: 'noopener' }, t('rd.original'), ic('external', 13)));
  } else {
    meta.append(h('span', {}, st.topic.subject), dot(), h('span', {}, NM.count(st.sections.length, 'sp.sources', 'sp.source1')),
      dot(), h('span', {}, NM.count(total, 'sp.hls', 'sp.hl1')));
  }
  heroEl.replaceChildren(title, meta);
}

async function moveTo(src, topicId) {
  if (topicId === '__new') {
    const name = prompt(t('rd.namePrompt'));
    if (!name) return;
    const subject = prompt(t('rd.groupPrompt'), st.topic?.subject || '') || 'General';
    topicId = (await rpc('saveTopic', { subject, name })).id;
  }
  await rpc('updateSource', { id: src.id, topicId });
  const target = st.topics.find((x) => x.id === topicId);
  toast(t('toast.moved', { name: target?.name || '' }));
  reload();
}

async function onDelete() {
  if (st.kind === 'source') {
    const sec = st.sections[0];
    if (!confirm(t('rd.confirmSource', { title: sourceTitle(sec.source), m: sec.messages.length, h: sec.highlights.length }))) return;
    await rpc('deleteSource', { id: sec.source.id });
  } else {
    if (!confirm(t('rd.confirmTopic', { title: st.topic.name, n: st.sections.length }))) return;
    await rpc('deleteTopic', { id: st.topic.id });
  }
  st.sections = [];
  st.topic = null;
  barEl.replaceChildren();
  heroEl.replaceChildren();
  mainEl.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, t('rd.deleted')), h('p', {}, t('rd.deletedText'))));
}

function setMode(mode) {
  st.mode = mode;
  st.deck = null;
  const p = new URLSearchParams(location.search);
  p.set('mode', mode);
  p.delete('hl');
  history.replaceState(null, '', `?${p}`);
  render();
  scrollTo(0, 0);
}

function colorChips() {
  return h('div', { class: 'chips' },
    h('button', { class: `chip${st.color ? '' : ' on'}`, onclick: () => setColor(null) }, t('common.all')),
    ...COLORS.map((c) => h('button', { class: `chip${st.color === c.id ? ' on' : ''}`, onclick: () => setColor(c.id) },
      h('span', { class: `swatch sw-${c.id}` }), NM.label(c.id))));
}

function setColor(color) {
  st.color = color;
  st.deck = null;
  render();
}

// ---------------------------------------------------------------------------
// Read

function markFor(hl) {
  const m = document.createElement('mark');
  m.className = `nm-hl c-${hl.color}`;
  m.dataset.hl = hl.id;
  if (hl.note) m.title = hl.note;
  return m;
}

// A stored message's HTML with its highlights painted in, plus the
// highlights that could not be placed.
function messageBody(sec, m) {
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = NMSanitize.cleanHtml(m.html);
  const failed = [];
  for (const hl of sec.highlights.filter((x) => x.messageKey === m.key && !x.image)) {
    if (!NMAnchor.wrapQuote(body, hl, () => markFor(hl)).length) failed.push(hl);
  }
  return { body, failed };
}

function sectionHead(src) {
  return h('div', { class: 'section-head' },
    badge(src),
    h('h2', {}, sourceTitle(src)),
    h('a', { class: 'btn small no-print', href: readerUrl({ source: src.id }) }, t('common.open')));
}

function badge(src) {
  const site = NM.SITES[src.site];
  if (src.kind === 'note') return h('span', { class: 'badge', style: '--bg-badge:#8a6d3b' }, ic('notepad', 13));
  if (src.kind === 'page' || !site) return h('span', { class: 'badge', style: '--bg-badge:#8a857c' }, ic('globe', 13));
  return h('span', { class: 'badge', style: `--bg-badge:${site.color}` }, site.short);
}

function renderFull() {
  const out = [];
  for (const sec of st.sections) {
    if (st.kind === 'topic') out.push(sectionHead(sec.source));
    if (!sec.messages.length) out.push(h('p', { class: 'muted' }, t('rd.noMessages')));
    for (const m of sec.messages) out.push(renderMessage(sec, m));
    const lost = sec.highlights.filter((hl) => !hl._msg);
    if (lost.length) out.push(orphanList(lost, t('rd.lost')));
  }
  if (!out.length) out.push(h('div', { class: 'empty' }, h('p', {}, t('rd.noMessages'))));
  mainEl.replaceChildren(...out);

  if (st.focus) {
    const marks = mainEl.querySelectorAll(`[data-hl="${CSS.escape(st.focus)}"]`);
    const hl = findHighlight(st.focus);
    const target = marks[0] || (hl?._msg && mainEl.querySelector(`[data-mid="${CSS.escape(hl._msg.id)}"]`));
    if (target) {
      target.scrollIntoView({ block: 'center' });
      marks.forEach((x) => x.classList.add('flash'));
      setTimeout(() => marks.forEach((x) => x.classList.remove('flash')), 2500);
    }
    st.focus = null;
  }
}

function renderMessage(sec, m) {
  const { body, failed } = messageBody(sec, m);
  body.dataset.mid = m.id;
  const deletable = m.role === 'clip' || m.role === 'note';
  const acts = h('span', { class: 'acts' },
    h('button', {
      class: 'btn small ghost',
      title: m.excluded ? null : t('rd.hideTip'),
      onclick: async () => {
        await rpc('setMessageExcluded', { id: m.id, excluded: !m.excluded });
        reload();
      },
    }, ic(m.excluded ? 'eye' : 'eyeOff', 14), m.excluded ? t('rd.show') : t('rd.hide')),
    deletable
      ? h('button', {
          class: 'icon-btn small', title: t('common.delete'),
          onclick: async () => {
            if (!confirm(t('rd.confirmClip'))) return;
            await rpc('deleteMessage', { id: m.id });
            reload();
          },
        }, ic('trash', 14))
      : null);
  return h('article', { class: `msg ${m.role}${m.excluded ? ' excluded' : ''}`, 'data-hidden': `· ${t('rd.hidden')}` },
    h('div', { class: 'msg-head' },
      h('span', {}, roleLabel(sec.source, m)),
      deletable ? h('span', { class: 'faint', style: 'text-transform:none;letter-spacing:0;font-weight:500' }, NM.timeAgo(m.savedAt)) : null,
      acts),
    body,
    failed.length ? orphanList(failed, t('rd.orphans')) : null);
}

function orphanList(list, heading) {
  return h('div', { class: 'orphans' }, heading,
    ...list.map((hl) => h('div', { class: `orph bar-${hl.color}`, 'data-hl': hl.id, onclick: (e) => openPopover(hl.id, e.currentTarget) }, hl.text)));
}

// ---------------------------------------------------------------------------
// Highlights

function renderHighlightList() {
  const out = [h('div', { class: 'tools' }, colorChips())];
  let count = 0;
  for (const sec of st.sections) {
    const list = visibleHighlights(sec);
    if (!list.length) continue;
    if (st.kind === 'topic') out.push(sectionHead(sec.source));
    let lastCue;
    for (const hl of list) {
      count++;
      if (hl._cue && hl._cue !== lastCue) out.push(h('div', { class: 'cue' }, ic('message', 15), h('span', {}, oneLine(hl._cue, 220))));
      lastCue = hl._cue;
      out.push(h('div', { class: `hcard bar-${hl.color}` },
        hl.image ? h('img', { src: hl.image, alt: '' }) : h('div', { class: 'text' }, hl.text),
        hl.note ? h('div', { class: 'note' }, ic('pencil', 13), h('span', {}, hl.note)) : null,
        h('div', { class: 'foot' },
          h('span', { class: `swatch sw-${hl.color}` }), h('span', {}, NM.label(hl.color)),
          h('span', { class: 'grow' }),
          hl._msg ? h('button', { class: 'btn small ghost no-print', onclick: () => showInContext(hl.id) }, ic('book', 13), t('rd.context')) : null,
          h('button', { class: 'btn small ghost no-print', onclick: (e) => openPopover(hl.id, e.currentTarget) }, ic('pencil', 13), t('rd.edit')))));
    }
  }
  if (!count) out.push(emptyHighlights());
  mainEl.replaceChildren(...out);
}

function emptyHighlights() {
  return h('div', { class: 'empty' },
    h('h3', {}, st.color ? t('rd.noHlColor', { label: NM.label(st.color) }) : t('rd.noHl')),
    h('p', {}, t('rd.noHlHint')));
}

function showInContext(id) {
  st.mode = 'full';
  setMode('full');
  st.focus = id;
  renderFull();
}

// ---------------------------------------------------------------------------
// Review: flashcards. The prompt is your note or the question you asked;
// the highlight is the answer.

function newDeck(ids) {
  const all = st.sections.flatMap((sec) => visibleHighlights(sec));
  const queue = ids ? all.filter((hl) => ids.includes(hl.id)) : all;
  return { queue: queue.map((hl) => hl.id), index: 0, revealed: false, got: 0, again: [], total: queue.length };
}

function renderReview() {
  if (!st.deck) st.deck = newDeck();
  const d = st.deck;
  const out = [h('div', { class: 'tools' }, colorChips(), h('span', { class: 'grow' }),
    h('button', {
      class: 'btn small',
      onclick: () => {
        st.deck = newDeck();
        st.deck.queue.sort(() => Math.random() - 0.5);
        renderReview();
      },
    }, ic('shuffle', 14), t('rd.shuffle')))];

  if (!d.total) {
    out.push(emptyHighlights());
    return mainEl.replaceChildren(...out);
  }
  if (d.index >= d.queue.length) {
    out.push(h('div', { class: 'card flash done' },
      h('div', { class: 'big', html: icon('check', 30) }),
      h('h2', {}, t('rd.doneTitle')),
      h('p', {}, t('rd.doneText', { got: d.got, again: d.again.length })),
      h('div', { class: 'row' },
        d.again.length ? h('button', { class: 'btn primary', onclick: () => { st.deck = newDeck(d.again); renderReview(); } }, ic('rotate', 15), t('rd.reviewMissed')) : null,
        h('button', { class: 'btn', onclick: () => { st.deck = newDeck(); renderReview(); } }, ic('refresh', 15), t('rd.restart')))));
    return mainEl.replaceChildren(...out);
  }

  const hl = findHighlight(d.queue[d.index]);
  const sec = hl._sec;
  const prompt = hl.note || (hl._cue ? oneLine(hl._cue, 260) : t('rd.cueFrom', { title: sourceTitle(sec.source) }));
  out.push(h('div', { class: 'deck-top' },
    h('div', { class: 'progress' }, h('div', { style: `width:${(d.index / d.queue.length) * 100}%` })),
    h('span', { class: 'deck-count' }, t('rd.progress', { i: d.index + 1, n: d.queue.length }))));

  const card = h('div', { class: 'card flash' },
    h('div', { class: 'kind' }, h('span', { class: `swatch sw-${hl.color}` }), NM.label(hl.color)),
    h('div', { class: 'prompt' }, prompt));
  if (d.revealed) {
    card.append(h('div', { class: 'divider' }),
      h('div', { class: 'answer' },
        hl.image ? h('img', { src: hl.image, alt: '' }) : hl.text,
        hl.note && hl._cue ? h('div', { class: 'note' }, oneLine(hl._cue, 200)) : null),
      h('div', { class: 'spacer' }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => answer(false) }, ic('rotate', 15), t('rd.again'), h('span', { class: 'kbd' }, '1')),
        h('button', { class: 'btn primary', onclick: () => answer(true) }, ic('check', 15), t('rd.gotIt'), h('span', { class: 'kbd' }, '2'))));
  } else {
    card.append(h('p', { class: 'muted', style: 'margin:14px 0 0' }, t('rd.recall')),
      h('div', { class: 'spacer' }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: reveal }, ic('eye', 15), t('rd.showAnswer'), h('span', { class: 'kbd' }, 'Space'))));
  }
  card.append(h('div', { class: 'src-line' }, sourceTitle(sec.source)));
  out.push(card, h('div', { class: 'keys no-print' }, t('rd.keys')));
  mainEl.replaceChildren(...out);
}

function reveal() {
  st.deck.revealed = true;
  renderReview();
}

function answer(gotIt) {
  const d = st.deck;
  if (gotIt) d.got++;
  else d.again.push(d.queue[d.index]);
  d.index++;
  d.revealed = false;
  renderReview();
}

document.addEventListener('keydown', (e) => {
  if (st.mode !== 'review' || !st.deck || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
  const d = st.deck;
  if (d.index >= d.queue.length) return;
  if ((e.key === ' ' || e.key === 'Enter') && !d.revealed) {
    e.preventDefault();
    reveal();
  } else if (d.revealed && (e.key === '1' || e.key === '2')) {
    e.preventDefault();
    answer(e.key === '2');
  }
});

// ---------------------------------------------------------------------------
// Select text in Read mode to add a highlight

const tb = document.getElementById('tb');
const tbNote = document.getElementById('tb-note');
let pending = null;
let lastColor = 'yellow';

function colorDots(onPick) {
  return COLORS.map((c) => h('button', { class: 'dot', style: `--c:${c.swatch}`, 'data-color': c.id, onclick: () => onPick(c.id) }));
}

document.getElementById('tb-colors').append(
  ...colorDots((c) => saveSelection(c)),
  h('span', { class: 'sep' }),
  h('button', {
    class: 'icon-btn', onclick: () => {
      tbNote.hidden = !tbNote.hidden;
      if (!tbNote.hidden) tbNote.focus();
    },
  }, ic('pencil', 16)));
tb.addEventListener('mousedown', (e) => {
  if (e.target !== tbNote) e.preventDefault();
});
tbNote.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    saveSelection(lastColor);
  }
});

document.addEventListener('mouseup', (e) => {
  if (tb.contains(e.target) || pop.contains(e.target)) return;
  setTimeout(() => {
    pending = null;
    const sel = getSelection();
    if (st.mode !== 'full' || !sel.rangeCount || sel.isCollapsed || sel.toString().trim().length < 2) {
      tb.hidden = true;
      return;
    }
    const range = sel.getRangeAt(0);
    const el = (n) => (n.nodeType === 1 ? n : n.parentElement);
    const startBody = el(range.startContainer)?.closest('.msg-body');
    if (!startBody || startBody !== el(range.endContainer)?.closest('.msg-body')) {
      tb.hidden = true;
      return;
    }
    pending = { body: startBody, range: range.cloneRange() };
    tb.querySelectorAll('.dot').forEach((d) => { d.title = NM.label(d.dataset.color); });
    tbNote.value = '';
    tbNote.placeholder = t('tb.notePlaceholder');
    tbNote.hidden = true;
    place(tb, range.getBoundingClientRect());
  }, 0);
});

document.addEventListener('keydown', (e) => {
  if (tb.hidden || e.target === tbNote || e.metaKey || e.ctrlKey) return;
  const i = ['1', '2', '3', '4'].indexOf(e.key);
  if (i >= 0) {
    e.preventDefault();
    saveSelection(COLORS[i].id);
  }
});

async function saveSelection(color) {
  const p = pending;
  tb.hidden = true;
  if (!p) return;
  lastColor = color;
  const sec = st.sections.find((s) => s.messages.some((m) => m.id === p.body.dataset.mid));
  const m = sec?.messages.find((x) => x.id === p.body.dataset.mid);
  const q = m && NMAnchor.quote(p.body, p.range);
  if (!q?.exact) return toast(t('err.readSel'));
  await rpc('addHighlight', { sourceId: sec.source.id, messageKey: m.key, ...q, color, note: tbNote.value });
  getSelection().removeAllRanges();
  toast(t('toast.highlighted', { label: NM.label(color) }));
  reload();
}

function place(el, rect) {
  el.hidden = false;
  const w = el.offsetWidth;
  const ht = el.offsetHeight;
  let top = rect.bottom + 10;
  if (top + ht > innerHeight - 8) top = rect.top - ht - 10;
  el.style.top = `${Math.max(64, top)}px`;
  el.style.left = `${Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), innerWidth - w - 8)}px`;
}

// ---------------------------------------------------------------------------
// Click a highlight to change its colour or note, or delete it

const pop = document.getElementById('pop');
const popNote = document.getElementById('pop-note');
let popId = null;

document.getElementById('pop-colors').append(...colorDots(async (c) => {
  await rpc('updateHighlight', { id: popId, color: c, note: popNote.value });
  closePopover();
  reload();
}));
document.getElementById('pop-save').addEventListener('click', async () => {
  await rpc('updateHighlight', { id: popId, note: popNote.value });
  closePopover();
  toast(t('toast.saved'));
  reload();
});
document.getElementById('pop-delete').addEventListener('click', async () => {
  await rpc('deleteHighlight', { id: popId });
  closePopover();
  toast(t('toast.deleted'));
  reload();
});

mainEl.addEventListener('click', (e) => {
  const mark = e.target.closest('mark.nm-hl');
  if (!mark || !getSelection().isCollapsed) return;
  openPopover(mark.dataset.hl, mark);
});

function openPopover(id, anchorEl) {
  const hl = findHighlight(id);
  if (!hl) return;
  popId = id;
  popNote.value = hl.note || '';
  popNote.placeholder = t('rd.popNote');
  document.getElementById('pop-delete').replaceChildren(ic('trash', 14), t('common.delete'));
  document.getElementById('pop-save').replaceChildren(ic('check', 14), t('rd.saveNote'));
  pop.querySelectorAll('.dot').forEach((d) => {
    d.classList.toggle('on', d.dataset.color === hl.color);
    d.title = NM.label(d.dataset.color);
  });
  tb.hidden = true;
  place(pop, anchorEl.getBoundingClientRect());
}

function closePopover() {
  pop.hidden = true;
  popId = null;
}

document.addEventListener('mousedown', (e) => {
  if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('mark.nm-hl')) closePopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePopover();
    tb.hidden = true;
  }
});
addEventListener('scroll', () => { tb.hidden = true; }, { passive: true });

// ---------------------------------------------------------------------------
// Markdown export

function exportMarkdown() {
  const src = st.kind === 'source' ? st.sections[0].source : null;
  const title = src ? sourceTitle(src) : st.topic.name;
  const lines = [`# ${title}`, ''];
  if (st.topic) lines.push(`*${st.topic.subject} / ${st.topic.name}*`, '');
  const hdr = st.kind === 'topic' ? '###' : '##';
  for (const sec of st.sections) {
    if (st.kind === 'topic') lines.push(`## ${sourceTitle(sec.source)}`, '');
    if (sec.source.url) lines.push(`Source: ${sec.source.url}`, '');
    if (st.mode === 'full') {
      for (const m of sec.messages.filter((x) => !x.excluded)) {
        lines.push(`${hdr} ${roleLabel(sec.source, m)}`, '', htmlToMd(messageBody(sec, m).body), '');
      }
    } else {
      let lastCue = null;
      for (const hl of visibleHighlights(sec)) {
        if (hl._cue && hl._cue !== lastCue) lines.push('', `**${t('rd.question')}:** ${oneLine(hl._cue, 300)}`, '');
        lastCue = hl._cue;
        lines.push(`- **[${NM.label(hl.color)}]** ${hl.image ? `![](${hl.image.slice(0, 40)}…)` : hl.text.replace(/\n+/g, ' ')}`);
        if (hl.note) lines.push(`  - ${hl.note}`);
      }
      lines.push('');
    }
  }
  const md = `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  const a = h('a', {
    href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })),
    download: `${title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'thirdnote'}.md`,
  });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function htmlToMd(root) {
  const inline = (node) => [...node.childNodes].map(md).join('');
  const block = (s) => `\n\n${s.trim()}\n\n`;

  function md(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.localName.toLowerCase();
    switch (tag) {
      case 'p': case 'div': case 'figure': case 'details': case 'summary': case 'figcaption':
        return block(inline(node));
      case 'br': return '  \n';
      case 'hr': return '\n\n---\n\n';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return block(`${'#'.repeat(Math.min(6, Number(tag[1]) + 2))} ${inline(node).trim()}`);
      case 'strong': case 'b': { const x = inline(node); return x.trim() ? `**${x}**` : x; }
      case 'em': case 'i': { const x = inline(node); return x.trim() ? `*${x}*` : x; }
      case 'del': case 's': return `~~${inline(node)}~~`;
      case 'mark': { const x = inline(node); return x.trim() ? `==${x}==` : x; }
      case 'code': return `\`${node.textContent}\``;
      case 'pre': {
        const lang = node.querySelector('code[data-lang]')?.getAttribute('data-lang') || '';
        return `\n\n\`\`\`${lang}\n${node.textContent.replace(/\n$/, '')}\n\`\`\`\n\n`;
      }
      case 'a': return node.getAttribute('href') ? `[${inline(node)}](${node.getAttribute('href')})` : inline(node);
      case 'img': {
        const src = node.getAttribute('src') || '';
        return src.startsWith('data:') ? '' : `![${node.getAttribute('alt') || ''}](${src})`;
      }
      case 'blockquote': return block(md2(node).trim().split('\n').map((l) => `> ${l}`).join('\n'));
      case 'ul': case 'ol': return block(list(node, tag === 'ol'));
      case 'table': return block(table(node));
      case 'math': {
        const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
        const x = tex || node.textContent;
        return node.getAttribute('display') === 'block' ? block(`$$${x}$$`) : `$${x}$`;
      }
      default: return inline(node);
    }
  }

  function md2(node) {
    return [...node.childNodes].map(md).join('').replace(/\n{3,}/g, '\n\n');
  }

  function list(node, ordered) {
    const start = Number(node.getAttribute('start')) || 1;
    return [...node.children].filter((li) => li.localName === 'li').map((li, i) => {
      const marker = ordered ? `${start + i}. ` : '- ';
      const body = md2(li).trim().replace(/\n{2,}/g, '\n');
      return marker + body.split('\n').join(`\n${' '.repeat(marker.length)}`);
    }).join('\n');
  }

  function table(node) {
    const rows = [...node.querySelectorAll('tr')].map((tr) =>
      [...tr.children].map((c) => inline(c).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()));
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const fmt = (r) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
    return [fmt(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(fmt)].join('\n');
  }

  return md2(root)
    .replace(/==(\s*)==/g, '$1') // merge marks that touch (e.g. text + math)
    .replace(/[ \t]+\n/g, (m) => (m.startsWith('  ') ? '  \n' : '\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Live updates (a tracked chat getting new messages in another tab)

let dirtyTimer = null;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'nm-changed') return;
  if (st.kind === 'source' && msg.sourceId && msg.sourceId !== st.id) return;
  if (st.mode === 'review') return; // don't reshuffle a running session
  clearTimeout(dirtyTimer);
  const tryReload = () => {
    const busy = !pop.hidden || !tb.hidden || !getSelection().isCollapsed || document.activeElement?.isContentEditable;
    if (busy) dirtyTimer = setTimeout(tryReload, 1500);
    else reload();
  };
  dirtyTimer = setTimeout(tryReload, 400);
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) reload();
});

if (!st.id) {
  NM.getSettings().then((s) => NM.applyPage(s));
  mainEl.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, t('rd.nothing')), h('p', {}, t('rd.nothingText'))));
} else {
  load().then(render).catch((err) => {
    mainEl.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, t('rd.notFound')), h('p', {}, String(err.message || err))));
  });
}
