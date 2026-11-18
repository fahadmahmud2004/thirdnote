// Runs on every page. On AI chat sites it saves conversations; everywhere it
// shows the highlight toolbar for selected text and takes screenshots.
(function () {
  if (globalThis.__notemateLoaded || window.top !== window) return;
  globalThis.__notemateLoaded = true;

  const { COLORS, icon, t } = NM;
  const adapter = NMAdapters.detect(location);

  const state = {
    url: location.href,
    pageType: null, // 'chat' | 'share' | 'page' | null
    sourceId: null,
    source: null,
    topic: null,
    tracked: false,
    total: null,
    highlights: [],
    sent: new Map(), // message key -> html last sent, to skip unchanged messages
  };
  let settings = { ...NM.DEFAULT_SETTINGS };
  let active = { topicId: null, on: false, topic: null }; // the collection being collected into
  let pending = null; // selection waiting for a colour
  let lastColor = 'yellow';
  let dead = false;
  let pointerDown = false; // the mouse button is held on the page (selecting text)
  let ui = null;

  // ---------------------------------------------------------------------------
  // Setup

  init().catch((err) => console.warn('[ThirdNote]', err));

  async function init() {
    settings = await NM.getSettings();
    NM.configure(settings);
    ui = buildUi();
    applyTheme();
    await loadActive();
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.activeTopicId || changes.collecting) loadActive();
      if (!changes.settings) return;
      NM.getSettings().then((s) => {
        settings = s;
        NM.configure(s);
        applyTheme();
        onRoute();
      });
    });
    document.addEventListener('mouseup', onPointerUp, true);
    addEventListener('mouseup', () => { pointerDown = false; }, true);
    addEventListener('blur', () => { pointerDown = false; });
    document.addEventListener('keyup', (e) => e.shiftKey && onPointerUp(e), true);
    document.addEventListener('mousedown', (e) => {
      pointerDown = true;
      if (e.composedPath().includes(ui.host)) return;
      hideToolbar();
      hideLayer(ui.menu);
    }, true);
    document.addEventListener('keydown', onShortcut, true);
    chrome.runtime.onMessage.addListener(onMessage);
    new MutationObserver(onMutations).observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
    });
    setInterval(() => {
      if (location.href !== state.url) {
        state.url = location.href;
        onRoute();
      }
    }, 800);
    onRoute();
    // Feeds drop posts that scroll far away, so posts are remembered as the
    // user scrolls and all of them go into Save page.
    addEventListener('scroll', () => {
      clearTimeout(feedTimer);
      feedTimer = setTimeout(rememberFeed, 700);
    }, { passive: true, capture: true });
    setTimeout(rememberFeed, 2500);
  }

  const feedSeen = { page: null, tiles: false, top: [], cards: new Map() }; // key -> card html, in the order first seen
  let feedTimer = 0;

  function rememberFeed(all = false) {
    if (dead || document.hidden) return null;
    if (feedSeen.page !== pageKey()) {
      feedSeen.page = pageKey();
      feedSeen.cards.clear();
      feedSeen.top = [];
    }
    let snap = null;
    try {
      snap = NMSanitize.feedCards(document, !all);
    } catch { /* a page we can't read as a feed */ }
    if (!snap) return null;
    feedSeen.tiles = snap.tiles;
    if (snap.top.length) feedSeen.top = snap.top;
    for (const c of snap.cards) feedSeen.cards.set(c.key, c.html);
    while (feedSeen.cards.size > 400) feedSeen.cards.delete(feedSeen.cards.keys().next().value);
    return snap;
  }

  function applyTheme() {
    if (settings.theme === 'light' || settings.theme === 'dark') ui.host.dataset.theme = settings.theme;
    else delete ui.host.dataset.theme;
  }

  function chatSiteActive() {
    return !!adapter && NM.siteEnabled(settings, adapter.id);
  }

  function onChat() {
    return chatSiteActive() && (state.pageType === 'chat' || state.pageType === 'share');
  }

  async function call(method, args) {
    if (dead) throw new Error(t('err.reload'));
    try {
      return await NM.rpc(method, args);
    } catch (err) {
      if (/context invalidated|Receiving end/i.test(err.message)) {
        dead = true;
        throw new Error(t('err.reload'));
      }
      throw err;
    }
  }

  function pageKey() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  async function loadActive() {
    const a = await NM.getActive();
    let topic = null;
    if (a.topicId) {
      try {
        topic = (await call('listTopics')).find((x) => x.id === a.topicId) || null;
      } catch { /* extension reloading */ }
    }
    active = { ...a, on: a.on && !!topic, topic };
  }

  // Where a new save from this page goes, if that is already decided.
  function destination() {
    if (onChat() && state.tracked && state.topic) return state.topic;
    return active.on ? active.topic : null;
  }

  async function onRoute() {
    Object.assign(state, { pageType: null, sourceId: null, source: null, topic: null, tracked: false, total: null, highlights: [] });
    state.sent.clear();
    paint();
    try {
      const info = chatSiteActive() ? adapter.pageInfo(location) : null;
      if (info) {
        state.pageType = info.type;
        state.sourceId = `${adapter.id}:${info.type === 'share' ? 'share:' : ''}${info.id}`;
        await loadSource();
        if (!state.source && info.type === 'chat' && settings.autoTrack) await startTracking({ auto: true });
        scheduleSync();
      } else {
        await loadPage();
      }
    } catch (err) {
      // An old copy of the script in a tab opened before an update: quiet.
      if (!dead) console.warn('[ThirdNote]', err);
    }
    renderPill();
  }

  // Ordinary pages: highlights from every collection this page was clipped into.
  // Highlights from every collection this page was clipped into.
  async function pageHighlights() {
    const sources = await call('getPageSources', { pageKey: pageKey() });
    const lists = await Promise.all(sources.map((s) => call('listHighlights', { sourceId: s.id })));
    return { sources, highlights: lists.flat() };
  }

  async function loadPage() {
    const { sources, highlights } = await pageHighlights();
    state.pageType = sources.length ? 'page' : null;
    state.highlights = highlights;
    paint();
  }

  const refresh = () => (onChat() ? loadSource() : loadPage());

  async function loadSource() {
    if (!onChat()) return loadPage();
    const src = await call('getSource', { id: state.sourceId });
    state.source = src;
    state.tracked = !!src?.tracked;
    state.total = src?.messageCount ?? null;
    if (!src) state.sent.clear();
    // A saved chat shows its own highlights; an unsaved one shows clips taken from it.
    state.highlights = src ? await call('listHighlights', { sourceId: state.sourceId }) : (await pageHighlights()).highlights;
    state.topic = src ? (await call('listTopics')).find((x) => x.id === src.topicId) || null : null;
    paint();
    renderPill();
  }

  function onMessage(msg, sender, sendResponse) {
    if (msg?.type === 'nm-changed') {
      if (onChat()) {
        if (!msg.sourceId || msg.sourceId === state.sourceId || !state.tracked) loadSource().catch(() => {});
      } else if (msg.method !== 'syncMessages') {
        loadPage().catch(() => {});
      }
    } else if (msg?.type === 'nm-context-save') {
      checkSelection();
      if (pending) save(lastColor);
      else toast(t('toast.selectFirst'), 'error');
    } else if (msg?.type === 'nm-save-page') {
      savePage().catch((err) => toast(err.message, 'error'));
      sendResponse(true);
    } else if (msg?.type === 'nm-capture') {
      startCapture(msg.mode).catch((err) => toast(err.message, 'error'));
      sendResponse(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Chat capture

  let syncTimer = null;
  function scheduleSync(delay = 1500) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow().catch((err) => console.warn('[ThirdNote]', err)), delay);
  }

  // Pictures sent with a message (an uploaded screenshot, a photo) sit next
  // to its text rather than inside it. Small ones are icons and avatars.
  function attachments(m) {
    const root = m.imgRoot;
    if (!root || root === m.contentEl) return '';
    const imgs = [...root.querySelectorAll('img')].filter((img) => {
      if (m.contentEl.contains(img) || !img.currentSrc && !img.src) return false;
      const r = img.getBoundingClientRect();
      return r.width >= 48 && r.height >= 48;
    });
    return imgs.map((img) => `<img src="${NM.escapeHtml(img.currentSrc || img.src)}" alt="${NM.escapeHtml(img.alt || '')}" data-w="40">`).join('');
  }

  function collect(forceKey) {
    const out = [];
    adapter.messageEls().forEach((m, i) => {
      const forced = m.key === forceKey;
      if (!forced && m.role === 'user' && !settings.captureQuestions) return;
      let { html, text } = NMSanitize.fromElement(m.contentEl);
      const pics = attachments(m);
      if (pics) html = `<p>${pics}</p>${html}`;
      if (!text && !html) return;
      if (!forced && settings.minChars && text.length < settings.minChars) return;
      out.push({ key: m.key, role: m.role, html, text, order: i });
    });
    return out;
  }

  async function syncNow({ force = false, forceKey } = {}) {
    if (!state.tracked || !onChat()) return;
    // Wait while an answer is being written or the user is selecting text,
    // so reading the page never gets in the way of a selection.
    if (!force && (adapter.isBusy() || selecting())) {
      scheduleSync();
      return;
    }
    const changed = collect(forceKey).filter((m) => state.sent.get(m.key) !== m.html);
    if (!changed.length && !force) return;
    const messages = await Promise.all(changed.map(async (m) => ({ ...m, html: await inlineImages(m.html) })));
    const res = await call('syncMessages', {
      sourceId: state.sourceId,
      title: adapter.title(),
      url: location.origin + location.pathname + (adapter.generic ? location.search : ''),
      messages,
    });
    changed.forEach((m) => state.sent.set(m.key, m.html));
    state.total = res.total;
    renderPill();
  }

  function selecting() {
    if (pointerDown) return true;
    const sel = getSelection();
    return !!sel && !sel.isCollapsed && !ui?.tb.hidden;
  }

  // Image links on chat sites expire or need the site's login, so a saved
  // copy keeps the picture itself, scaled down to a sensible size.
  const imageCache = new Map(); // src -> data: URL (or '' when it can't be read)

  async function imageData(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    let data = '';
    try {
      if (src.startsWith('blob:') || new URL(src).origin === location.origin) {
        const res = await fetch(src, { credentials: 'include' });
        if (res.ok) data = await shrink(await res.blob());
      }
    } catch { /* fall through to the background */ }
    if (!data && /^https?:/i.test(src)) {
      try {
        data = (await call('fetchImage', { url: src })) || '';
      } catch { /* keep the link */ }
    }
    imageCache.set(src, data);
    return data;
  }

  async function shrink(blob, max = 1600) {
    if (!/^image\//.test(blob.type)) return '';
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && blob.size < 400000) {
      return new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => resolve('');
        r.readAsDataURL(blob);
      });
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  }

  async function inlineImages(html, limit = 40) {
    if (!/<img\b/i.test(html)) return html;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const imgs = [...tpl.content.querySelectorAll('img')].filter((img) => !/^data:/i.test(img.getAttribute('src') || '')).slice(0, limit);
    await Promise.all(imgs.map(async (img) => {
      const data = await imageData(img.getAttribute('src'));
      if (data) img.setAttribute('src', data);
    }));
    return tpl.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Save the whole page: works on any site, including chat sites the extension
  // doesn't know and ones whose layout changed.

  async function savePage() {
    hideToolbar();
    // A known chat: save it as a chat, so new messages keep being added.
    if (onChat() && !adapter.generic && hasBothRoles()) {
      if (state.tracked) {
        state.sent.clear();
        await syncNow({ force: true });
        toast(t('toast.synced', { n: state.total }));
        return;
      }
      await startTracking();
      return;
    }
    // Read the page first: feeds keep changing while a dialog is open.
    let page = (await googleDoc()) || (await googleSheet());
    if (!page && rememberFeed(true)) {
      // Every post seen while scrolling, not only the ones still on the page.
      page = NMSanitize.buildFeed([...feedSeen.cards.values()], feedSeen.tiles, feedSeen.top);
    }
    if (!page) {
      // A messaging site (Telegram, WhatsApp): the open chat's messages.
      const turns = NMAdapters.chatTurns?.();
      const cards = turns ? NMSanitize.chatCards(turns) : [];
      if (cards.length >= 3) page = NMSanitize.buildFeed(cards, false);
    }
    const { html: raw, text } = page || NMSanitize.fromPage(document);
    // A page of pictures (Pinterest, a gallery) is worth saving without text.
    if (!text && !/<img\b/i.test(raw)) throw new Error(t('err.emptyPage'));
    const topic = destination() || (await pickTopic(t('picker.savePage')));
    if (!topic) return;
    const src = await pageSourceFor(topic);
    // Saved before (a feed looks different every visit): replace it, or keep
    // both with the new one below.
    const full = await call('getSourceFull', { id: src.id });
    const earlier = (full?.messages || []).filter((m) => m.role === 'page').sort((a, b) => a.order - b.order);
    let mode = 'add';
    if (earlier.length) {
      const last = earlier[earlier.length - 1];
      mode = await askChoice({
        title: t('again.title'),
        text: t('again.text', { name: topic.name, time: stamp(last.savedAt) }),
        choices: [
          { id: null, label: t('common.cancel') },
          { id: 'replace', label: t('again.replace') },
          { id: 'add', label: t('again.add'), primary: true },
        ],
      });
      if (!mode) return;
    }
    toast(t('toast.savingPage'));
    const now = Date.now();
    const html = `<p><small>${NM.escapeHtml(t('again.savedAt', { time: stamp(now) }))}</small></p>${await inlineImages(raw)}`;
    if (mode === 'replace') {
      for (const m of earlier) await call('deleteMessage', { id: m.id });
    }
    await call('syncMessages', {
      sourceId: src.id,
      title: (adapter && !adapter.generic && adapter.title()) || document.title || location.hostname,
      url: location.href.split('#')[0],
      messages: [{ key: `page-${now}`, role: 'page', html, text, order: mode === 'replace' ? earlier[0].order : now }],
    });
    await refresh();
    toast(t(mode === 'replace' ? 'toast.pageReplaced' : earlier.length ? 'toast.pageAdded' : 'toast.pageSaved', { name: topic.name }));
  }

  // Google Docs draws its text on a canvas, so the page itself has none to
  // read. The document's own HTML export (what File > Download gives) is
  // fetched instead; it is the same site, so the user's sign-in applies.
  async function googleDoc() {
    const m = location.hostname === 'docs.google.com' && location.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([\w-]+)/);
    if (!m) return null;
    try {
      const res = await fetch(`/document/d/${m[1]}/export?format=html`, { credentials: 'include' });
      if (!res.ok) return null;
      const html = NMSanitize.cleanHtml(new DOMParser().parseFromString(await res.text(), 'text/html').body.innerHTML);
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const text = NMSanitize.toText(tmp);
      return text ? { html, text } : null;
    } catch {
      return null;
    }
  }

  // Google Sheets also draws on a canvas. The open sheet is fetched as CSV
  // (File > Download > CSV) and kept as a table.
  async function googleSheet() {
    const m = location.hostname === 'docs.google.com' && location.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)/);
    if (!m) return null;
    const gid = (location.hash.match(/gid=(\d+)/) || location.search.match(/gid=(\d+)/) || [])[1] || '0';
    try {
      const res = await fetch(`/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`, { credentials: 'include' });
      if (!res.ok) return null;
      let rows = parseCsv(await res.text());
      // Drop empty rows and columns at the edges.
      while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) rows.pop();
      const width = Math.max(0, ...rows.map((r) => r.reduce((n, c, i) => (c.trim() ? i + 1 : n), 0)));
      rows = rows.slice(0, 3000).map((r) => Array.from({ length: width }, (_, i) => r[i] || ''));
      if (!rows.length || !width) return null;
      const esc = NM.escapeHtml;
      const tab = document.querySelector('.docs-sheet-active-tab .docs-sheet-tab-name')?.textContent?.trim();
      const [head, ...body] = rows;
      const html = `${tab ? `<h3>${esc(tab)}</h3>` : ''}<table><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      return { html, text: rows.map((r) => r.join('\t')).join('\n') };
    } catch {
      return null;
    }
  }

  function parseCsv(src) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function stamp(ms) {
    return new Date(ms).toLocaleString(NM.getLang() === 'bn' ? 'bn-BD' : undefined, {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    });
  }

  // A small dialog with a few buttons; resolves with the chosen id.
  function askChoice({ title, text, choices }) {
    const a = ui.ask;
    a.title.textContent = title;
    a.text.textContent = text;
    showLayer(a.overlay);
    return new Promise((resolve) => {
      const done = (id) => {
        hideLayer(a.overlay);
        document.removeEventListener('keydown', onKey, true);
        resolve(id);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          done(null);
        }
      };
      document.addEventListener('keydown', onKey, true);
      a.actions.replaceChildren(...choices.map((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn${c.primary ? ' primary' : c.id ? '' : ' cancel'}`;
        b.textContent = c.label;
        b.onclick = () => done(c.id);
        return b;
      }));
      a.close.onclick = () => done(null);
      a.overlay.onclick = (e) => e.target === a.overlay && done(null);
      a.actions.querySelector('.primary')?.focus();
    });
  }

  function hasBothRoles() {
    const ms = adapter.messageEls();
    return ms.some((m) => m.role === 'user') && ms.some((m) => m.role === 'assistant');
  }

  async function startTracking({ auto = false } = {}) {
    let topic = active.on ? active.topic : null;
    if (!topic && auto) {
      const recent = await NM.recentTopicIds();
      const topics = await call('listTopics');
      topic = topics.find((x) => x.id === recent[0]) || (await call('saveTopic', { subject: 'Inbox', name: 'Unsorted' }));
    } else if (!topic) {
      topic = await pickTopic(t(state.pageType === 'share' ? 'picker.importChat' : 'picker.saveChat'));
      if (!topic) return false;
    }
    state.source = await call('trackSource', {
      id: state.sourceId,
      kind: 'chat',
      site: adapter.id,
      url: location.origin + location.pathname + (adapter.generic ? location.search : ''),
      title: adapter.title(),
      topicId: topic.id,
      tracked: true,
    });
    state.topic = topic;
    state.tracked = true;
    state.sent.clear();
    await syncNow({ force: true });
    renderPill();
    toast(t(auto ? 'toast.chatAuto' : 'toast.chatSaved', { name: topic.name }));
    return true;
  }

  // ---------------------------------------------------------------------------
  // Highlights on the live page (CSS Custom Highlight API: no DOM changes, so
  // it can't break the site's own rendering)

  let paintTimer = null;
  function schedulePaint() {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(paint, 500);
  }

  function paint() {
    if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
    const groups = Object.fromEntries(COLORS.map((c) => [c.id, []]));
    if (state.highlights.length) {
      if (!onChat() || !state.tracked) {
        const hs = state.highlights.filter((h) => h.pageQuote);
        NMAnchor.anchorAll(document.body, hs.map((h) => h.pageQuote)).forEach((r, i) => {
          if (r) groups[hs[i].color]?.push(r);
        });
      } else {
        const byKey = new Map(adapter.messageEls().map((m) => [m.key, m]));
        const perMsg = new Map();
        for (const h of state.highlights) {
          if (!perMsg.has(h.messageKey)) perMsg.set(h.messageKey, []);
          perMsg.get(h.messageKey).push(h);
        }
        for (const [key, hs] of perMsg) {
          const m = byKey.get(key);
          if (!m) continue;
          NMAnchor.anchorAll(m.contentEl, hs).forEach((r, i) => {
            if (r) groups[hs[i].color]?.push(r);
          });
        }
      }
    }
    for (const c of COLORS) CSS.highlights.set(`nm-${c.id}`, new Highlight(...groups[c.id]));
  }

  function onMutations(muts) {
    if (!ui || muts.every((m) => ui.host.contains(m.target))) return;
    if (state.tracked) scheduleSync();
    if (state.highlights.length) schedulePaint();
  }

  // ---------------------------------------------------------------------------
  // Selection, toolbar, save

  function onPointerUp(e) {
    if (!ui || e.composedPath().includes(ui.host)) return;
    setTimeout(checkSelection, 0);
  }

  function checkSelection() {
    pending = null;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || sel.toString().trim().length < 2) return hideToolbar();
    const range = sel.getRangeAt(0);
    const anc = range.commonAncestorContainer;
    const ancEl = anc.nodeType === Node.ELEMENT_NODE ? anc : anc.parentElement;
    if (ancEl?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return hideToolbar();

    // A saved chat: the highlight lives inside the saved conversation.
    // If the selection isn't inside one message (it spans two, or the site's
    // layout changed), it is kept as a clip instead, so it still saves.
    const msg = onChat() && state.tracked
      ? adapter.messageEls().find((m) => m.contentEl.contains(anc))
      : null;
    if (msg) {
      pending = { kind: 'chat', range: range.cloneRange(), msg };
    } else {
      // Anywhere else, including a chat that isn't saved: keep just the selection.
      if (!onChat() && !settings.toolbarEverywhere) return hideToolbar();
      pending = { kind: 'page', range: range.cloneRange() };
    }
    showToolbar(range);
  }

  // While the toolbar is open: 1-4 pick a colour, N adds a note, Esc closes.
  function onShortcut(e) {
    if (!ui || ui.tb.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.composedPath().includes(ui.note)) return;
    const idx = ['1', '2', '3', '4'].indexOf(e.key);
    if (idx >= 0) {
      e.preventDefault();
      e.stopPropagation();
      save(COLORS[idx].id);
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      e.stopPropagation();
      openNote();
    } else if (e.key === 'Escape') {
      hideToolbar();
    }
  }

  async function save(color) {
    const p = pending;
    const note = ui.note.value;
    hideToolbar();
    if (!p) return;
    lastColor = color;
    try {
      if (p.kind === 'chat') await saveChatHighlight(p, color, note);
      else await saveClip(p, color, note);
      getSelection()?.removeAllRanges();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function saveChatHighlight(p, color, note) {
    const q = NMAnchor.quote(p.msg.contentEl, p.range);
    if (!q?.exact) throw new Error(t('err.readSel'));
    if (!state.tracked && !(await startTracking())) return;
    await syncNow({ force: true, forceKey: p.msg.key });
    await call('addHighlight', { sourceId: state.sourceId, messageKey: p.msg.key, ...q, color, note });
    await loadSource();
    toast(t('toast.highlighted', { label: NM.label(color) }), 'ok', color);
  }

  // The page's source in the chosen collection, created on first use.
  async function pageSourceFor(topic) {
    const id = `page:${topic.id}:${pageKey()}`;
    const src = await call('getSource', { id });
    if (src) return src;
    return call('trackSource', {
      id, kind: 'page', site: location.hostname, url: location.href.split('#')[0], pageKey: pageKey(),
      title: (onChat() && adapter.title()) || document.title || location.hostname, topicId: topic.id, tracked: false,
    });
  }

  async function saveClip(p, color, note) {
    const bodyQuote = NMAnchor.quote(document.body, p.range);
    const { html, text } = NMSanitize.fromRange(p.range);
    if (!text) throw new Error(t('err.emptySel'));
    const topic = destination() || (await pickTopic(t('picker.saveTo')));
    if (!topic) return;
    const src = await pageSourceFor(topic);
    await call('addClip', {
      sourceId: src.id, html, text, color, note,
      pageQuote: bodyQuote && { exact: bodyQuote.exact, prefix: bodyQuote.prefix, suffix: bodyQuote.suffix },
    });
    await refresh();
    toast(t('toast.savedTo', { name: topic.name }), 'ok', color);
  }

  // ---------------------------------------------------------------------------
  // Screenshots: drag over any area (a video frame, a chart, a post), add a
  // note, save it into the collection.

  async function startCapture(mode) {
    hideToolbar();
    let rect = null;
    if (mode !== 'full') {
      rect = await selectArea();
      if (!rect) return;
    }
    hideLayer(ui.toast);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80))));
    let shot;
    try {
      shot = await call('captureVisible');
    } catch {
      throw new Error(t('err.noCapture'));
    }
    await openShotCard(await crop(shot, rect));
  }

  function selectArea() {
    const { layer, box, size, full, cancel } = ui.capture;
    box.hidden = true;
    showLayer(layer);
    return new Promise((resolve) => {
      let start = null;
      let rect = null;
      const finish = (value) => {
        layer.onmousedown = layer.onmousemove = layer.onmouseup = null;
        document.removeEventListener('keydown', onKey, true);
        hideLayer(layer);
        resolve(value);
      };
      const whole = () => ({ x: 0, y: 0, w: innerWidth, h: innerHeight });
      const onKey = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          finish(e.key === 'Enter' ? whole() : null);
        }
      };
      document.addEventListener('keydown', onKey, true);
      full.onclick = () => finish(whole());
      cancel.onclick = () => finish(null);
      layer.onmousedown = (e) => {
        if (e.composedPath().some((n) => n.classList?.contains('cap-bar'))) return;
        e.preventDefault();
        start = { x: e.clientX, y: e.clientY };
      };
      layer.onmousemove = (e) => {
        if (!start) return;
        rect = {
          x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY),
          w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y),
        };
        Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
        box.hidden = false;
        size.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
      };
      layer.onmouseup = () => {
        if (!start) return;
        start = null;
        if (rect && rect.w > 8 && rect.h > 8) finish(rect);
        else box.hidden = true;
      };
    });
  }

  async function crop(dataUrl, rect) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const scale = img.naturalWidth / innerWidth;
    const r = rect || { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const out = Math.min(1, 1600 / (r.w * scale));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(r.w * scale * out));
    canvas.height = Math.max(1, Math.round(r.h * scale * out));
    canvas.getContext('2d').drawImage(img, r.x * scale, r.y * scale, r.w * scale, r.h * scale, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  }

  // On YouTube, remember where in the video the screenshot was taken.
  function videoMoment() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return null;
    const video = document.querySelector('video');
    if (!video || !Number.isFinite(video.currentTime)) return null;
    const s = Math.floor(video.currentTime);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    const label = hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
    const url = new URL(location.href);
    url.searchParams.set('t', `${s}s`);
    return { label, url: url.href };
  }

  async function openShotCard(image) {
    const c = ui.shot;
    const moment = videoMoment();
    c.img.src = image;
    c.note.value = '';
    c.moment.hidden = !moment;
    if (moment) c.momentText.textContent = t('shot.videoAt', { time: moment.label });
    const dest = destination();
    c.dest.textContent = dest ? dest.name : t('tb.chooseLater');
    showLayer(c.overlay);
    c.note.focus();
    return new Promise((resolve) => {
      const close = () => {
        hideLayer(c.overlay);
        resolve();
      };
      const submit = async (toBoard) => {
        try {
          const topic = destination() || (await pickTopic(t('picker.saveShot')));
          if (!topic) return;
          const note = c.note.value.trim();
          const caption = [note, moment ? t('shot.videoAt', { time: moment.label }) : ''].filter(Boolean).join(' · ');
          let html = `<figure><img src="${image}" alt="">${note ? `<figcaption>${NM.escapeHtml(note)}</figcaption>` : ''}</figure>`;
          if (moment) html += `<p><a href="${NM.escapeHtml(moment.url)}">${NM.escapeHtml(t('shot.watchFrom', { time: moment.label }))}</a></p>`;
          const text = caption || t('shot.from', { title: document.title || location.hostname });
          const src = await pageSourceFor(topic);
          await call('addClip', { sourceId: src.id, html, text, color: lastColor, note, image });
          close();
          await refresh();
          toast(t('toast.shotSaved', { name: topic.name }));
          if (toBoard === true) await call('openReader', { topic: topic.id, mode: 'board' });
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      c.save.onclick = () => submit(false);
      c.toBoard.onclick = () => submit(true);
      c.cancel.onclick = close;
      c.close.onclick = close;
      c.overlay.onclick = (e) => e.target === c.overlay && close();
      c.note.onkeydown = (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        if (e.key === 'Escape') close();
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Collection picker: recent collections are one click; a new one is two fields.

  async function pickTopic(heading) {
    const topics = await call('listTopics');
    const recent = (await NM.recentTopicIds()).map((id) => topics.find((x) => x.id === id)).filter(Boolean);
    // Recent first, then the rest by name.
    const ordered = [...recent, ...topics.filter((x) => !recent.includes(x)).sort((a, b) => a.name.localeCompare(b.name))];
    const FEW = 6;
    const p = ui.picker;
    let showAll = false;
    p.heading.textContent = heading;
    p.recentWrap.hidden = !ordered.length;
    p.newLabel.textContent = t(ordered.length ? 'picker.orNew' : 'picker.createFirst');
    p.find.hidden = ordered.length <= FEW;
    p.findInput.value = '';

    // Any part of the name or group, in any case, in any order of words.
    const matches = (x, q) => q.split(/\s+/).filter(Boolean)
      .every((w) => `${x.name} ${x.subject}`.toLowerCase().includes(w));
    let visible = [];
    const draw = () => {
      const q = p.findInput.value.trim().toLowerCase();
      visible = q ? ordered.filter((x) => matches(x, q)) : showAll ? ordered : ordered.slice(0, FEW);
      p.recentLabel.textContent = t(q || showAll ? 'picker.all' : 'picker.recent');
      p.recent.classList.toggle('tall', !!q || showAll);
      p.recent.replaceChildren(...visible.map((x) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'topic-chip';
        b.dataset.id = x.id;
        b.innerHTML = `<span class="chip-ic">${icon('folder', 15)}</span><span class="chip-text"><span class="name"></span><span class="sub"></span></span>${icon('chevronRight', 15)}`;
        b.querySelector('.name').textContent = x.name;
        b.querySelector('.sub').textContent = x.subject;
        return b;
      }));
      p.noMatch.hidden = !q || visible.length > 0;
      p.noMatch.textContent = t('picker.noMatch');
      p.seeAll.hidden = !!q || showAll || ordered.length <= FEW;
      p.seeAll.textContent = t('picker.seeAll', { n: ordered.length });
    };
    draw();
    p.findInput.oninput = draw;
    p.seeAll.onclick = () => {
      showAll = true;
      draw();
      p.findInput.focus();
    };
    p.subjectList.replaceChildren(...[...new Set(topics.map((x) => x.subject))].map(option));
    const fillTopics = () => {
      const s = p.subject.value.trim().toLowerCase();
      p.topicList.replaceChildren(...topics.filter((x) => !s || x.subject.toLowerCase() === s).map((x) => option(x.name)));
    };
    p.subject.value = '';
    p.topic.value = '';
    fillTopics();
    p.subject.oninput = fillTopics;
    showLayer(p.overlay);
    (ordered.length > FEW ? p.findInput : ordered.length ? p.recent.querySelector('button') : p.topic).focus();

    return new Promise((resolve) => {
      const close = (topic) => {
        hideLayer(p.overlay);
        resolve(topic);
      };
      const choose = async (topic) => {
        await NM.useTopic(topic.id);
        close(topic);
      };
      // Handled by hand rather than form submission, which some pages block.
      const submit = async () => {
        if (!p.topic.value.trim()) return p.topic.focus();
        try {
          await choose(await call('saveTopic', { subject: p.subject.value || 'General', name: p.topic.value }));
        } catch (err) {
          toast(err.message, 'error');
          close(null);
        }
      };
      p.recent.onclick = (e) => {
        const id = e.target.closest('.topic-chip')?.dataset.id;
        const x = id && topics.find((y) => y.id === id);
        if (x) choose(x);
      };
      p.form.onsubmit = (e) => {
        e.preventDefault();
        submit();
      };
      p.save.onclick = submit;
      p.cancel.onclick = () => close(null);
      p.close.onclick = () => close(null);
      p.overlay.onclick = (e) => e.target === p.overlay && close(null);
      p.findInput.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        if (visible[0]) choose(visible[0]);
      };
      p.form.onkeydown = (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
          e.preventDefault();
          submit();
        }
      };
    });
  }

  function option(value) {
    const o = document.createElement('option');
    o.value = value;
    return o;
  }

  // ---------------------------------------------------------------------------
  // UI. Lives in a shadow root (site CSS can't reach it) and is shown in the
  // browser's top layer, so site popups such as ChatGPT's "Ask ChatGPT" button
  // can't cover it.

  function buildUi() {
    const host = document.createElement('div');
    host.id = 'notemate-root';
    const root = host.attachShadow({ mode: 'open' });
    const dots = COLORS.map((c, i) => `<button class="dot" data-color="${c.id}" data-key="${i + 1}" style="--c:${c.swatch}"></button>`).join('');
    root.innerHTML = `
      <style>${UI_CSS}</style>
      <div class="tb card" popover="manual" hidden>
        <div class="row">${dots}<span class="sep"></span><button class="icon-btn note-btn">${icon('pencil', 16)}</button></div>
        <div class="tb-foot"><span class="dest">${icon('folder', 13)}<span class="dest-text"></span></span><span class="hint"></span></div>
        <div class="note-wrap" hidden>
          <textarea class="note" rows="2"></textarea>
          <div class="note-hint"></div>
        </div>
      </div>

      <div class="pill" hidden>
        <button class="pill-main"></button>
      </div>
      <div class="menu card" popover="manual" hidden>
        <div class="menu-head"><div class="menu-title"></div><div class="menu-sub"></div></div>
        <button data-act="open">${icon('book')}<span data-t="menu.open"></span></button>
        <button data-act="sync">${icon('refresh')}<span data-t="menu.sync"></span></button>
        <button data-act="topic">${icon('folder')}<span data-t="menu.move"></span></button>
        <div class="menu-sep"></div>
        <button data-act="stop" class="danger">${icon('eyeOff')}<span data-t="menu.stop"></span></button>
      </div>

      <div class="overlay" popover="manual" hidden>
        <form class="sheet picker" autocomplete="off">
          <div class="sheet-head">
            <div class="brand">${BRAND_MARK}<span>ThirdNote</span></div>
            <button type="button" class="icon-btn close">${icon('x', 17)}</button>
          </div>
          <h3></h3>
          <div class="recent-wrap">
            <div class="label recent-label"></div>
            <label class="find" hidden>${icon('search', 15)}<input type="search" class="find-input" data-tp="picker.search"></label>
            <div class="recent"></div>
            <div class="no-match" hidden></div>
            <button type="button" class="see-all" hidden></button>
          </div>
          <div class="label new-label"></div>
          <div class="fields">
            <input name="topic" list="nm-topics" data-tp="picker.name">
            <input name="subject" list="nm-subjects" data-tp="picker.group">
          </div>
          <datalist id="nm-subjects"></datalist>
          <datalist id="nm-topics"></datalist>
          <div class="actions">
            <button type="button" class="btn cancel" data-t="common.cancel"></button>
            <button type="button" class="btn primary">${icon('plus', 15)}<span data-t="picker.create"></span></button>
          </div>
        </form>
      </div>

      <div class="cap" popover="manual" hidden>
        <div class="cap-box" hidden><span class="cap-size"></span></div>
        <div class="cap-bar card">
          ${icon('crop', 16)}<span data-t="cap.hint"></span>
          <button type="button" class="btn small cap-full">${icon('monitor', 14)}<span data-t="cap.full"></span></button>
          <button type="button" class="icon-btn cap-cancel">${icon('x', 16)}</button>
        </div>
      </div>

      <div class="overlay shot-overlay" popover="manual" hidden>
        <div class="sheet shot">
          <div class="sheet-head">
            <div class="brand">${BRAND_MARK}<span data-t="shot.title"></span></div>
            <button type="button" class="icon-btn close">${icon('x', 17)}</button>
          </div>
          <div class="shot-img"><img alt=""></div>
          <div class="moment" hidden>${icon('play', 13)}<span class="moment-text"></span></div>
          <textarea class="shot-note" rows="2" data-tp="shot.note"></textarea>
          <div class="actions">
            <span class="dest">${icon('folder', 13)}<span class="shot-dest"></span></span>
            <span class="grow"></span>
            <button type="button" class="btn cancel" data-t="common.cancel"></button>
            <button type="button" class="btn to-board">${icon('board', 15)}<span data-t="shot.toBoard"></span></button>
            <button type="button" class="btn primary save">${icon('check', 15)}<span data-t="common.save"></span></button>
          </div>
        </div>
      </div>

      <div class="overlay ask-overlay" popover="manual" hidden>
        <div class="sheet ask">
          <div class="sheet-head">
            <div class="brand">${BRAND_MARK}<span>ThirdNote</span></div>
            <button type="button" class="icon-btn close">${icon('x', 17)}</button>
          </div>
          <h3 class="ask-title"></h3>
          <p class="ask-text"></p>
          <div class="actions ask-actions"></div>
        </div>
      </div>

      <div class="toast" popover="manual" hidden><span class="toast-ic"></span><span class="toast-text"></span></div>`;
    document.documentElement.appendChild(host);

    // Keep sites from grabbing our keystrokes (chat sites focus their prompt box).
    for (const type of ['keydown', 'keyup', 'keypress', 'input']) {
      root.addEventListener(type, (e) => e.stopPropagation());
    }

    const tb = root.querySelector('.tb');
    const note = root.querySelector('.note');
    tb.addEventListener('mousedown', (e) => {
      if (e.target !== note) e.preventDefault();
    });
    tb.querySelectorAll('.dot').forEach((b) => {
      b.addEventListener('click', () => save(b.dataset.color));
      b.addEventListener('mouseenter', () => {
        ui.hint.innerHTML = `${NM.escapeHtml(NM.label(b.dataset.color))} <span class="kbd">${b.dataset.key}</span>`;
      });
      b.addEventListener('mouseleave', resetHint);
    });
    root.querySelector('.note-btn').addEventListener('click', openNote);
    note.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        save(lastColor);
      } else if (e.key === 'Escape') {
        hideToolbar();
      }
    });

    const menu = root.querySelector('.menu');
    root.querySelector('.pill-main').addEventListener('click', () => {
      if (!state.tracked) {
        startTracking().catch((err) => toast(err.message, 'error'));
      } else if (menu.hidden) {
        root.querySelector('.menu-title').textContent = state.source?.title || '';
        root.querySelector('.menu-sub').textContent = state.topic ? `${state.topic.subject} / ${state.topic.name}` : '';
        showLayer(menu);
      } else {
        hideLayer(menu);
      }
    });
    menu.addEventListener('click', async (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      hideLayer(menu);
      try {
        if (act === 'sync') {
          state.sent.clear();
          await syncNow({ force: true });
          toast(t('toast.synced', { n: state.total }));
        } else if (act === 'open') {
          await call('openReader', { source: state.sourceId });
        } else if (act === 'topic') {
          const topic = await pickTopic(t('picker.moveChat'));
          if (topic) {
            await call('updateSource', { id: state.sourceId, topicId: topic.id });
            toast(t('toast.moved', { name: topic.name }));
          }
        } else if (act === 'stop') {
          await call('setTracked', { id: state.sourceId, tracked: false });
          state.tracked = false;
          renderPill();
          toast(t('toast.stopped'));
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    const form = root.querySelector('.picker');
    const shotOverlay = root.querySelector('.shot-overlay');
    const capLayer = root.querySelector('.cap');
    const askOverlay = root.querySelector('.ask-overlay');
    return {
      host, root, tb, note, menu,
      noteWrap: root.querySelector('.note-wrap'),
      hint: root.querySelector('.hint'),
      destText: root.querySelector('.dest-text'),
      pill: root.querySelector('.pill'),
      main: root.querySelector('.pill-main'),
      toast: root.querySelector('.toast'),
      picker: {
        overlay: root.querySelector('.overlay'),
        form,
        heading: form.querySelector('h3'),
        recentWrap: form.querySelector('.recent-wrap'),
        recent: form.querySelector('.recent'),
        recentLabel: form.querySelector('.recent-label'),
        find: form.querySelector('.find'),
        findInput: form.querySelector('.find-input'),
        seeAll: form.querySelector('.see-all'),
        noMatch: form.querySelector('.no-match'),
        newLabel: form.querySelector('.new-label'),
        subject: form.elements.subject,
        topic: form.elements.topic,
        subjectList: root.querySelector('#nm-subjects'),
        topicList: root.querySelector('#nm-topics'),
        save: form.querySelector('.primary'),
        cancel: form.querySelector('.cancel'),
        close: form.querySelector('.close'),
      },
      ask: {
        overlay: askOverlay,
        title: askOverlay.querySelector('.ask-title'),
        text: askOverlay.querySelector('.ask-text'),
        actions: askOverlay.querySelector('.ask-actions'),
        close: askOverlay.querySelector('.close'),
      },
      capture: {
        layer: capLayer,
        box: capLayer.querySelector('.cap-box'),
        size: capLayer.querySelector('.cap-size'),
        full: capLayer.querySelector('.cap-full'),
        cancel: capLayer.querySelector('.cap-cancel'),
      },
      shot: {
        overlay: shotOverlay,
        img: shotOverlay.querySelector('img'),
        note: shotOverlay.querySelector('.shot-note'),
        toBoard: shotOverlay.querySelector('.to-board'),
        moment: shotOverlay.querySelector('.moment'),
        momentText: shotOverlay.querySelector('.moment-text'),
        dest: shotOverlay.querySelector('.shot-dest'),
        save: shotOverlay.querySelector('.save'),
        cancel: shotOverlay.querySelector('.cancel'),
        close: shotOverlay.querySelector('.close'),
      },
    };
  }

  function translateUi() {
    ui.root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    ui.root.querySelectorAll('[data-tp]').forEach((el) => { el.placeholder = t(el.dataset.tp); });
    ui.root.querySelector('.note-btn').title = t('tb.addNote');
    ui.note.placeholder = t('tb.notePlaceholder');
  }

  function showLayer(el) {
    if (el.dataset.translated !== NM.getLang()) {
      translateUi();
      el.dataset.translated = NM.getLang();
    }
    el.hidden = false;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      el.showPopover();
    } catch { /* popover unsupported: falls back to z-index */ }
  }

  function hideLayer(el) {
    el.hidden = true;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
    } catch { /* ignore */ }
  }

  function resetHint() {
    ui.hint.innerHTML = '<span class="kbd">1</span><span class="kbd">2</span><span class="kbd">3</span><span class="kbd">4</span>';
  }

  function openNote() {
    ui.noteWrap.hidden = false;
    ui.root.querySelector('.note-hint').textContent = t('tb.enterSaves', { label: NM.label(lastColor) });
    ui.note.focus();
  }

  // Shown just below the selection (sites put their own selection popups above it).
  function showToolbar(range) {
    const rects = range.getClientRects();
    const last = rects[rects.length - 1] || range.getBoundingClientRect();
    const all = range.getBoundingClientRect();
    ui.tb.querySelectorAll('.dot').forEach((b) => { b.title = `${NM.label(b.dataset.color)} (${b.dataset.key})`; });
    const dest = destination();
    ui.destText.textContent = dest ? dest.name : t('tb.chooseLater');
    ui.note.value = '';
    ui.noteWrap.hidden = true;
    resetHint();
    showLayer(ui.tb);
    const w = ui.tb.offsetWidth || 200;
    const h = ui.tb.offsetHeight || 70;
    let top = last.bottom + 10;
    if (top + h > innerHeight - 8) top = all.top - h - 10;
    const left = Math.min(Math.max(8, last.right - w / 2), innerWidth - w - 8);
    ui.tb.style.top = `${Math.max(8, top)}px`;
    ui.tb.style.left = `${left}px`;
  }

  function hideToolbar() {
    if (ui) hideLayer(ui.tb);
  }

  function renderPill() {
    if (!ui) return;
    const show = onChat();
    ui.pill.hidden = !show;
    if (!show) {
      hideLayer(ui.menu);
      return;
    }
    ui.pill.classList.toggle('on', state.tracked);
    if (state.tracked) {
      const n = state.highlights.length;
      ui.main.innerHTML = `<span class="live"></span><span>${NM.escapeHtml(t('pill.saved'))}</span>`
        + `<span class="count">${state.total ?? 0}</span>`
        + (n ? `<span class="count hl">${icon('highlighter', 12)}${n}</span>` : '');
      ui.main.title = t('pill.savedTip');
    } else {
      const share = state.pageType === 'share';
      ui.main.innerHTML = `${icon(share ? 'download' : 'pin', 15)}<span>${NM.escapeHtml(t(share ? 'pill.import' : 'pill.save'))}</span>`;
      ui.main.title = t(share ? 'pill.importTip' : 'pill.saveTip');
    }
  }

  let toastTimer = null;
  function toast(text, kind = 'ok', color) {
    if (!ui) return;
    const sw = color && COLORS.find((c) => c.id === color);
    ui.toast.querySelector('.toast-ic').innerHTML = kind === 'error'
      ? icon('x', 13)
      : sw ? `<span class="swatch" style="background:${sw.swatch}"></span>` : icon('check', 13);
    ui.toast.querySelector('.toast-text').textContent = text;
    ui.toast.classList.toggle('err', kind === 'error');
    showLayer(ui.toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hideLayer(ui.toast), kind === 'error' ? 4500 : 2600);
  }

  const BRAND_MARK = '<svg width="20" height="20" viewBox="0 0 1024 1024" aria-hidden="true"><rect width="1024" height="1024" rx="232" fill="#1C2645"/><g transform="translate(100 296) scale(0.82)"><rect x="600" y="60" width="340" height="420" fill="#F2C94C"/><rect x="40" y="0" width="900" height="96" rx="10" fill="#fff"/><rect x="160" y="96" width="120" height="250" fill="#fff"/><path d="M160 346H280L220 480Z" fill="#F2C94C"/><path d="M330 150H430L520 340V96H620V480H520L430 290V480H330Z" fill="#fff"/></g></svg>';

  const UI_CSS = `
    :host {
      all: initial;
      --surface: #ffffff; --surface-2: #f1efea; --hover: #e9e6de; --text: #1b1a18; --muted: #6b675f; --faint: #a29d93;
      --line: rgba(27,26,24,.07); --ink: #1f2a44; --ink-hover: #2b3a5e; --on-ink: #fff;
      --shadow: 0 0 0 .5px rgba(27,26,24,.06), 0 2px 6px rgba(27,26,24,.06), 0 18px 44px rgba(27,26,24,.16);
      --focus: #5b8def;
    }
    :host([data-theme="dark"]) {
      --surface: #1a1b1e; --surface-2: #232529; --hover: #2a2c31; --text: #ececee; --muted: #9a9ca5; --faint: #62646c;
      --line: rgba(255,255,255,.06); --ink: #f1f1f3; --ink-hover: #ffffff; --on-ink: #0d0e10;
      --shadow: 0 1px 0 rgba(255,255,255,.05) inset, 0 18px 48px rgba(0,0,0,.6);
    }
    @media (prefers-color-scheme: dark) {
      :host(:not([data-theme="light"])) {
        --surface: #1a1b1e; --surface-2: #232529; --hover: #2a2c31; --text: #ececee; --muted: #9a9ca5; --faint: #62646c;
        --line: rgba(255,255,255,.06); --ink: #f1f1f3; --ink-hover: #ffffff; --on-ink: #0d0e10;
        --shadow: 0 1px 0 rgba(255,255,255,.05) inset, 0 18px 48px rgba(0,0,0,.6);
      }
    }
    * { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Bengali", sans-serif; }
    [hidden] { display: none !important; }
    [popover] { margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; inset: auto; color: var(--text); }
    button { font: inherit; cursor: pointer; color: inherit; }
    .ic { display: block; flex: none; }
    .grow { flex: 1; }
    .kbd { display: inline-block; min-width: 17px; padding: 0 4px; border: 0; box-shadow: inset 0 -1px 0 var(--line); border-radius: 5px;
      font-size: 10.5px; line-height: 15px; text-align: center; color: var(--muted); background: var(--surface); }
    .card { background: var(--surface); border: 0; border-radius: 14px; box-shadow: var(--shadow); color: var(--text); }

    .tb { position: fixed; z-index: 2147483647; padding: 6px; min-width: 200px; animation: pop .14s ease-out; }
    @keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }
    .row { display: flex; align-items: center; gap: 2px; }
    .dot { width: 34px; height: 34px; border-radius: 10px; border: 0; background: transparent; padding: 0; display: grid; place-items: center; }
    .dot::before { content: ""; width: 20px; height: 20px; border-radius: 50%; background: var(--c);
      box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); transition: transform .12s; }
    .dot:hover { background: var(--hover); }
    .dot:hover::before { transform: scale(1.12); }
    .sep { width: 1px; height: 22px; background: var(--line); margin: 0 3px; }
    .icon-btn { width: 34px; height: 34px; border: 0; border-radius: 10px; background: transparent; display: grid; place-items: center; color: var(--muted); }
    .icon-btn:hover { background: var(--hover); color: var(--text); }
    .tb-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 6px 2px; border-top: 1px solid var(--line); margin-top: 4px; }
    .dest { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); min-width: 0; }
    .dest > span, .dest-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
    .hint { display: inline-flex; gap: 3px; align-items: center; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
    .note-wrap { padding: 6px 2px 2px; }
    .note { display: block; width: 260px; resize: none; border: 1px solid transparent; border-radius: 10px; background: var(--surface-2);
      color: var(--text); padding: 8px 10px; font-size: 13px; line-height: 1.45; outline: none; }
    .note:focus { border-color: var(--focus); box-shadow: 0 0 0 3px rgba(91,141,239,.2); }
    .note-hint { font-size: 11px; color: var(--muted); margin-top: 5px; }

    .pill { position: fixed; right: 18px; bottom: 96px; z-index: 2147483646; }
    .pill-main { display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 14px 0 12px; border-radius: 999px;
      background: #1f2a44; color: #fff; border: 0; font-size: 13px; font-weight: 600;
      box-shadow: 0 8px 24px rgba(20,18,15,.25); transition: transform .14s, box-shadow .14s; }
    .pill-main:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(20,18,15,.3); }
    .pill.on .pill-main { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
    .live { width: 8px; height: 8px; border-radius: 50%; background: #2fa565; box-shadow: 0 0 0 3px rgba(47,165,101,.2); }
    .count { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 650; color: var(--muted);
      background: var(--surface-2); border-radius: 999px; padding: 1px 8px; }
    .count.hl { color: #8a6500; background: rgba(242,201,76,.25); }
    .menu { position: fixed; z-index: 2147483647; right: 18px; bottom: 140px; width: 270px; padding: 6px; animation: pop .14s ease-out; }
    .menu-head { padding: 8px 10px 10px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
    .menu-title { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .menu-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .menu button { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: 0;
      padding: 9px 10px; border-radius: 9px; font-size: 13px; }
    .menu button .ic { color: var(--muted); }
    .menu button:hover { background: var(--hover); }
    .menu button.danger, .menu button.danger .ic { color: #c2412d; }
    .menu-sep { height: 1px; background: var(--line); margin: 4px 6px; }

    .overlay { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483647; background: rgba(15,14,12,.42);
      display: grid; place-items: center; backdrop-filter: blur(3px); animation: fade .15s ease-out; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    .sheet { background: var(--surface); color: var(--text); border-radius: 20px; padding: 16px 18px 18px; width: min(420px, calc(100vw - 32px));
      box-shadow: 0 30px 80px rgba(15,14,12,.4); display: grid; gap: 12px; border: 0; animation: rise .18s ease-out; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
    .sheet-head { display: flex; align-items: center; justify-content: space-between; margin: -4px -6px -2px 0; }
    .brand { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; color: var(--muted); }
    .sheet h3 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -.015em; }
    .label { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); margin-bottom: 7px; }
    .recent { display: grid; gap: 6px; max-height: 260px; overflow: auto; }
    .recent.tall { max-height: min(340px, 42vh); }
    .find { position: relative; display: block; margin-bottom: 8px; }
    .find .ic { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--faint); pointer-events: none; }
    .find input { width: 100%; font-size: 13.5px; padding: 9px 12px 9px 34px; border-radius: 11px; border: 1px solid transparent;
      color: var(--text); background: var(--surface-2); outline: none; }
    .find input:focus { border-color: var(--focus); background: var(--surface); box-shadow: 0 0 0 3px rgba(91,141,239,.2); }
    .see-all { display: block; width: 100%; margin-top: 6px; border: 0; background: transparent; color: var(--muted); font-size: 12.5px;
      font-weight: 600; padding: 7px; border-radius: 9px; }
    .see-all:hover { background: var(--hover); color: var(--text); }
    .no-match { font-size: 12.5px; color: var(--muted); padding: 8px 2px; }
    .topic-chip { display: flex; align-items: center; gap: 11px; width: 100%; text-align: left; border: 0;
      background: var(--surface-2); border-radius: 12px; padding: 8px 10px; transition: border-color .12s, background .12s; }
    .topic-chip:hover, .topic-chip:focus-visible { background: var(--hover); outline: none; }
    .topic-chip > .ic { color: var(--faint); }
    .chip-ic { width: 32px; height: 32px; border-radius: 9px; background: var(--surface-2); display: grid; place-items: center; color: var(--muted); flex: none; }
    .chip-text { display: grid; flex: 1; min-width: 0; }
    .chip-text .name { font-size: 13.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip-text .sub { font-size: 12px; color: var(--muted); }
    .fields { display: grid; gap: 8px; }
    .fields input { font-size: 14px; padding: 11px 12px; border-radius: 11px; border: 1px solid transparent; color: var(--text);
      background: var(--surface-2); outline: none; }
    .fields input:focus { border-color: var(--focus); background: var(--surface); box-shadow: 0 0 0 3px rgba(91,141,239,.2); }
    .actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 2px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; border-radius: 11px; padding: 0 14px; border: 0;
      background: var(--surface); color: var(--text); font-size: 13px; font-weight: 600; }
    .btn:hover { background: var(--hover); }
    .btn.small { height: 30px; padding: 0 10px; font-size: 12.5px; border-radius: 9px; }
    .btn.primary { background: var(--ink); color: var(--on-ink); border-color: var(--ink); }
    .btn.primary:hover { background: var(--ink-hover); }

    .cap { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483647; cursor: crosshair; background: rgba(15,14,12,.28); }
    .cap-box { position: fixed; border: 2px solid #fff; border-radius: 4px; box-shadow: 0 0 0 9999px rgba(15,14,12,.35); background: transparent; }
    .cap-size { position: absolute; right: 0; bottom: -26px; font-size: 11px; color: #fff; background: rgba(0,0,0,.65); padding: 2px 7px; border-radius: 6px; }
    .cap-bar { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
      padding: 6px 6px 6px 14px; font-size: 13px; cursor: default; white-space: nowrap; }
    .cap-bar > .ic { color: var(--muted); }

    .shot { width: min(480px, calc(100vw - 32px)); }
    .ask-text { margin: -4px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--muted); }
    .shot-img { border-radius: 12px; overflow: hidden; border: 0; background: var(--surface-2); max-height: 300px; display: grid; place-items: center; }
    .shot-img img { display: block; max-width: 100%; max-height: 300px; object-fit: contain; }
    .moment { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: #b42318;
      background: rgba(235,111,92,.12); border-radius: 999px; padding: 3px 10px; justify-self: start; }
    .shot-note { width: 100%; resize: none; border: 1px solid transparent; border-radius: 11px; background: var(--surface-2); color: var(--text);
      padding: 10px 12px; font-size: 13.5px; line-height: 1.45; outline: none; }
    .shot-note:focus { border-color: var(--focus); background: var(--surface); box-shadow: 0 0 0 3px rgba(91,141,239,.2); }

    .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647; display: flex; align-items: center;
      gap: 9px; background: #1d1c1a; color: #fff; padding: 10px 16px 10px 11px; border-radius: 13px; font-size: 13px; font-weight: 500;
      box-shadow: 0 12px 32px rgba(15,14,12,.32); max-width: calc(100vw - 32px); animation: rise .18s ease-out; }
    .toast-ic { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: rgba(255,255,255,.14); color: #8fdcae; flex: none; }
    .toast .swatch { width: 11px; height: 11px; border-radius: 50%; }
    .toast.err { background: #8f2a1d; }
    .toast.err .toast-ic { color: #fff; }
  `;
})();
