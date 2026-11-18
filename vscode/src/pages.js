// Shows the ThirdNote pages (library, reader with board and review, settings) in VS Code editor tabs.
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PAGES = { home: 'home/home.html', reader: 'reader/reader.html', options: 'options/options.html' };

// "reader.html?x", "../home/home.html#/c/1" -> { page, search, hash }
function resolvePage(raw, fromPage) {
  const fromDir = path.posix.dirname(PAGES[fromPage] || PAGES.home);
  const m = String(raw).match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  const file = path.posix.normalize(path.posix.join(fromDir, m[1]));
  const page = Object.keys(PAGES).find((k) => PAGES[k] === file);
  return page ? { page, search: m[2] || '', hash: m[3] || '' } : null;
}

class Pages {
  constructor(context, core, hooks) {
    this.context = context;
    this.core = core;
    this.hooks = hooks; // { openCode(uri, highlightId) }
    this.webRoot = vscode.Uri.joinPath(context.extensionUri, 'web');
    this.media = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.panels = new Set();
    this.main = null;
    this.stats = { rpc: 0, methods: [], errors: [] }; // for diagnosis and tests
    core.onDidChange((msg) => this.broadcast({ type: 'broadcast', msg }));
    core.onDidChangeStorage((items) => this.broadcast({ type: 'storageChanged', items }));
  }

  broadcast(m) { for (const p of this.panels) p.panel.webview.postMessage(m); }

