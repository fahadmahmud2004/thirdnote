// Runs before the ThirdNote pages inside a VS Code webview. It gives them the few browser-extension calls they use
// (messaging, storage, opening pages) and routes those, plus downloads and printing, through the extension.
(function () {
  const vscode = acquireVsCodeApi();
  const boot = window.TN_BOOT || {};
  let seq = 0;
  const pending = new Map();
  const msgListeners = [];
  const storageListeners = [];
  const store = { ...(boot.storage || {}) };

  const TN = (window.TN = {
    search: boot.search || '',
    page: boot.page,
    open(url, opts = {}) { if (url) vscode.postMessage({ type: 'open', url: String(url), from: boot.page, newPanel: opts.newPanel !== false }); },
    nav(url) { vscode.postMessage({ type: 'nav', url: String(url), from: boot.page }); },
    replace(search) { TN.search = search; vscode.postMessage({ type: 'state', search, hash: location.hash }); },
  });
  if (boot.hash) { try { history.replaceState(null, '', boot.hash); } catch { location.hash = boot.hash; } }
  addEventListener('hashchange', () => vscode.postMessage({ type: 'state', search: TN.search, hash: location.hash }));

  const pick = (keys) => {
    if (keys == null) return { ...store };
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
    return Object.fromEntries(Object.keys(keys).map((k) => [k, k in store ? structuredClone(store[k]) : keys[k]]));
  };

  window.chrome = {
    runtime: {
      id: 'thirdnote-vscode',
      getURL: (p) => new URL(String(p).replace(/^\//, ''), boot.root).href,
      sendMessage(msg) {
        return new Promise((resolve) => {
          const id = ++seq;
          pending.set(id, resolve);
          vscode.postMessage({ type: 'rpc', id, msg });
        });
      },
      onMessage: { addListener: (f) => msgListeners.push(f), removeListener: (f) => { const i = msgListeners.indexOf(f); if (i >= 0) msgListeners.splice(i, 1); } },
    },
    storage: {
      local: {
        get: (keys) => Promise.resolve(pick(keys)),
        set(items) {
          const changes = {};
          for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = structuredClone(v); }
          vscode.postMessage({ type: 'storageSet', items });
          for (const f of storageListeners) try { f(changes, 'local'); } catch (e) { console.error(e); }
          return Promise.resolve();
        },
        remove(keys) {
          for (const k of [].concat(keys)) delete store[k];
          vscode.postMessage({ type: 'storageRemove', keys: [].concat(keys) });
          return Promise.resolve();
        },
      },
      onChanged: { addListener: (f) => storageListeners.push(f) },
    },
  };

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'rpcResult') {
      const f = pending.get(m.id);
      if (f) { pending.delete(m.id); f(m.res); }
    } else if (m.type === 'broadcast') {
      for (const f of msgListeners) try { f(m.msg, {}, () => {}); } catch (err) { console.error(err); }
    } else if (m.type === 'storageChanged') {
      const changes = {};
      for (const [k, v] of Object.entries(m.items || {})) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
      for (const f of storageListeners) try { f(changes, 'local'); } catch (err) { console.error(err); }
    } else if (m.type === 'go') {
      location.hash = m.hash || '';
    }
  });

  // Downloads (Markdown, backups): hand the file to VS Code, which asks where to save it.
  async function download(a) {
    const href = a.getAttribute('href') || a.href;
    try {
      const buf = await (await fetch(href)).arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      vscode.postMessage({ type: 'download', name: a.download || 'thirdnote', data: btoa(bin) });
    } catch (err) {
      vscode.postMessage({ type: 'error', message: `Could not save the file: ${err.message}` });
    }
  }
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download')) return void download(this);
    return nativeClick.call(this);
  };

  // Links: pages and hashes stay inside VS Code; web links open in the browser; code links open the file.
  window.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented) return;
    const raw = a.getAttribute('href');
    if (!raw) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (a.closest('[data-rich]')) return; // the editor opens these itself on pointerdown
    if (a.hasAttribute('download') || raw.startsWith('blob:')) return void download(a);
    if (raw.startsWith('#')) { location.hash = raw; return; }
    if (/\.html(\?|#|$)/.test(raw) && !/^[a-z]+:/i.test(raw)) {
      if (e.ctrlKey || e.metaKey || a.target === '_blank') TN.open(raw);
      else TN.nav(raw);
      return;
    }
    TN.open(raw);
  }, true);

  addEventListener('error', (e) => vscode.postMessage({ type: 'jsError', message: `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})` }));
  addEventListener('unhandledrejection', (e) => vscode.postMessage({ type: 'jsError', message: String((e.reason && (e.reason.stack || e.reason.message)) || e.reason) }));

  window.open = (url) => { TN.open(url); return null; };

  // PDF: the extension prints this page with its print styles.
  window.print = () => {
    vscode.postMessage({
      type: 'print',
      title: document.title,
      htmlAttrs: Object.fromEntries([...document.documentElement.attributes].map((x) => [x.name, x.value])),
      bodyAttrs: Object.fromEntries([...document.body.attributes].map((x) => [x.name, x.value])),
      body: document.body.innerHTML,
    });
  };

  // Keep the tab title in step with the page.
  new MutationObserver(() => vscode.postMessage({ type: 'title', title: document.title })).observe(document.querySelector('title') || document.head, { childList: true, subtree: true, characterData: true });
})();
