// ThirdNote library webview. Plain DOM, no framework.
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const COLORS = ['yellow', 'red', 'green', 'blue'];
  const KIND = { highlight: 'Highlight', snippet: 'Snippet', file: 'File', note: 'Note', clip: 'Clip' };
  const INBOX = 'inbox';

  const saved = vscode.getState() || {};
  const ui = {
    col: saved.col || 'all', // 'all' | 'inbox' | collection id
    q: '',
    kind: saved.kind || 'all',
    color: saved.color || 'all',
    composing: false,
    editing: null, // item id whose note is being edited
    review: null, // { deck: [ids], i, shown, known }
  };
  let data = { collections: [], items: [], collecting: null };

  const ICONS = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    cards: '<rect x="3.5" y="6.5" width="13" height="13" rx="2"/><path d="M8 3.5h10.5a2 2 0 012 2V16"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
    trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    folder: '<path d="M3.5 7.5a2 2 0 012-2h4l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>',
    inbox: '<path d="M4 13.5l2.5-8h11l2.5 8v5a1 1 0 01-1 1H5a1 1 0 01-1-1z"/><path d="M4 13.5h4.5l1 2h5l1-2H20"/>',
    all: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  };
  const icon = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const persist = () => vscode.setState({ col: ui.col, kind: ui.kind, color: ui.color });
  const colName = (id) => (!id || id === INBOX ? 'Inbox' : (data.collections.find((c) => c.id === id) || {}).name || 'Inbox');

  function when(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `Today ${time}`;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} ${time}`;
  }

  function visibleItems() {
    const q = ui.q.trim().toLowerCase();
    return data.items
      .filter((it) => ui.col === 'all' || (it.collectionId || INBOX) === ui.col)
      .filter((it) => ui.kind === 'all' || it.kind === ui.kind)
      .filter((it) => ui.color === 'all' || it.color === ui.color)
      .filter((it) => !q || [it.title, it.note, it.text, it.source && it.source.path].join('\n').toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function countIn(id) {
    return id === 'all' ? data.items.length : data.items.filter((it) => (it.collectionId || INBOX) === id).length;
  }

  // ---------- render ----------
  function render() {
    if (ui.review) return renderReview();
    const items = visibleItems();
    const cols = [{ id: 'all', name: 'Everything', ic: 'all' }, { id: INBOX, name: 'Inbox', ic: 'inbox' }, ...data.collections.map((c) => ({ id: c.id, name: c.name, ic: 'folder' }))];
    const currentName = cols.find((c) => c.id === ui.col) ? cols.find((c) => c.id === ui.col).name : 'Everything';
    const canCollect = ui.col !== 'all';
    const collectingHere = canCollect && data.collecting === ui.col;

    app.innerHTML = `
      <div class="shell">
        <nav class="rail">
          <div class="brand"><span class="logo"></span><span>ThirdNote</span></div>
          <div class="rail-list">
            ${cols.map((c) => `
              <button class="rail-item ${ui.col === c.id ? 'on' : ''}" data-col="${esc(c.id)}">
                ${icon(data.collecting === c.id ? 'target' : c.ic)}
                <span class="rail-name">${esc(c.name)}</span>
                <span class="rail-count">${countIn(c.id)}</span>
              </button>`).join('')}
          </div>
          <button class="rail-add" data-act="newCollection">${icon('plus', 14)} New collection</button>
        </nav>
        <main class="main">
          <header class="top">
            <div class="title-row">
              <h1>${esc(currentName)}</h1>
              <div class="top-actions">
                ${canCollect ? `<button class="btn ghost ${collectingHere ? 'active' : ''}" data-act="collect" title="Send every new save here">${icon('target')} ${collectingHere ? 'Collecting here' : 'Collect here'}</button>` : ''}
                <button class="btn ghost" data-act="export" title="Export to Markdown">${icon('download')} Export</button>
                <button class="btn ghost" data-act="review" title="Review as flashcards">${icon('cards')} Review</button>
                <button class="btn primary" data-act="compose">${icon('pen')} Write note</button>
              </div>
            </div>
            <div class="filters">
              <label class="search">${icon('search', 14)}<input id="q" type="search" placeholder="Search notes, code and files" value="${esc(ui.q)}"></label>
              <div class="chips">
                ${['all', 'highlight', 'snippet', 'note', 'clip', 'file'].map((k) => `<button class="chip ${ui.kind === k ? 'on' : ''}" data-kind="${k}">${k === 'all' ? 'All' : KIND[k] + 's'}</button>`).join('')}
              </div>
              <div class="dots">
                <button class="dot all ${ui.color === 'all' ? 'on' : ''}" data-color="all" title="Any colour"></button>
                ${COLORS.map((c) => `<button class="dot c-${c} ${ui.color === c ? 'on' : ''}" data-color="${c}" title="${c}"></button>`).join('')}
              </div>
            </div>
          </header>
          ${ui.composing ? composer() : ''}
          <section class="list">
            ${items.length ? items.map(card).join('') : empty()}
          </section>
        </main>
      </div>`;
    const q = document.getElementById('q');
    if (q && ui._focusSearch) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); ui._focusSearch = false; }
    if (ui.composing) { const t = document.getElementById('c-title'); if (t && !ui._composeFocused) { t.focus(); ui._composeFocused = true; } }
    if (ui.editing) { const ta = document.querySelector(`[data-edit-for="${ui.editing}"]`); if (ta) { ta.focus(); autosize(ta); } }
  }

  function composer() {
    const target = ui.col === 'all' ? (data.collecting || INBOX) : ui.col;
    return `
      <div class="composer">
        <input id="c-title" class="c-title" placeholder="Title" maxlength="200">
        <textarea id="c-body" class="c-body" placeholder="Write anything. Markdown is fine. Use the first line as a question to review it later."></textarea>
        <div class="c-row">
          <select id="c-col">
            <option value="${INBOX}" ${target === INBOX ? 'selected' : ''}>Inbox</option>
            ${data.collections.map((c) => `<option value="${esc(c.id)}" ${target === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <div class="dots small" id="c-colors">${COLORS.map((c, i) => `<button class="dot c-${c} ${i === 0 ? 'on' : ''}" data-ccolor="${c}" title="${c}"></button>`).join('')}</div>
          <span class="grow"></span>
          <button class="btn ghost" data-act="cancelCompose">Cancel</button>
          <button class="btn primary" data-act="saveCompose">Save note <kbd>Ctrl Enter</kbd></button>
        </div>
      </div>`;
  }

  function empty() {
    if (data.items.length) return `<div class="empty"><p>Nothing matches.</p></div>`;
    return `
      <div class="empty first">
        <div class="logo big"></div>
        <h2>Capture code you want to remember</h2>
        <ol>
          <li>Select code in any file and press <kbd>Alt Shift H</kbd> to highlight it, or <kbd>Alt Shift J</kbd> to add a note too.</li>
          <li>Copied an answer from a chat or a doc? <kbd>Alt Shift V</kbd> saves the clipboard.</li>
          <li>Write your own notes here, group them into collections, then review them as flashcards.</li>
        </ol>
        <button class="btn primary" data-act="compose">${icon('pen')} Write your first note</button>
      </div>`;
  }

  function card(it) {
    const src = it.source && it.source.path
      ? `<button class="src" data-open="${it.id}" title="Open ${esc(it.source.path)}">${esc(it.source.path)}${it.source.start ? `:${it.source.start.line + 1}` : ''}</button>${it.source.detached ? '<span class="warn">moved or deleted</span>' : ''}`
      : '';
    const body = it.kind === 'note' ? '' : `<pre class="code"><code>${esc(it.text.length > 4000 ? it.text.slice(0, 4000) + '\n...' : it.text)}</code></pre>`;
    const editing = ui.editing === it.id;
    const noteBlock = editing
      ? `<textarea class="note-edit" data-edit-for="${it.id}" placeholder="${it.kind === 'note' ? 'Write your note' : 'Add a note: why this matters, or a question to review'}">${esc(it.note)}</textarea>
         <div class="note-hint">Saved as you type. <button class="link" data-done="${it.id}">Done</button></div>`
      : (it.note
        ? `<div class="note" data-editnote="${it.id}" title="Click to edit">${esc(it.note)}</div>`
        : `<button class="add-note" data-editnote="${it.id}">${icon('pen', 13)} Add a note</button>`);
    return `
      <article class="card c-${it.color}" data-id="${it.id}">
        <div class="meta">
          <span class="kind">${KIND[it.kind] || ''}</span>
          ${src}
          <span class="grow"></span>
          <span class="when">${esc(when(it.createdAt))}</span>
        </div>
        ${it.title ? `<h3 class="title">${esc(it.title)}</h3>` : ''}
        ${it.kind === 'note' ? noteBlock : body + noteBlock}
        <div class="tools">
          ${it.source && it.source.uri ? `<button class="tool" data-open="${it.id}" title="Open in editor">${icon('open', 14)}</button>` : ''}
          <button class="tool" data-copy="${it.id}" title="Copy">${icon('copy', 14)}</button>
          <span class="dots small">${COLORS.map((c) => `<button class="dot c-${c} ${it.color === c ? 'on' : ''}" data-setcolor="${c}" data-for="${it.id}" title="${c}"></button>`).join('')}</span>
          <select class="move" data-move="${it.id}" title="Move to collection">
            <option value="${INBOX}" ${(it.collectionId || INBOX) === INBOX ? 'selected' : ''}>Inbox</option>
            ${data.collections.map((c) => `<option value="${esc(c.id)}" ${it.collectionId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <span class="grow"></span>
          <button class="tool danger" data-del="${it.id}" title="Delete">${icon('trash', 14)}</button>
        </div>
      </article>`;
  }

  // ---------- review ----------
  function startReview(colId) {
    const pool = data.items.filter((it) => !colId || colId === 'all' || (it.collectionId || INBOX) === colId);
    if (!pool.length) { ui.review = { deck: [], i: 0, shown: false, known: 0 }; return render(); }
    // Least known first, then shuffled within that.
    const score = (it) => { const r = it.review || {}; return (r.known || 0) / Math.max(1, r.seen || 0) + Math.random() * 0.35; };
    const deck = pool.slice().sort((a, b) => score(a) - score(b)).slice(0, 30).map((it) => it.id);
    ui.review = { deck, i: 0, shown: false, known: 0, col: colId };
    render();
  }

  function front(it) {
    if (it.kind === 'note') {
      const lines = (it.note || '').split('\n');
      if (it.title) return { q: it.title, a: it.note };
      return { q: lines[0] || 'Untitled note', a: lines.slice(1).join('\n').trim() || '(no more text)' };
    }
    const q = it.note || it.title || `What does this ${it.kind === 'file' ? 'file' : 'code'} in ${it.source && it.source.path ? it.source.path.split(/[\\/]/).pop() : 'your clip'} do?`;
    return { q, a: it.text, code: true };
  }

  function renderReview() {
    const r = ui.review;
    const total = r.deck.length;
    if (!total || r.i >= total) {
      app.innerHTML = `
        <div class="review">
          <div class="review-top"><span>Review</span><button class="tool" data-act="endReview" title="Close">${icon('close')}</button></div>
          <div class="review-done">
            <h2>${total ? 'Done for now' : 'Nothing to review yet'}</h2>
            <p>${total ? `You knew ${r.known} of ${total}.` : 'Save a highlight or write a note first.'}</p>
            <div class="row">${total ? `<button class="btn ghost" data-act="again">Go again</button>` : ''}<button class="btn primary" data-act="endReview">Back to library</button></div>
          </div>
        </div>`;
      return;
    }
    const it = data.items.find((x) => x.id === r.deck[r.i]);
    if (!it) { r.i++; return renderReview(); }
    const f = front(it);
    app.innerHTML = `
      <div class="review">
        <div class="review-top">
          <span>Review · ${esc(r.col && r.col !== 'all' ? colName(r.col) : 'Everything')}</span>
          <span class="progress"><span style="width:${Math.round((r.i / total) * 100)}%"></span></span>
          <span class="count">${r.i + 1} / ${total}</span>
          <button class="tool" data-act="endReview" title="Close">${icon('close')}</button>
        </div>
        <div class="flash c-${it.color}">
          <div class="q">${esc(f.q)}</div>
          ${r.shown
            ? (f.code ? `<pre class="code"><code>${esc(f.a)}</code></pre>` : `<div class="a">${esc(f.a)}</div>`)
              + (it.source && it.source.path ? `<button class="src" data-open="${it.id}">${esc(it.source.path)}${it.source.start ? `:${it.source.start.line + 1}` : ''}</button>` : '')
            : `<button class="btn primary show" data-act="show">Show answer <kbd>Space</kbd></button>`}
        </div>
        ${r.shown ? `
          <div class="grade">
            <button class="btn ghost" data-grade="0">Again <kbd>1</kbd></button>
            <button class="btn primary" data-grade="1">Got it <kbd>2</kbd></button>
          </div>` : ''}
      </div>`;
  }

  function grade(known) {
    const r = ui.review;
    const id = r.deck[r.i];
    vscode.postMessage({ type: 'reviewed', id, known });
    if (known) r.known++;
    r.i++; r.shown = false;
    render();
  }

  // ---------- events ----------
  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 600)}px`; }

  let noteTimer = null;
  app.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') { ui.q = t.value; ui._focusSearch = true; render(); return; }
    if (t.dataset.editFor) {
      autosize(t);
      const id = t.dataset.editFor;
      const val = t.value;
      const it = data.items.find((x) => x.id === id);
      if (it) it.note = val;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => vscode.postMessage({ type: 'update', id, patch: { note: val } }), 300);
    }
    if (t.id === 'c-body') autosize(t);
  });

  app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.move) vscode.postMessage({ type: 'update', id: t.dataset.move, patch: { collectionId: t.value } });
  });

  app.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.editFor) {
      const id = t.dataset.editFor;
      clearTimeout(noteTimer);
      vscode.postMessage({ type: 'update', id, patch: { note: t.value } });
      setTimeout(() => { if (ui.editing === id && !document.activeElement.closest(`[data-id="${id}"]`)) { ui.editing = null; render(); } }, 120);
    }
  });

  app.addEventListener('click', (e) => {
    const b = e.target.closest('button, [data-editnote]');
    if (!b) return;
    const d = b.dataset;
    if (d.col) { ui.col = d.col; ui.editing = null; persist(); return render(); }
    if (d.kind) { ui.kind = d.kind; persist(); return render(); }
    if (d.color && !d.for) { ui.color = d.color; persist(); return render(); }
    if (d.ccolor) { document.querySelectorAll('#c-colors .dot').forEach((x) => x.classList.toggle('on', x === b)); return; }
    if (d.open) return vscode.postMessage({ type: 'open', id: d.open });
    if (d.copy) return vscode.postMessage({ type: 'copy', id: d.copy });
    if (d.del) return vscode.postMessage({ type: 'delete', id: d.del });
    if (d.setcolor) return vscode.postMessage({ type: 'update', id: d.for, patch: { color: d.setcolor } });
    if (d.editnote) { ui.editing = d.editnote; return render(); }
    if (d.done) { ui.editing = null; return render(); }
    if (d.grade) return grade(d.grade === '1');
    switch (d.act) {
      case 'newCollection': return vscode.postMessage({ type: 'newCollection' });
      case 'compose': ui.composing = true; ui._composeFocused = false; return render();
      case 'cancelCompose': ui.composing = false; return render();
      case 'saveCompose': return saveCompose();
      case 'export': return vscode.postMessage({ type: 'export', collectionId: ui.col === 'all' ? null : ui.col });
      case 'collect': return vscode.postMessage({ type: 'collect', collectionId: data.collecting === ui.col ? null : ui.col });
      case 'review': return startReview(ui.col);
      case 'show': ui.review.shown = true; return render();
      case 'again': return startReview(ui.review.col);
      case 'endReview': ui.review = null; return render();
    }
  });

  function saveCompose() {
    const title = (document.getElementById('c-title') || {}).value || '';
    const note = (document.getElementById('c-body') || {}).value || '';
    if (!title.trim() && !note.trim()) return;
    const on = document.querySelector('#c-colors .dot.on');
    vscode.postMessage({
      type: 'createNote', title: title.trim(), note,
      collectionId: (document.getElementById('c-col') || {}).value || INBOX,
      color: on ? on.dataset.ccolor : 'yellow',
    });
    ui.composing = false;
  }

  document.addEventListener('keydown', (e) => {
    if (ui.review) {
      if (e.key === ' ' && !ui.review.shown) { e.preventDefault(); ui.review.shown = true; render(); }
      else if (ui.review.shown && e.key === '1') grade(false);
      else if (ui.review.shown && e.key === '2') grade(true);
      else if (e.key === 'Escape') { ui.review = null; render(); }
      return;
    }
    if (ui.composing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveCompose(); }
    if (ui.composing && e.key === 'Escape') { ui.composing = false; render(); }
    if (ui.editing && e.key === 'Escape') { document.activeElement.blur(); }
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') {
      data = m.data;
      if (ui.col !== 'all' && ui.col !== INBOX && !data.collections.some((c) => c.id === ui.col)) ui.col = 'all';
      const intent = m.intent || {};
      if (intent.collectionId) ui.col = intent.collectionId;
      if (intent.compose) { ui.review = null; ui.composing = true; ui._composeFocused = false; }
      if (intent.focusId) { ui.col = 'all'; ui.q = ''; ui.kind = 'all'; ui.color = 'all'; ui.review = null; }
      if (intent.review) { render(); return startReview(intent.collectionId || 'all'); }
      // Keep the open note editor and review session as they are while data streams in.
      if (ui.editing && document.activeElement && document.activeElement.dataset && document.activeElement.dataset.editFor) return;
      if (ui.review && !intent.review) return;
      render();
      if (intent.focusId) {
        const el = document.querySelector(`[data-id="${intent.focusId}"]`);
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flashy'); setTimeout(() => el.classList.remove('flashy'), 1400); }
      }
    } else if (m.type === 'select') {
      ui.col = m.collectionId; persist(); render();
    } else if (m.type === 'created') {
      ui.editing = null;
    }
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