  // Opens a page in the main ThirdNote tab (or a new tab when asked).
  show(page, search = '', hash = '', { newPanel = false, column } = {}) {
    let entry = !newPanel && this.main && this.panels.has(this.main) ? this.main : null;
    if (!entry) {
      const panel = vscode.window.createWebviewPanel('thirdnote.page', 'ThirdNote', column || vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: true,
        localResourceRoots: [this.webRoot, this.media],
      });
      panel.iconPath = vscode.Uri.joinPath(this.media, 'icon.png');
      entry = { panel, page, search, hash };
      this.panels.add(entry);
      if (!newPanel || !this.main) this.main = entry;
      panel.onDidDispose(() => { this.panels.delete(entry); if (this.main === entry) this.main = null; });
      panel.webview.onDidReceiveMessage((m) => this.receive(entry, m));
    }
    Object.assign(entry, { page, search, hash });
    entry.panel.webview.html = this.html(entry.panel.webview, page, search, hash);
    entry.panel.reveal(entry.panel.viewColumn || column, false);
    return entry;
  }

  html(webview, page, search, hash) {
    const file = path.join(this.context.extensionPath, 'web', PAGES[page]);
    let html = fs.readFileSync(file, 'utf8');
    const nonce = crypto.randomBytes(16).toString('base64');
    const dirUri = webview.asWebviewUri(vscode.Uri.joinPath(this.webRoot, path.posix.dirname(PAGES[page]), '/'));
    const root = webview.asWebviewUri(vscode.Uri.joinPath(this.webRoot, '/'));
    const shim = webview.asWebviewUri(vscode.Uri.joinPath(this.media, 'shim.js'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data: blob: https: http:`,
      `media-src ${webview.cspSource} data: blob: https:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `connect-src ${webview.cspSource} data: blob:`,
    ].join('; ');
    const boot = { page, search, hash, root: String(root), storage: this.core.storage };
    const head = `<base href="${dirUri}">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<script nonce="${nonce}">window.TN_BOOT = ${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>
<script nonce="${nonce}" src="${shim}"></script>`;
    html = html.replace(/<meta[^>]+Content-Security-Policy[^>]*>/i, '');
    html = html.replace(/<head>/i, `<head>\n${head}`);
    html = html.replace(/<script(?![^>]*nonce=)/g, `<script nonce="${nonce}"`);
    return html;
  }

  async receive(entry, m) {
    switch (m.type) {
      case 'rpc': {
        const msg = m.msg || {};
        let res;
        this.stats.rpc++; this.stats.methods.push(msg.method);
        if (msg.type === 'nm-rpc') res = await this.core.rpc(msg.method, msg.args);
        else res = { ok: false, error: 'Not available in VS Code' };
        entry.panel.webview.postMessage({ type: 'rpcResult', id: m.id, res });
        break;
      }
      case 'storageSet': this.core.setStorage(m.items || {}); break;
      case 'storageRemove': this.core.removeStorage(m.keys || []); break;
      case 'state': entry.search = m.search || ''; entry.hash = m.hash || ''; break;
      case 'title': if (m.title) entry.panel.title = m.title.replace(/\s*[·|-]\s*ThirdNote$/, '') || 'ThirdNote'; break;
      case 'nav': {
        const r = resolvePage(m.url, m.from || entry.page);
        if (r) this.show(r.page, r.search, r.hash);
        break;
      }
      case 'open': this.openUrl(m.url, m.from || entry.page, m.newPanel); break;
      case 'download': await this.saveDownload(m.name, Buffer.from(m.data || '', 'base64')); break;
      case 'print': await this.printPdf(entry, m); break;
      case 'jsError': this.stats.errors.push(`${entry.page}: ${m.message}`); console.error('[ThirdNote page]', entry.page, m.message); break;
      case 'error': vscode.window.showErrorMessage(`ThirdNote: ${m.message}`); break;
    }
  }

  openUrl(url, from, newPanel = true) {
    if (!url) return;
    if (/\.html(\?|#|$)/.test(url) && !/^[a-z]+:/i.test(url)) {
      const r = resolvePage(url, from);
      if (r) this.show(r.page, r.search, r.hash, { newPanel, column: vscode.ViewColumn.Beside });
      return;
    }
    let uri;
    try { uri = vscode.Uri.parse(url, true); } catch { return; }
    if (uri.scheme === 'http' || uri.scheme === 'https' || uri.scheme === 'mailto') vscode.env.openExternal(uri);
    else if (uri.scheme === 'file' || uri.scheme === 'vscode-remote' || uri.scheme === 'untitled') this.hooks.openCode(uri);
  }

  async saveDownload(name, buf) {
    const folder = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri) || vscode.Uri.file(os.homedir());
    const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(folder, name), title: 'Save from ThirdNote' });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, buf);
    const open = /\.(md|json|txt)$/i.test(target.path) ? 'Open' : undefined;
    const pick = await vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}`, ...(open ? [open] : []));
    if (pick) vscode.window.showTextDocument(target);
  }

  // PDF: the page's own print layout, printed by a Chromium browser on this computer when there is one,
  // otherwise opened in the default browser with the print dialog.
  async printPdf(entry, m) {
    const pageDir = path.join(this.context.extensionPath, 'web', path.dirname(PAGES[entry.page]));
    const src = fs.readFileSync(path.join(pageDir, path.basename(PAGES[entry.page])), 'utf8');
    const cssFiles = [...src.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((x) => path.join(pageDir, x[1]));
    const css = cssFiles.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
    const attrs = (o) => Object.entries(o || {}).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
    const webBase = entry.panel.webview.asWebviewUri(this.webRoot).toString();
    let body = String(m.body || '').replace(/<script[\s\S]*?<\/script>/gi, '');
    body = body.split(webBase).join(vscode.Uri.file(path.join(this.context.extensionPath, 'web')).toString());
    const title = (m.title || 'ThirdNote').replace(/[<>]/g, '');
    const doc = `<!doctype html><html${attrs(m.htmlAttrs)}><head><meta charset="utf-8"><base href="${vscode.Uri.file(pageDir + path.sep).toString()}"><title>${title}</title><style>${css}</style></head><body${attrs(m.bodyAttrs)}>${body}</body></html>`;
    const tmp = path.join(os.tmpdir(), `thirdnote-print-${Date.now()}.html`);
    fs.writeFileSync(tmp, doc);

    const browser = findChromium();
    if (browser) {
      const folder = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri) || vscode.Uri.file(os.homedir());
      const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'ThirdNote';
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(folder, `${safe}.pdf`), filters: { PDF: ['pdf'] }, title: 'Export PDF' });
      if (!target) return;
      const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'ThirdNote: making the PDF...' }, () => new Promise((resolve) => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'thirdnote-pdf-'));
        execFile(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--user-data-dir=${profile}`, `--print-to-pdf=${target.fsPath}`, vscode.Uri.file(tmp).toString()],
          { timeout: 60000 }, (err) => { fs.rmSync(profile, { recursive: true, force: true }); resolve(!err && fs.existsSync(target.fsPath)); });
      }));
      if (ok) {
        const pick = await vscode.window.showInformationMessage(`PDF saved: ${path.basename(target.fsPath)}`, 'Open PDF', 'Show in Folder');
        if (pick === 'Open PDF') vscode.env.openExternal(target);
        else if (pick === 'Show in Folder') vscode.commands.executeCommand('revealFileInOS', target);
        return;
      }
    }
    // No browser to print with here: let the default browser print it.
    fs.writeFileSync(tmp, doc.replace('</body>', '<script>addEventListener("load",()=>setTimeout(()=>print(),400))</script></body>'));
    vscode.env.openExternal(vscode.Uri.file(tmp));
    vscode.window.showInformationMessage('ThirdNote opened the page in your browser. Choose "Save as PDF" in the print dialog.');
  }
}

function findChromium() {
  const c = [];
  if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium', 'Arc', 'Vivaldi']) {
      c.push(`/Applications/${app}.app/Contents/MacOS/${app}`, path.join(os.homedir(), `Applications/${app}.app/Contents/MacOS/${app}`));
    }
  } else if (process.platform === 'win32') {
    const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) c.push(path.join(r, 'Google/Chrome/Application/chrome.exe'), path.join(r, 'Microsoft/Edge/Application/msedge.exe'), path.join(r, 'BraveSoftware/Brave-Browser/Application/brave.exe'));
  } else {
    for (const d of ['/usr/bin', '/usr/local/bin', '/snap/bin']) for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) c.push(path.join(d, b));
  }
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

module.exports = { Pages, resolvePage };
