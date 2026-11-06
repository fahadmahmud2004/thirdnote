// Board: a free-form canvas for one collection. Every capture in the
// collection (screenshots, highlights, clips, notes, saved chats) is a card
// you can move and resize, next to sticky notes, text, headings and images
// you add yourself, joined by arrows. Saved per collection.

const { rpc, COLORS, icon, t } = NM;

const GAP = 28;
const COL_W = 300;
const MIN_Z = 0.15;
const MAX_Z = 3;
const uid = () => crypto.randomUUID();

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
const ic = (name, size = 16) => h('span', { html: icon(name, size) }).firstChild;
const clone = (items) => items.map((i) => ({ ...i }));

// Everything in the collection that can sit on the board, by reference key.
function captureMap(sections) {
  const out = new Map();
  for (const sec of sections) {
    const src = sec.source;
    if (src.kind === 'chat') out.set(`s:${src.id}`, { kind: 'chat', src, sec, ts: src.createdAt || 0 });
    const byKey = new Map(sec.messages.map((m) => [m.key, m]));
    for (const hl of sec.highlights) {
      const m = byKey.get(hl.messageKey);
      out.set(`h:${hl.id}`, { kind: hl.image ? 'shot' : 'hl', hl, m, src, sec, ts: hl.createdAt || 0 });
    }
    for (const m of sec.messages) {
      if (m.role === 'note') out.set(`n:${m.id}`, { kind: 'note', m, src, sec, ts: m.savedAt || 0 });
    }
  }
  return out;
}

