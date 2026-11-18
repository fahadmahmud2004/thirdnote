// The Library panel: browse and search everything, write notes, and review as flashcards.
const vscode = require('vscode');
const crypto = require('crypto');
const { INBOX } = require('./store');

class Library {
  constructor(context, store, actions) {
    this.context = context;
    this.store = store;
    this.actions = actions; // callbacks shared with the commands
    this.panel = null;
    this.pending = null;
    store.onDidChange(() => this.post());
  }

  show(intent = {}) {
    this.pending = intent;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.post();
      return;
    }
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('thirdnote.library', 'ThirdNote', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [media],
    });
    this.panel.iconPath = vscode.Uri.joinPath(media, 'icon.png');
    this.panel.webview.html = this.html(this.panel.webview, media);
    this.panel.onDidDispose(() => { this.panel = null; });
    this.panel.webview.onDidReceiveMessage((m) => this.receive(m));
  }

  post() {
    if (!this.panel) return;
    const d = this.store.data;
    this.panel.webview.postMessage({
      type: 'state',
      data: { collections: d.collections, items: d.items, collecting: this.store.collecting },
      intent: this.pending,
    });
    this.pending = null;
  }

  async receive(m) {
    const s = this.store;
    switch (m.type) {
      case 'ready': this.post(); break;
      case 'open': this.actions.openItem(m.id, { fromLibrary: true }); break;
      case 'delete': await this.actions.deleteItem(m.id); break;
      case 'update': {
        const patch = {};
        for (const k of ['title', 'note', 'text', 'color', 'collectionId']) if (k in m.patch) patch[k] = m.patch[k];
        s.updateItem(m.id, patch);
        break;
      }
      case 'createNote': {
        const it = s.addItem({ kind: 'note', title: m.title || '', note: m.note || '', color: m.color || 'yellow', collectionId: m.collectionId || s.collecting || INBOX });
        this.panel && this.panel.webview.postMessage({ type: 'created', id: it.id });
        break;
      }
      case 'reviewed': {
        const it = s.item(m.id);
        if (!it) break;
        const r = { seen: 0, known: 0, last: 0, ...(it.review || {}) };
        r.seen += 1; if (m.known) r.known += 1; r.last = Date.now();
        s.updateItem(m.id, { review: r }, { quiet: true });
        break;
      }
      case 'copy': {
        const it = s.item(m.id);
        if (it) { await vscode.env.clipboard.writeText(it.kind === 'note' ? it.note : it.text); vscode.window.setStatusBarMessage('ThirdNote: copied', 2000); }
        break;
      }
      case 'export': this.actions.exportMarkdown(m.collectionId || null); break;
      case 'newCollection': {
        const c = await this.actions.newCollection();
        if (c && this.panel) this.panel.webview.postMessage({ type: 'select', collectionId: c.id });
        break;
      }
      case 'collect': s.setCollecting(m.collectionId || null); break;
      case 'command': if (/^thirdnote\.[a-zA-Z]+$/.test(m.command)) vscode.commands.executeCommand(m.command); break;
    }
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'library.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'library.js'));
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
<title>ThirdNote</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

module.exports = { Library };
