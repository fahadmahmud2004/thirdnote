// A small rich-text editor shared by notes, message edits and the board.
// NMEditor.make(el) turns an element into an editor; one floating format bar
// follows the selection in whichever editor has focus.
// Needs shared.js (icons) and sanitize.js (cleaning) loaded first.
(function () {
  const { icon, t, COLORS } = globalThis.NM;
  const MAX_IMAGE = 1600;

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

  const activeRoot = () => {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const n = sel.anchorNode;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const root = el?.closest('[data-rich]');
    return root && root.isContentEditable ? root : null;
  };

  function exec(cmd, value = null) {
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(cmd, false, value);
  }

  function blockOf(root) {
    const n = getSelection().anchorNode;
    let el = n && (n.nodeType === 1 ? n : n.parentElement);
    while (el && el !== root && !/^(P|DIV|LI|H1|H2|H3|H4|BLOCKQUOTE|PRE)$/.test(el.tagName)) el = el.parentElement;
    return el || root;
  }

  function currentBlockTag(root) {
    const b = blockOf(root);
    return b === root ? 'P' : b.tagName;
  }

  function toggleBlock(tag) {
    const root = activeRoot();
    if (!root) return;
    exec('formatBlock', currentBlockTag(root) === tag ? 'P' : tag);
  }

  function markAt() {
    const n = getSelection().anchorNode;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return el?.closest('mark');
  }

  // Wrap the selection in <mark data-c="...">. Chrome's hiliteColor makes
  // styled spans; we turn exactly those into marks.
  function highlight(color) {
    const root = activeRoot();
    if (!root) return;
    const existing = markAt();
    if (existing && root.contains(existing)) {
      if (existing.dataset.c === color || !color) existing.replaceWith(...existing.childNodes);
      else existing.dataset.c = color;
      root.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (getSelection().isCollapsed) return;
    const probe = 'rgb(1, 2, 3)';
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, probe);
    document.execCommand('styleWithCSS', false, false);
    root.querySelectorAll('span[style]').forEach((s) => {
      if (s.style.backgroundColor !== probe) return;
      const m = document.createElement('mark');
      m.dataset.c = color;
      m.append(...s.childNodes);
      s.replaceWith(m);
    });
    root.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function addLink() {
    const root = activeRoot();
    if (!root) return;
    const n = getSelection().anchorNode;
    const a = (n && (n.nodeType === 1 ? n : n.parentElement))?.closest('a');
    if (a) {
      a.replaceWith(...a.childNodes);
      return;
    }
    const url = prompt(t('ed.linkPrompt'), 'https://');
    if (!url || !/^(https?:|mailto:)/i.test(url.trim())) return;
    if (getSelection().isCollapsed) exec('insertHTML', `<a href="${NM.escapeHtml(url.trim())}">${NM.escapeHtml(url.trim())}</a>`);
    else exec('createLink', url.trim());
  }

  // ---- images ---------------------------------------------------------------

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  // Large photos are scaled down so the library stays small.
  async function shrinkImage(dataUrl, max = MAX_IMAGE) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode().catch(() => {});
    const { naturalWidth: w, naturalHeight: ht } = img;
    if (!w || (w <= max && ht <= max && dataUrl.length < 1.5e6)) return { src: dataUrl, w, h: ht };
    const k = Math.min(1, max / Math.max(w, ht));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(ht * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const png = /^data:image\/(png|gif|webp)/.test(dataUrl);
    return { src: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88), w: c.width, h: c.height };
  }

  async function fileToImage(file) {
    return shrinkImage(await readImage(file));
  }

  // Insert images from a file picker where the cursor is. Several at once
  // share one row; resize each by dragging its corner.
  let picker = null;
  function pickImages() {
    const root = activeRoot();
    if (!root) return;
    const sel = getSelection();
    const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    if (!picker) {
      picker = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
      document.body.append(picker);
    }
    picker.onchange = async () => {
      const files = [...picker.files];
      picker.value = '';
      if (!files.length) return;
      const w = files.length > 1 ? Math.max(18, Math.floor(100 / Math.min(files.length, 5)) - 2) : 48;
      const imgs = [];
      for (const f of files) imgs.push(`<img src="${(await fileToImage(f)).src}" data-w="${w}" alt="">`);
      root.focus();
      if (saved && root.contains(saved.startContainer)) {
        const s2 = getSelection();
        s2.removeAllRanges();
        s2.addRange(saved);
      }
      exec('insertHTML', imgs.join(''));
      NMSanitize.sizeImages(root);
    };
    picker.click();
  }

  // Click an image while editing: quick sizes, a corner handle to drag to
  // any width, or remove it. Narrow images sit side by side.
  let imgBar = null;
  let handle = null;
  let imgTarget = null;
  const PRESETS = [[24, '¼'], [32, '⅓'], [49, '½'], [100, 'ed.full']];
  const setWidth = (img, w) => {
    w = Math.round(Math.min(100, Math.max(10, w)));
    if (w >= 99) delete img.dataset.w;
    else img.dataset.w = String(w);
    NMSanitize.sizeImages(img.closest('[data-rich]') || img.parentElement);
  };
  function placeImageUi() {
    if (!imgTarget) return;
    const r = imgTarget.getBoundingClientRect();
    imgBar.style.left = `${Math.max(8, Math.min(r.left + 8, innerWidth - imgBar.offsetWidth - 8))}px`;
    imgBar.style.top = `${Math.max(8, r.top + 8)}px`;
    handle.style.left = `${r.right - 9}px`;
    handle.style.top = `${r.bottom - 9}px`;
  }
  function showImageBar(img) {
    if (!imgBar) {
      imgBar = h('div', { class: 'nm-fmt nm-imgbar', hidden: true });
      imgBar.addEventListener('mousedown', (e) => e.preventDefault());
      handle = h('div', { class: 'nm-img-handle', hidden: true, title: t('ed.dragSize') });
      // Keep focus (and the cursor) in the text while using the handle.
      handle.addEventListener('mousedown', (e) => e.preventDefault());
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const root = imgTarget.closest('[data-rich]');
        const box = (imgTarget.closest('figure') || imgTarget).getBoundingClientRect();
        const full = root.getBoundingClientRect().width - 2;
        handle.setPointerCapture(e.pointerId);
        const move = (ev) => {
          setWidth(imgTarget, ((ev.clientX - box.left) / full) * 100);
          placeImageUi();
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          root.dispatchEvent(new Event('input', { bubbles: true }));
          showImageBar(imgTarget);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up, { once: true });
      });
      document.body.append(imgBar, handle);
    }
    document.querySelectorAll('.nm-img-sel').forEach((x) => x.classList.remove('nm-img-sel'));
    imgTarget = img;
    img.classList.add('nm-img-sel');
    const cur = Number(img.dataset.w || 100);
    imgBar.replaceChildren(h('div', { class: 'nm-fmt-row' },
      h('span', { class: 'nm-fmt-hint' }, t('ed.resizeHint')),
      h('span', { class: 'nm-fmt-pct' }, `${Math.round(cur)}%`),
      h('span', { class: 'nm-fmt-sep' }),
      h('button', {
        type: 'button', class: 'nm-fmt-btn', title: t('ed.removeImage'), html: icon('trash', 15),
        onclick: () => {
          const root = imgTarget.closest('[data-rich]');
          const fig = imgTarget.closest('figure');
          (fig && fig.querySelectorAll('img').length === 1 ? fig : imgTarget).remove();
          hideImageBar();
          root?.dispatchEvent(new Event('input', { bubbles: true }));
        },
      })));
    imgBar.hidden = false;
    handle.hidden = false;
    placeImageUi();
  }
  function hideImageBar() {
    if (imgBar) imgBar.hidden = true;
    if (handle) handle.hidden = true;
    document.querySelectorAll('.nm-img-sel').forEach((x) => x.classList.remove('nm-img-sel'));
    imgTarget = null;
  }
  // ---- drag images to arrange them -------------------------------------
  // Drop an image beside another and they share a row (shrinking to fit);
  // drop it between words or lines to move it there. Works across entries.
  const unitOf = (img) => {
    const fig = img.parentElement?.tagName === 'FIGURE' && img.parentElement.querySelectorAll('img').length === 1 ? img.parentElement : null;
    return fig || img;
  };
  const imgOf = (unit) => (unit.tagName === 'IMG' ? unit : unit.querySelector('img'));
  const widthOf = (unit) => Number(imgOf(unit)?.dataset.w) || 100;
  let drag = null;
  let marker = null;
  let dragEnded = 0;

  function unitsIn(root) {
    return [...root.querySelectorAll('img')].map(unitOf).filter((u, i, all) => all.indexOf(u) === i);
  }

  // Where a dragged image would land. Anything on the same line as another
  // image (including the empty space beside it) means "next to that image".
  function dropTarget(x, y, dragged) {
    const el = document.elementFromPoint(x, y);
    const root = el?.closest('[data-rich]');
    if (!root || !root.isContentEditable) return null;
    const units = unitsIn(root).filter((u) => u !== dragged && !dragged.contains(u));
    const row = units.map((u) => ({ u, r: u.getBoundingClientRect() })).filter(({ r }) => y >= r.top - 8 && y <= r.bottom + 8);
    if (row.length) {
      row.sort((p, q) => p.r.left - q.r.left);
      const inside = row.find(({ r }) => x >= r.left && x <= r.right);
      if (inside) return { root, unit: inside.u, side: x < inside.r.left + inside.r.width / 2 ? 'before' : 'after', rect: inside.r };
      const left = [...row].reverse().find(({ r }) => r.right < x);
      if (left) return { root, unit: left.u, side: 'after', rect: left.r };
      return { root, unit: row[0].u, side: 'before', rect: row[0].r };
    }
    const range = document.caretRangeFromPoint?.(x, y);
    if (!range || !root.contains(range.startContainer) || dragged.contains(range.startContainer)) return null;
    // Never inside another image's frame.
    const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const fig = node.closest('figure');
    if (fig && root.contains(fig)) return { root, unit: fig, side: 'after', rect: fig.getBoundingClientRect() };
    return { root, range, rect: range.getBoundingClientRect() };
  }

  function showMarker(tg) {
    if (!marker) {
      marker = h('div', { class: 'nm-drop-mark' });
      document.body.append(marker);
    }
    marker.hidden = !tg;
    if (!tg) return;
    const r = tg.rect;
    if (tg.unit) Object.assign(marker.style, { left: `${(tg.side === 'before' ? r.left - 6 : r.right + 2)}px`, top: `${r.top}px`, width: '4px', height: `${r.height}px` });
    else Object.assign(marker.style, { left: `${r.left - 1}px`, top: `${r.top}px`, width: '3px', height: `${Math.max(18, r.height)}px` });
  }

  // Make the images on one line fit together.
  function fitRow(unit) {
    const top = unit.getBoundingClientRect().top;
    const parent = unit.parentElement;
    const row = [...parent.children].filter((c) => (c.tagName === 'IMG' || (c.tagName === 'FIGURE' && c.querySelectorAll('img').length === 1)));
    const near = row.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 40 || c === unit);
    const group = near.length > 1 ? near : row.slice(Math.max(0, row.indexOf(unit) - 1), row.indexOf(unit) + 2);
    const total = group.reduce((n, c) => n + widthOf(c), 0);
    if (group.length > 1 && total > 100) {
      const w = Math.floor(100 / group.length) - 1;
      group.forEach((c) => { imgOf(c).dataset.w = String(w); });
    }
  }

  document.addEventListener('dragstart', (e) => {
    if (e.target.closest?.('[data-rich]')?.isContentEditable && e.target.tagName === 'IMG') e.preventDefault();
  }, true);

  document.addEventListener('pointerdown', (e) => {
    const img = e.target.closest?.('[data-rich] img');
    if (!img || e.button !== 0 || !img.closest('[data-rich]').isContentEditable) return;
    drag = { img, unit: unitOf(img), x: e.clientX, y: e.clientY, on: false, from: img.closest('[data-rich]') };
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.on = true;
      hideImageBar();
      drag.ghost = h('img', { src: drag.img.src, class: 'nm-drag-ghost' });
      document.body.append(drag.ghost);
      document.body.classList.add('nm-dragging');
      drag.unit.classList.add('nm-drag-src');
    }
    e.preventDefault();
    drag.ghost.style.left = `${e.clientX + 12}px`;
    drag.ghost.style.top = `${e.clientY + 12}px`;
    drag.target = dropTarget(e.clientX, e.clientY, drag.unit);
    showMarker(drag.target);
  }, true);

  document.addEventListener('pointerup', () => {
    const d = drag;
    drag = null;
    if (!d || !d.on) return;
    d.ghost.remove();
    document.body.classList.remove('nm-dragging');
    d.unit.classList.remove('nm-drag-src');
    showMarker(null);
    const tg = d.target;
    if (!tg) return;
    if (tg.unit) {
      // Side by side: both need a width that lets them share the line.
      if (widthOf(tg.unit) >= 99) imgOf(tg.unit).dataset.w = '49';
      if (widthOf(d.unit) >= 99) imgOf(d.unit).dataset.w = '49';
      tg.unit[tg.side](d.unit);
    } else {
      tg.range.insertNode(d.unit);
    }
    NMSanitize.sizeImages(tg.root);
    fitRow(d.unit);
    NMSanitize.sizeImages(tg.root);
    if (d.from !== tg.root) NMSanitize.sizeImages(d.from);
    for (const r of new Set([d.from, tg.root])) r.dispatchEvent(new Event('input', { bubbles: true }));
    if (d.from !== tg.root && isEmpty(d.from)) d.from.dispatchEvent(new Event('nm-emptied'));
    dragEnded = Date.now();
  }, true);

  document.addEventListener('click', (e) => {
    if (Date.now() - dragEnded < 150) {
      e.stopPropagation();
      return;
    }
    const img = e.target.closest?.('[data-rich] img');
    if (img && img.closest('[data-rich]').isContentEditable) showImageBar(img);
    else if (!e.target.closest?.('.nm-imgbar, .nm-img-handle')) hideImageBar();
  }, true);
  addEventListener('scroll', () => imgTarget && placeImageUi(), true);
  // Pinch on a trackpad (or Ctrl + scroll) over the selected image resizes it.
  addEventListener('wheel', (e) => {
    if (!imgTarget || !e.ctrlKey || !e.target.closest?.('img.nm-img-sel, .nm-img-handle, .nm-imgbar')) return;
    e.preventDefault();
    const cur = Number(imgTarget.dataset.w || 100);
    setWidth(imgTarget, cur * Math.exp(-e.deltaY * 0.01));
    clearTimeout(showImageBar.t);
    showImageBar.t = setTimeout(() => {
      imgTarget?.closest('[data-rich]')?.dispatchEvent(new Event('input', { bubbles: true }));
      if (imgTarget) showImageBar(imgTarget);
    }, 250);
    placeImageUi();
  }, { passive: false, capture: true });

  // ---- the format bar -------------------------------------------------------

  let bar = null;
  let swatchRow = null;

  const BUTTONS = [
    ['bold', 'ed.bold', () => exec('bold'), () => document.queryCommandState('bold')],
    ['italic', 'ed.italic', () => exec('italic'), () => document.queryCommandState('italic')],
    ['underline', 'ed.underline', () => exec('underline'), () => document.queryCommandState('underline')],
    ['strike', 'ed.strike', () => exec('strikeThrough'), () => document.queryCommandState('strikeThrough')],
    '|',
    ['heading', 'ed.heading', () => toggleBlock('H2'), (r) => currentBlockTag(r) === 'H2'],
    ['heading2', 'ed.subheading', () => toggleBlock('H3'), (r) => currentBlockTag(r) === 'H3'],
    ['list', 'ed.list', () => exec('insertUnorderedList'), () => document.queryCommandState('insertUnorderedList')],
    ['listOrdered', 'ed.numbered', () => exec('insertOrderedList'), () => document.queryCommandState('insertOrderedList')],
    ['quote', 'ed.quote', () => toggleBlock('BLOCKQUOTE'), (r) => currentBlockTag(r) === 'BLOCKQUOTE'],
    '|',
    ['highlighter', 'ed.highlight', () => { swatchRow.hidden = !swatchRow.hidden; place(); }, () => !!markAt()],
    ['link', 'ed.link', addLink, null],
    ['imagePlus', 'ed.insertImage', () => pickImages(), null],
    ['eraser', 'ed.clear', () => { exec('removeFormat'); exec('formatBlock', 'P'); }, null],
  ];

  function ensureBar() {
    if (bar) return bar;
    bar = h('div', { class: 'nm-fmt', hidden: true, role: 'toolbar' });
    const row = h('div', { class: 'nm-fmt-row' });
    for (const b of BUTTONS) {
      if (b === '|') {
        row.append(h('span', { class: 'nm-fmt-sep' }));
        continue;
      }
      const [ic, key, run] = b;
      const btn = h('button', { type: 'button', class: 'nm-fmt-btn', 'data-k': ic, title: t(key), html: icon(ic, 16) });
      btn.addEventListener('click', () => {
        run();
        refresh();
      });
      row.append(btn);
    }
    swatchRow = h('div', { class: 'nm-fmt-row nm-fmt-swatches', hidden: true },
      ...COLORS.map((c) => h('button', {
        type: 'button', class: 'nm-fmt-sw', title: NM.label(c.id), style: `--c:${c.swatch}`,
        onclick: () => {
          highlight(c.id);
          swatchRow.hidden = true;
          refresh();
        },
      })),
      h('button', {
        type: 'button', class: 'nm-fmt-btn', title: t('ed.noHighlight'), html: icon('x', 15),
        onclick: () => {
          highlight(null);
          swatchRow.hidden = true;
          refresh();
        },
      }));
    bar.append(row, swatchRow);
    // Keep the selection in the editor while clicking the bar.
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(bar);
    return bar;
  }

  function place() {
    const root = activeRoot();
    if (!root || !bar) return;
    bar.hidden = false;
    const sel = getSelection();
    let rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) rect = blockOf(root).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const w = bar.offsetWidth;
    const ht = bar.offsetHeight;
    let top = Math.min(rect.top, box.top) - ht - 8;
    if (top < 8) top = Math.max(rect.bottom, box.top) + 8;
    if (top + ht > innerHeight - 8) top = Math.max(8, box.top - ht - 8);
    const left = Math.min(Math.max(8, box.left), innerWidth - w - 8);
    bar.style.top = `${top}px`;
    bar.style.left = `${Math.max(8, left)}px`;
  }

  function refresh() {
    const root = activeRoot();
    if (!root || root.dataset.richBar === 'off') {
      if (bar) {
        bar.hidden = true;
        swatchRow.hidden = true;
      }
      return;
    }
    ensureBar();
    bar.querySelectorAll('.nm-fmt-btn[data-k]').forEach((btn) => {
      const spec = BUTTONS.find((b) => b !== '|' && b[0] === btn.dataset.k);
      let on = false;
      try { on = spec?.[3] ? !!spec[3](root) : false; } catch { /* not supported here */ }
      btn.classList.toggle('on', on);
    });
    place();
  }

  let raf = 0;
  document.addEventListener('selectionchange', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(refresh);
  });
  addEventListener('scroll', () => bar && !bar.hidden && place(), true);
  addEventListener('resize', () => bar && !bar.hidden && place());

  // ---- Markdown-style shortcuts at the start of a line ---------------------

  const SHORTCUTS = [
    [/^#$/, () => exec('formatBlock', 'H2')],
    [/^##$/, () => exec('formatBlock', 'H3')],
    [/^[-*•]$/, () => exec('insertUnorderedList')],
    [/^1[.)]$/, () => exec('insertOrderedList')],
    [/^>$/, () => exec('formatBlock', 'BLOCKQUOTE')],
  ];

  function onKeyDown(e) {
    const root = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      highlight('yellow');
      return;
    }
    if (mod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      addLink();
      return;
    }
    if (e.key !== ' ' || mod || e.altKey) return;
    const sel = getSelection();
    if (!sel.isCollapsed || !sel.rangeCount) return;
    const block = blockOf(root);
    if (block.tagName === 'LI' || block.tagName === 'PRE') return;
    const r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    const typed = r.toString();
    const hit = SHORTCUTS.find(([re]) => re.test(typed));
    if (!hit) return;
    e.preventDefault();
    sel.removeAllRanges();
    sel.addRange(r);
    exec('delete');
    hit[1]();
  }

  // Pasted HTML is cleaned to the same safe subset as everything else;
  // pasted images are kept, scaled down.
  async function onPaste(e) {
    const dt = e.clipboardData;
    if (!dt) return;
    const file = [...dt.files].find((f) => f.type.startsWith('image/'));
    const root = e.currentTarget;
    if (file) {
      if (root.dataset.richImages === 'off') return;
      e.preventDefault();
      e.stopPropagation();
      const { src } = await fileToImage(file);
      root.focus();
      exec('insertHTML', `<img src="${src}" data-w="48" alt="">`);
      NMSanitize.sizeImages(root);
      return;
    }
    const html = dt.getData('text/html');
    if (html) {
      e.preventDefault();
      e.stopPropagation();
      exec('insertHTML', NMSanitize.cleanHtml(html.replace(/<!--[\s\S]*?-->/g, '')));
      return;
    }
    const text = dt.getData('text/plain');
    if (text) {
      e.preventDefault();
      e.stopPropagation();
      exec('insertHTML', NM.textToHtml(text));
    }
  }

  // ---- public API -----------------------------------------------------------

  function make(el, { html = '', placeholder = '', images = true, bar: showBar = true } = {}) {
    el.classList.add('rich');
    el.dataset.rich = '';
    if (!images) el.dataset.richImages = 'off';
    if (!showBar) el.dataset.richBar = 'off';
    el.contentEditable = 'true';
    el.spellcheck = true;
    if (placeholder) el.dataset.placeholder = placeholder;
    if (html) el.innerHTML = NMSanitize.cleanHtml(html);
    NMSanitize.sizeImages(el);
    const sync = () => el.classList.toggle('is-empty', isEmpty(el));
    el.addEventListener('input', sync);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('paste', onPaste);
    sync();
    return {
      el,
      focus(atEnd = true) {
        el.focus();
        if (atEnd) {
          const r = document.createRange();
          r.selectNodeContents(el);
          r.collapse(false);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
        }
      },
      isEmpty: () => isEmpty(el),
      html: () => htmlOf(el),
      text: () => textOf(el),
      destroy() {
        el.removeEventListener('input', sync);
        el.removeEventListener('keydown', onKeyDown);
        el.removeEventListener('paste', onPaste);
        el.contentEditable = 'false';
        delete el.dataset.rich;
        if (bar) bar.hidden = true;
        hideImageBar();
      },
    };
  }

  function isEmpty(el) {
    return !el.textContent.trim() && !el.querySelector('img');
  }

  function htmlOf(el) {
    return NMSanitize.cleanHtml(el.innerHTML);  // class attributes are dropped by the sanitizer
  }

  function textOf(el) {
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlOf(el);
    return NMSanitize.toText(tmp) || (tmp.querySelector('img') ? t('ed.image') : '');
  }

  function hideBar() {
    if (bar) bar.hidden = true;
    hideImageBar();
  }

  globalThis.NMEditor = { selectImage: (img) => showImageBar(img), make, fileToImage, shrinkImage, readImage, hideBar, htmlOf, textOf };
})();
