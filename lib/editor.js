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
      exec('insertHTML', `<img src="${src}" alt="">`);
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
      },
    };
  }

  function isEmpty(el) {
    return !el.textContent.trim() && !el.querySelector('img');
  }

  function htmlOf(el) {
    return NMSanitize.cleanHtml(el.innerHTML);
  }

  function textOf(el) {
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlOf(el);
    return NMSanitize.toText(tmp) || (tmp.querySelector('img') ? t('ed.image') : '');
  }

  function hideBar() {
    if (bar) bar.hidden = true;
  }

  globalThis.NMEditor = { make, fileToImage, shrinkImage, readImage, hideBar, htmlOf, textOf };
})();