export function mountBoard(ctx) {
  const { container, topic, badge, openReader, reloadData, toast } = ctx;
  let caps = captureMap(ctx.sections);
  let items = [];
  let view = { x: 0, y: 0, z: 1 };
  let next = null; // where the next new capture goes
  let sel = new Set();
  let editing = null; // { id, editor }
  let busy = false;
  let destroyed = false;
  const past = [];
  const future = [];
  const els = new Map();

  // ---- DOM ------------------------------------------------------------------

  const world = h('div', { class: 'bd-world' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'bd-links');
  svg.innerHTML = '<defs><marker id="bd-head" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>';
  world.append(svg);
  const viewport = h('div', { class: 'bd-viewport', tabindex: '0' }, world);
  const ctxBar = h('div', { class: 'bd-ctx', hidden: true });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const zoomLabel = h('button', { class: 'bd-zoom', title: t('bd.zoomReset'), onclick: () => zoomTo(1) }, '100%');
  const hiddenBtn = h('button', { class: 'bd-tool wide', hidden: true, onclick: unhideAll });
  const undoBtn = tool('undo', 'bd.undo', undo);
  const redoBtn = tool('redo', 'bd.redo', redo);
  const dock = h('div', { class: 'bd-dock' },
    tool('sticky', 'bd.sticky', () => addAtCenter('sticky'), 'N'),
    tool('type', 'bd.text', () => addAtCenter('text'), 'T'),
    tool('heading', 'bd.heading', () => addAtCenter('heading'), 'H'),
    tool('imagePlus', 'bd.image', () => fileInput.click()),
    h('span', { class: 'bd-sep' }),
    undoBtn, redoBtn,
    h('span', { class: 'bd-sep' }),
    tool('zoomOut', 'bd.zoomOut', () => zoomBy(1 / 1.2), '-'),
    zoomLabel,
    tool('zoomIn', 'bd.zoomIn', () => zoomBy(1.2), '+'),
    tool('fit', 'bd.fit', fit, '⇧1'),
    hiddenBtn);
  const hint = h('div', { class: 'bd-hint' }, ic('hand', 14), t('bd.hint'));
  const empty = h('div', { class: 'bd-empty', hidden: true },
    h('div', { class: 'bd-empty-ic' }, ic('board', 26)),
    h('h3', {}, t('bd.emptyTitle')),
    h('p', {}, t('bd.emptyText')),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => addAtCenter('sticky') }, ic('sticky', 15), t('bd.sticky')),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, ic('imagePlus', 15), t('bd.image'))));
  const root = h('div', { class: 'board' }, viewport, empty, ctxBar, dock, hint, fileInput);
  container.replaceChildren(root);

  function tool(name, key, run, kbd) {
    return h('button', { class: 'bd-tool', title: kbd ? `${t(key)}  (${kbd})` : t(key), 'aria-label': t(key), onclick: run }, ic(name, 17));
  }

  // ---- persistence ------------------------------------------------------------

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  async function flush() {
    clearTimeout(saveTimer);
    try {
      await rpc('saveBoard', { topicId: topic.id, items: items.map(strip), view: { ...view, next } });
    } catch (err) {
      toast(String(err.message || err));
    }
  }
  const strip = (i) => {
    const o = { ...i };
    delete o._new;
    return o;
  };

  function commit() {
    past.push(clone(items));
    if (past.length > 80) past.shift();
    future.length = 0;
    syncHistoryButtons();
  }
  function undo() {
    if (!past.length) return;
    finishEdit();
    future.push(clone(items));
    items = past.pop();
    sel = new Set([...sel].filter((id) => items.some((i) => i.id === id)));
    renderAll();
    save();
    syncHistoryButtons();
  }
  function redo() {
    if (!future.length) return;
    finishEdit();
    past.push(clone(items));
    items = future.pop();
    renderAll();
    save();
    syncHistoryButtons();
  }
  function syncHistoryButtons() {
    undoBtn.disabled = !past.length;
    redoBtn.disabled = !future.length;
  }

  // ---- view -------------------------------------------------------------------

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    const g = 22 * view.z;
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
    viewport.style.setProperty('--z', view.z);
    zoomLabel.textContent = `${Math.round(view.z * 100)}%`;
    placeCtx();
    clearTimeout(applyView.t);
    applyView.t = setTimeout(save, 600);
  }
  function toWorld(cx, cy) {
    const r = viewport.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
  }
  function center() {
    const r = viewport.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }
  function zoomAt(cx, cy, z) {
    z = Math.min(MAX_Z, Math.max(MIN_Z, z));
    const r = viewport.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    view.x = px - ((px - view.x) / view.z) * z;
    view.y = py - ((py - view.y) / view.z) * z;
    view.z = z;
    applyView();
  }
  function zoomBy(k) {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.z * k);
  }
  function zoomTo(z) {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, z);
  }
  function bounds(list = visible()) {
    let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
    for (const it of list) {
      if (it.t === 'arrow') continue;
      const s = size(it);
      x1 = Math.min(x1, it.x); y1 = Math.min(y1, it.y);
      x2 = Math.max(x2, it.x + s.w); y2 = Math.max(y2, it.y + s.h);
    }
    return x1 === Infinity ? null : { x1, y1, x2, y2 };
  }
  function fit() {
    const b = bounds();
    const r = viewport.getBoundingClientRect();
    if (!b) {
      view = { x: r.width / 2, y: r.height / 2, z: 1 };
      return applyView();
    }
    const pad = 80;
    const z = Math.min(1, Math.max(MIN_Z, Math.min((r.width - pad * 2) / (b.x2 - b.x1), (r.height - pad * 2 - 60) / (b.y2 - b.y1))));
    view.z = z;
    view.x = (r.width - (b.x2 - b.x1) * z) / 2 - b.x1 * z;
    view.y = (r.height - 60 - (b.y2 - b.y1) * z) / 2 - b.y1 * z;
    applyView();
  }

  // ---- items ------------------------------------------------------------------

  const visible = () => items.filter((i) => !i.hidden && (i.t !== 'cap' || caps.has(i.ref)));
  const byId = (id) => items.find((i) => i.id === id);
  function size(it) {
    const el = els.get(it.id);
    return { w: el ? el.offsetWidth : it.w || COL_W, h: el ? el.offsetHeight : it.h || 120 };
  }

  function contentKey(it) {
    if (it.t === 'cap') {
      const c = caps.get(it.ref);
      if (!c) return 'gone';
      if (c.kind === 'chat') return `chat|${c.src.title}|${c.sec.messages.length}|${c.sec.highlights.length}`;
      if (c.kind === 'note') return `note|${c.m.updatedAt}`;
      return `hl|${c.hl.color}|${c.hl.note}|${c.m?.updatedAt || ''}|${c.src.title}`;
    }
    if (it.t === 'img') return `img|${it.src.length}|${it.src.slice(-40)}|${it.caption || ''}`;
    return `${it.t}|${it.c || ''}|${it.size || ''}|${it.html || ''}`;
  }

  function buildBody(it) {
    if (it.t === 'sticky') {
      return h('div', { class: 'bi-text rich', html: NMSanitize.cleanHtml(it.html || '') });
    }
    if (it.t === 'text') {
      return h('div', { class: `bi-text rich${it.size === 'h' ? ' big' : ''}`, html: NMSanitize.cleanHtml(it.html || '') });
    }
    if (it.t === 'img') {
      return h('div', {}, h('img', { src: it.src, alt: '', draggable: 'false' }));
    }
    const c = caps.get(it.ref);
    if (!c) return h('div');
    const srcLine = () => h('div', { class: 'bi-src' },
      c.src.kind === 'note' ? ic('notepad', 13) : badge(c.src),
      h('span', {}, c.src.kind === 'note' ? t('sp.myNotes') : NM.siteName(c.src)),
      h('span', { class: 'faint' }, NM.timeAgo(c.ts)));
    if (c.kind === 'shot') {
      return h('div', {},
        h('img', { src: c.hl.image, alt: '', draggable: 'false' }),
        c.hl.note ? h('div', { class: 'bi-ann' }, c.hl.note) : null,
        srcLine());
    }
    if (c.kind === 'hl') {
      const body = h('div', { class: 'bi-quote' });
      if (c.m?.role === 'clip') body.innerHTML = NMSanitize.cleanHtml(c.m.html);
      else body.textContent = c.hl.text;
      return h('div', {}, body, c.hl.note ? h('div', { class: 'bi-ann' }, ic('pencil', 12), c.hl.note) : null, srcLine());
    }
    if (c.kind === 'note') {
      return h('div', {}, h('div', { class: 'bi-text rich', html: NMSanitize.cleanHtml(c.m.html) }), srcLine());
    }
    // A whole saved chat.
    const qs = c.sec.messages.filter((m) => m.role === 'user').length;
    return h('div', { class: 'bi-chat-in' },
      h('div', { class: 'bi-chat-top' }, badge(c.src), h('span', { class: 'faint' }, NM.siteName(c.src))),
      h('div', { class: 'bi-chat-title' }, c.src.title),
      h('div', { class: 'bi-chat-meta' },
        NM.count(c.sec.messages.length, 'sp.msgs', 'sp.msg1'), ' · ', NM.count(c.sec.highlights.length, 'sp.hls', 'sp.hl1'),
        qs ? ` · ${NM.count(qs, 'bd.questions', 'bd.question1')}` : ''));
  }

  function classFor(it) {
    const c = it.t === 'cap' ? caps.get(it.ref) : null;
    const kind = c ? `bi-cap bi-${c.kind}` : `bi-${it.t}`;
    const color = it.t === 'sticky' ? ` c-${it.c || 'yellow'}` : c && (c.kind === 'hl' || c.kind === 'shot') ? ` bar-${c.hl.color}` : '';
    return `bi ${kind}${color}${sel.has(it.id) ? ' sel' : ''}${editing?.id === it.id ? ' editing' : ''}`;
  }

  function renderItem(it) {
    let el = els.get(it.id);
    if (!el) {
      el = h('div', { 'data-id': it.id },
        h('div', { class: 'bi-body' }),
        h('span', { class: 'bi-resize', title: t('bd.resize') }),
        h('span', { class: 'bi-link', title: t('bd.link') }, ic('connect', 12)));
      els.set(it.id, el);
      world.append(el);
    }
    el.className = classFor(it);
    const key = contentKey(it);
    if (el._key !== key && editing?.id !== it.id) {
      el._key = key;
      el.querySelector('.bi-body').replaceChildren(buildBody(it));
    }
    el.style.transform = `translate(${it.x}px, ${it.y}px)`;
    el.style.width = `${it.w || COL_W}px`;
    el.style.minHeight = it.t === 'sticky' && it.h ? `${it.h}px` : '';
    el.style.zIndex = String(items.indexOf(it) + 1);
  }

  function renderAll() {
    const shown = visible();
    const keep = new Set(shown.map((i) => i.id));
    for (const [id, el] of els) {
      if (!keep.has(id) || byId(id)?.t === 'arrow') {
        el.remove();
        els.delete(id);
      }
    }
    for (const it of shown) if (it.t !== 'arrow') renderItem(it);
    drawLinks();
    empty.hidden = shown.some((i) => i.t !== 'arrow');
    const nHidden = items.filter((i) => i.t === 'cap' && i.hidden && caps.has(i.ref)).length;
    hiddenBtn.hidden = !nHidden;
    hiddenBtn.replaceChildren(ic('eye', 15), t('bd.hidden', { n: nHidden }));
    renderCtx();
  }

  // ---- arrows -----------------------------------------------------------------

  function edgePoint(it, toward) {
    const s = size(it);
    const cx = it.x + s.w / 2;
    const cy = it.y + s.h / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const k = Math.min(Math.abs((s.w / 2 + 6) / (dx || 1e-9)), Math.abs((s.h / 2 + 6) / (dy || 1e-9)));
    return { x: cx + dx * k, y: cy + dy * k };
  }
  const centerOf = (it) => {
    const s = size(it);
    return { x: it.x + s.w / 2, y: it.y + s.h / 2 };
  };
  function drawLinks(temp) {
    svg.querySelectorAll('g').forEach((g) => g.remove());
    const shown = new Map(visible().map((i) => [i.id, i]));
    const add = (id, a, b, cls) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', cls);
      if (id) g.dataset.id = id;
      const d = `M${a.x} ${a.y}L${b.x} ${b.y}`;
      g.innerHTML = `<path class="hit" d="${d}"/><path class="ln" d="${d}" marker-end="url(#bd-head)"/>`;
      svg.append(g);
    };
    for (const it of items) {
      if (it.t !== 'arrow') continue;
      const a = shown.get(it.from);
      const b = shown.get(it.to);
      if (!a || !b) continue;
      add(it.id, edgePoint(a, centerOf(b)), edgePoint(b, centerOf(a)), `bd-arrow${sel.has(it.id) ? ' sel' : ''}`);
    }
    if (temp) add(null, edgePoint(temp.from, temp.to), temp.to, 'bd-arrow temp');
  }

  // ---- placing new captures ---------------------------------------------------

  let placing = false;
  async function placeNew() {
    if (placing) return false;
    const fresh = [...caps.entries()]
      .filter(([ref]) => !items.some((i) => i.t === 'cap' && i.ref === ref))
      .sort((a, b) => a[1].ts - b[1].ts);
    if (!fresh.length) return false;
    const firstTime = !items.length;
    const added = fresh.map(([ref, c]) => ({ id: uid(), t: 'cap', ref, x: 0, y: 0, w: c.kind === 'shot' ? 360 : c.kind === 'chat' ? 280 : COL_W, _new: true }));
    placing = true;
    items.push(...added);
    renderAll();
    // Measure only once the screenshots have loaded.
    await Promise.all(added.map((it) => {
      const img = els.get(it.id)?.querySelector('img');
      return img && !img.complete ? img.decode().catch(() => {}) : null;
    }));
    placing = false;
    if (firstTime) {
      const cols = Math.max(2, Math.min(5, Math.ceil(Math.sqrt(added.length * 1.3))));
      const tops = new Array(cols).fill(0);
      const colX = [];
      let x = 0;
      for (let i = 0; i < cols; i++) {
        colX.push(x);
        x += 360 + GAP * 1.5;
      }
      for (const it of added) {
        const col = tops.indexOf(Math.min(...tops));
        it.x = colX[col];
        it.y = tops[col];
        tops[col] += size(it).h + GAP;
      }
    } else {
      const b = bounds(visible().filter((i) => !i._new));
      for (const it of added) {
        if (!next || !b || next.y - b.y1 > 2400) next = { x: (b ? b.x2 : 0) + 60, y: b ? b.y1 : 0 };
        it.x = next.x;
        it.y = next.y;
        next.y += size(it).h + GAP;
      }
    }
    added.forEach((i) => delete i._new);
    renderAll();
    return true;
  }

  // ---- adding things ------------------------------------------------------------

  function addItem(it, { edit = false } = {}) {
    commit();
    items.push(it);
    sel = new Set([it.id]);
    renderAll();
    save();
    if (edit) startEdit(it.id);
    return it;
  }

  function addAt(kind, p, extra = {}) {
    const base = { id: uid(), x: Math.round(p.x), y: Math.round(p.y) };
    if (kind === 'sticky') return addItem({ ...base, t: 'sticky', c: extra.c || 'yellow', w: 240, h: 200, html: extra.html || '' }, { edit: !extra.html });
    if (kind === 'text') return addItem({ ...base, t: 'text', w: 320, html: extra.html || '' }, { edit: !extra.html });
    if (kind === 'heading') return addItem({ ...base, t: 'text', size: 'h', w: 520, html: extra.html || '' }, { edit: !extra.html });
    return null;
  }

  function addAtCenter(kind) {
    const c = center();
    const w = kind === 'heading' ? 520 : kind === 'text' ? 320 : 240;
    // Nudge so repeated adds don't stack exactly.
    const n = items.filter((i) => Math.abs(i.x - (c.x - w / 2)) < 30).length;
    addAt(kind, { x: c.x - w / 2 + n * 24, y: c.y - 100 + n * 24 });
  }

  async function addImages(files, p) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    commit();
    let x = p.x;
    for (const f of list) {
      const img = await NMEditor.fileToImage(f);
      const w = Math.min(480, img.w || 400);
      items.push({ id: uid(), t: 'img', src: img.src, x: Math.round(x), y: Math.round(p.y), w });
      x += w + GAP;
    }
    sel = new Set(items.slice(-list.length).map((i) => i.id));
    renderAll();
    save();
  }

  function textToSticky(text, p) {
    const s = text.trim();
    if (!s) return;
    const html = /^https?:\/\/\S+$/.test(s)
      ? `<p><a href="${NM.escapeHtml(s)}">${NM.escapeHtml(s)}</a></p>`
      : NM.textToHtml(s);
    addAt('sticky', p, { html });
  }

  // ---- editing text --------------------------------------------------------------

  function startEdit(id) {
    const it = byId(id);
    if (!it) return;
    const c = it.t === 'cap' ? caps.get(it.ref) : null;
    if (!(it.t === 'sticky' || it.t === 'text' || c?.kind === 'note')) return;
    finishEdit();
    const el = els.get(id);
    const target = el.querySelector('.bi-text');
    if (!target) return;
    const editor = NMEditor.make(target, {
      placeholder: t(it.t === 'text' && it.size === 'h' ? 'bd.headingPh' : it.t === 'text' ? 'bd.textPh' : 'bd.stickyPh'),
    });
    editing = { id, editor, before: target.innerHTML };
    sel = new Set([id]);
    el.className = classFor(it);
    editor.focus();
    renderCtx();
  }

  async function finishEdit() {
    if (!editing) return;
    const { id, editor, before } = editing;
    editing = null;
    const it = byId(id);
    const changed = editor.el.innerHTML !== before;
    const html = editor.html();
    const isEmpty = editor.isEmpty();
    editor.destroy();
    NMEditor.hideBar();
    if (!it) return;
    if (it.t === 'cap') {
      const c = caps.get(it.ref);
      if (changed && !isEmpty) {
        await rpc('updateMessage', { id: c.m.id, html, text: NMEditor.textOf(editor.el) });
        toast(t('toast.saved'));
        reloadData();
      }
      els.get(id)._key = null;
      renderAll();
      return;
    }
    if (isEmpty) {
      items = items.filter((i) => i.id !== id && i.from !== id && i.to !== id);
      sel.delete(id);
    } else if (changed) {
      commit();
      it.html = html;
    }
    const el = els.get(id);
    if (el) el._key = null;
    renderAll();
    save();
  }

  // ---- context bar for the selection -------------------------------------------

  function colorDot(c, on, pick) {
    return h('button', { class: `bd-dot${on ? ' on' : ''}`, style: `--c:${c.swatch}`, title: NM.label(c.id), onclick: pick });
  }
  function ctxBtn(name, key, run, cls = '') {
    return h('button', { class: `bd-cbtn ${cls}`, title: t(key), onclick: run }, ic(name, 15));
  }

  function renderCtx() {
    const list = [...sel].map(byId).filter(Boolean);
    if (!list.length || busy || editing) {
      ctxBar.hidden = true;
      return;
    }
    const parts = [];
    if (list.length === 1) {
      const it = list[0];
      const c = it.t === 'cap' ? caps.get(it.ref) : null;
      if (it.t === 'sticky') {
        parts.push(...COLORS.map((col) => colorDot(col, (it.c || 'yellow') === col.id, () => {
          commit();
          it.c = col.id;
          renderAll();
          save();
        })), h('span', { class: 'bd-sep' }));
      }
      if (c && (c.kind === 'hl' || c.kind === 'shot')) {
        parts.push(...COLORS.map((col) => colorDot(col, c.hl.color === col.id, async () => {
          await rpc('updateHighlight', { id: c.hl.id, color: col.id, note: c.hl.note });
          reloadData();
        })), h('span', { class: 'bd-sep' }));
      }
      if (it.t === 'text') {
        parts.push(ctxBtn(it.size === 'h' ? 'type' : 'heading', it.size === 'h' ? 'bd.toText' : 'bd.toHeading', () => {
          commit();
          it.size = it.size === 'h' ? '' : 'h';
          renderAll();
          save();
        }));
      }
      if (it.t === 'sticky' || it.t === 'text' || c?.kind === 'note') {
        parts.push(ctxBtn('pencil', 'common.edit', () => startEdit(it.id)));
      }
      if (c) {
        const params = c.kind === 'chat' ? { source: c.src.id } : c.hl ? { source: c.src.id, hl: c.hl.id } : { source: c.src.id };
        parts.push(ctxBtn('external', 'bd.openReader', () => openReader(params)));
      }
    }
    if (list.some((i) => i.t !== 'cap' && i.t !== 'arrow')) parts.push(ctxBtn('copy', 'bd.duplicate', duplicate));
    const onlyCaps = list.every((i) => i.t === 'cap');
    parts.push(ctxBtn(onlyCaps ? 'eyeOff' : 'trash', onlyCaps ? 'bd.removeFromBoard' : 'common.delete', removeSelected, onlyCaps ? '' : 'danger'));
    ctxBar.replaceChildren(...parts);
    ctxBar.hidden = false;
    placeCtx();
  }

  function placeCtx() {
    if (ctxBar.hidden) return;
    const list = [...sel].map(byId).filter((i) => i && i.t !== 'arrow');
    const arrow = [...sel].map(byId).find((i) => i?.t === 'arrow');
    const r = viewport.getBoundingClientRect();
    let x; let y;
    if (list.length) {
      const b = bounds(list);
      x = r.left + view.x + ((b.x1 + b.x2) / 2) * view.z;
      y = r.top + view.y + b.y1 * view.z;
    } else if (arrow) {
      const a = byId(arrow.from);
      const b = byId(arrow.to);
      if (!a || !b) return;
      const ca = centerOf(a);
      const cb = centerOf(b);
      x = r.left + view.x + ((ca.x + cb.x) / 2) * view.z;
      y = r.top + view.y + ((ca.y + cb.y) / 2) * view.z - 10;
    } else return;
    const w = ctxBar.offsetWidth;
    const ht = ctxBar.offsetHeight;
    let top = y - ht - 12;
    if (top < r.top + 8) top = r.top + 8;
    ctxBar.style.left = `${Math.min(Math.max(r.left + 8, x - w / 2), r.right - w - 8)}px`;
    ctxBar.style.top = `${top}px`;
  }

  function select(ids) {
    sel = new Set(ids);
    renderAll();
  }

  function duplicate() {
    const list = [...sel].map(byId).filter((i) => i && i.t !== 'cap' && i.t !== 'arrow');
    if (!list.length) return;
    commit();
    const copies = list.map((i) => ({ ...i, id: uid(), x: i.x + 28, y: i.y + 28 }));
    items.push(...copies);
    select(copies.map((c) => c.id));
    save();
  }

  function removeSelected() {
    const list = [...sel].map(byId).filter(Boolean);
    if (!list.length) return;
    commit();
    const gone = new Set();
    for (const it of list) {
      if (it.t === 'cap') it.hidden = true;
      else gone.add(it.id);
    }
    items = items.filter((i) => !gone.has(i.id) && !(i.t === 'arrow' && (gone.has(i.from) || gone.has(i.to))));
    const hid = list.filter((i) => i.t === 'cap').length;
    sel.clear();
    renderAll();
    renderCtx();
    save();
    if (hid) toast(t('bd.removed'));
  }

  function unhideAll() {
    const back = items.filter((i) => i.t === 'cap' && i.hidden);
    if (!back.length) return;
    commit();
    const c = center();
    back.forEach((it, n) => {
      it.hidden = false;
      it.x = Math.round(c.x - 150 + n * 30);
      it.y = Math.round(c.y - 120 + n * 30);
    });
    select(back.map((i) => i.id));
    save();
  }

  // ---- pointer: pan, select, move, resize, link -----------------------------------

  let gesture = null;
  const spaceDown = { on: false };

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const card = e.target.closest('.bi');
    const arrow = e.target.closest('.bd-arrow:not(.temp)');
    const insideEdit = editing && card && card.dataset.id === editing.id && !e.target.closest('.bi-resize, .bi-link');
    if (insideEdit) return;
    if (editing) finishEdit();
    viewport.focus({ preventScroll: true });

    if (!card && !arrow || spaceDown.on || e.button === 1) {
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      viewport.classList.add('panning');
    } else if (arrow) {
      select(e.shiftKey ? [...sel, arrow.dataset.id] : [arrow.dataset.id]);
      return;
    } else {
      const id = card.dataset.id;
      const it = byId(id);
      if (e.target.closest('a')) return;
      if (e.target.closest('.bi-link')) {
        gesture = { kind: 'link', from: it, sx: e.clientX, sy: e.clientY };
      } else if (e.target.closest('.bi-resize')) {
        commit();
        gesture = { kind: 'resize', it, sx: e.clientX, sy: e.clientY, w: size(it).w, h: size(it).h };
      } else {
        if (e.shiftKey) {
          const next2 = new Set(sel);
          if (next2.has(id)) next2.delete(id);
          else next2.add(id);
          sel = next2;
        } else if (!sel.has(id)) sel = new Set([id]);
        // Bring to the front.
        const moving = items.filter((i) => sel.has(i.id) && i.t !== 'arrow');
        items = [...items.filter((i) => !sel.has(i.id) || i.t === 'arrow'), ...moving];
        gesture = { kind: 'move', sx: e.clientX, sy: e.clientY, start: moving.map((i) => ({ it: i, x: i.x, y: i.y })), snap: clone(items), moved: false };
        renderAll();
      }
    }
    busy = true;
    ctxBar.hidden = true;
    viewport.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const dx = e.clientX - gesture.sx;
    const dy = e.clientY - gesture.sy;
    if (gesture.kind === 'pan') {
      if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
      view.x = gesture.vx + dx;
      view.y = gesture.vy + dy;
      applyView();
    } else if (gesture.kind === 'move') {
      if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      gesture.moved = true;
      for (const s of gesture.start) {
        s.it.x = Math.round(s.x + dx / view.z);
        s.it.y = Math.round(s.y + dy / view.z);
        renderItem(s.it);
      }
      drawLinks();
    } else if (gesture.kind === 'resize') {
      const it = gesture.it;
      it.w = Math.round(Math.max(140, gesture.w + dx / view.z));
      if (it.t === 'sticky') it.h = Math.round(Math.max(100, gesture.h + dy / view.z));
      renderItem(it);
      drawLinks();
    } else if (gesture.kind === 'link') {
      drawLinks({ from: gesture.from, to: toWorld(e.clientX, e.clientY) });
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bi');
      world.querySelectorAll('.bi.drop').forEach((x) => x.classList.remove('drop'));
      if (over && over.dataset.id !== gesture.from.id) over.classList.add('drop');
    }
  });

  const endGesture = (e) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    busy = false;
    viewport.classList.remove('panning');
    if (g.kind === 'pan' && !g.moved) {
      sel.clear();
      renderAll();
    }
    if (g.kind === 'move' && g.moved) {
      past.push(g.snap);
      future.length = 0;
      syncHistoryButtons();
      save();
    }
    if (g.kind === 'resize') save();
    if (g.kind === 'link') {
      world.querySelectorAll('.bi.drop').forEach((x) => x.classList.remove('drop'));
      const over = e && document.elementFromPoint(e.clientX, e.clientY)?.closest('.bi');
      const to = over?.dataset.id;
      if (to && to !== g.from.id && !items.some((i) => i.t === 'arrow' && i.from === g.from.id && i.to === to)) {
        addItem({ id: uid(), t: 'arrow', from: g.from.id, to });
      } else drawLinks();
    }
    renderCtx();
  };
  viewport.addEventListener('pointerup', endGesture);
  viewport.addEventListener('pointercancel', endGesture);

  viewport.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.bi');
    if (card) {
      const it = byId(card.dataset.id);
      const c = it?.t === 'cap' ? caps.get(it.ref) : null;
      if (c && c.kind !== 'note') {
        openReader(c.kind === 'chat' ? { source: c.src.id } : { source: c.src.id, hl: c.hl?.id });
        return;
      }
      if (editing?.id !== it.id) startEdit(it.id);
      return;
    }
    if (e.target.closest('.bd-arrow')) return;
    const p = toWorld(e.clientX, e.clientY);
    addAt('sticky', { x: p.x - 120, y: p.y - 40 });
  });

  viewport.addEventListener('wheel', (e) => {
    if (editing && e.target.closest('.bi.editing')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, view.z * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0035) * (e.ctrlKey && !e.metaKey ? 2.2 : 1)));
    } else {
      view.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      view.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      applyView();
    }
  }, { passive: false });

  // ---- drop and paste ---------------------------------------------------------------

  viewport.addEventListener('dragover', (e) => {
    e.preventDefault();
    viewport.classList.add('dropping');
  });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('dropping'));
  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    viewport.classList.remove('dropping');
    const p = toWorld(e.clientX, e.clientY);
    const files = e.dataTransfer.files;
    if (files.length) return addImages(files, p);
    const html = e.dataTransfer.getData('text/html');
    const imgSrc = html && /<img[^>]+src="(data:image\/[^"]+|https?:[^"]+)"/i.exec(html)?.[1];
    if (imgSrc && imgSrc.startsWith('data:')) {
      commit();
      items.push({ id: uid(), t: 'img', src: imgSrc, x: Math.round(p.x), y: Math.round(p.y), w: 400 });
      renderAll();
      return save();
    }
    textToSticky(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'), p);
  });

  function onPaste(e) {
    if (destroyed || editing || e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const c = center();
    if (dt.files.length) {
      e.preventDefault();
      addImages(dt.files, { x: c.x - 200, y: c.y - 150 });
      return;
    }
    const text = dt.getData('text/plain');
    if (text) {
      e.preventDefault();
      textToSticky(text, { x: c.x - 120, y: c.y - 80 });
    }
  }
  document.addEventListener('paste', onPaste);

  fileInput.addEventListener('change', () => {
    const c = center();
    addImages(fileInput.files, { x: c.x - 200, y: c.y - 150 });
    fileInput.value = '';
  });

  // ---- keyboard --------------------------------------------------------------------

  function onKey(e) {
    if (destroyed) return;
    if (e.key === ' ' && !editing && !e.target.closest?.('input, textarea, [contenteditable="true"]')) {
      spaceDown.on = e.type === 'keydown';
      viewport.classList.toggle('grab', spaceDown.on);
      if (e.type === 'keydown') e.preventDefault();
      return;
    }
    if (e.type !== 'keydown') return;
    if (editing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        finishEdit();
      }
      return;
    }
    if (e.target.closest?.('input, textarea, [contenteditable="true"], .menu')) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && k === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && k === 'd') {
      e.preventDefault();
      duplicate();
    } else if (mod && k === 'a') {
      e.preventDefault();
      select(visible().filter((i) => i.t !== 'arrow').map((i) => i.id));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (sel.size) {
        e.preventDefault();
        removeSelected();
      }
    } else if (e.key === 'Escape') {
      select([]);
    } else if (e.key === 'Enter' && sel.size === 1) {
      e.preventDefault();
      startEdit([...sel][0]);
    } else if (e.key.startsWith('Arrow') && sel.size) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 2;
      const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!e.repeat) commit();
      for (const it of [...sel].map(byId)) {
        if (!it || it.t === 'arrow') continue;
        it.x += dx;
        it.y += dy;
      }
      renderAll();
      save();
    } else if (mod) {
      // leave browser shortcuts alone
    } else if (e.key === '+' || e.key === '=') zoomBy(1.2);
    else if (e.key === '-') zoomBy(1 / 1.2);
    else if (e.key === '0') zoomTo(1);
    else if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) fit();
    else if (k === 'n') {
      e.preventDefault();
      addAtCenter('sticky');
    } else if (k === 't') {
      e.preventDefault();
      addAtCenter('text');
    } else if (k === 'h') {
      e.preventDefault();
      addAtCenter('heading');
    }
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);

  // Finish editing when focus leaves the card (but not for the format bar).
  viewport.addEventListener('focusout', (e) => {
    if (!editing) return;
    const card = els.get(editing.id);
    if (e.relatedTarget && (card?.contains(e.relatedTarget) || e.relatedTarget.closest?.('.nm-fmt'))) return;
    setTimeout(() => {
      if (editing && !card?.contains(document.activeElement)) finishEdit();
    }, 0);
  });

  const onResize = () => placeCtx();
  addEventListener('resize', onResize);

  // ---- start --------------------------------------------------------------------------

  (async () => {
    const saved = await rpc('getBoard', { topicId: topic.id });
    if (destroyed) return;
    items = Array.isArray(saved.items) ? saved.items : [];
    next = saved.view?.next || null;
    renderAll();
    const placed = await placeNew();
    if (saved.view && Number.isFinite(saved.view.z)) {
      view = { x: saved.view.x, y: saved.view.y, z: saved.view.z };
      applyView();
    } else fit();
    if (placed) save();
    syncHistoryButtons();
    viewport.focus({ preventScroll: true });
    setTimeout(() => hint.classList.add('fade'), 6000);
  })().catch((err) => toast(String(err.message || err)));

  return {
    isBusy: () => busy || !!editing,
    // New data from the library: refresh cards and place new captures.
    update(sections) {
      caps = captureMap(sections);
      renderAll();
      placeNew().then((placed) => placed && save());
    },
    destroy() {
      if (editing) finishEdit();
      flush();
      destroyed = true;
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKey);
      removeEventListener('resize', onResize);
      NMEditor.hideBar();
    },
  };
}
