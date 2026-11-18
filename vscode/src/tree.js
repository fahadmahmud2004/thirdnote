// Sidebar: collections with their saved files and notes, and the highlights in the open file.
const vscode = require('vscode');

const firstLine = (s, max = 70) => {
  const line = String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 1)}...` : line;
};

class CollectionsTree {
  constructor(core) {
    this.core = core;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    let t;
    const fire = () => { clearTimeout(t); t = setTimeout(() => this._emitter.fire(), 120); };
    core.onDidChange(fire);
    core.onDidChangeStorage(fire);
  }

  async getChildren(node) {
    const db = this.core.db;
    if (!node) {
      const topics = await this.core.topics();
      return topics.map((t) => ({ type: 'topic', id: t.id, topic: t }));
    }
    if (node.type === 'topic') {
      return [...db.raw('sources').values()]
        .filter((s) => s.topicId === node.id && !s.deletedAt)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map((s) => ({ type: 'source', id: s.id, source: s }));
    }
    if (node.type === 'source') {
      const hls = [...db.raw('highlights').values()].filter((h) => h.sourceId === node.id).sort((a, b) => (a.code?.start?.line ?? 0) - (b.code?.start?.line ?? 0) || a.createdAt - b.createdAt);
      if ((node.source.site === 'VS Code' || node.source.site === 'code')) return hls.map((h) => ({ type: 'hl', id: h.id, hl: h }));
      return [];
    }
    return [];
  }

  getTreeItem(node) {
    const db = this.core.db;
    const st = this.core.storage;
    if (node.type === 'topic') {
      const t = node.topic;
      const n = [...db.raw('sources').values()].filter((s) => s.topicId === t.id && !s.deletedAt).length;
      const collecting = st.collecting && st.activeTopicId === t.id;
      const item = new vscode.TreeItem(t.name, n ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = `topic:${t.id}`;
      item.description = `${t.subject}${collecting ? ' · collecting' : ''}`;
      item.iconPath = new vscode.ThemeIcon(collecting ? 'target' : 'folder', collecting ? new vscode.ThemeColor('thirdnote.yellowMark') : undefined);
      item.contextValue = 'topic';
      item.tooltip = `${t.subject} / ${t.name}`;
      return item;
    }
    if (node.type === 'source') {
      const s = node.source;
      const code = s.site === 'VS Code' || s.site === 'code';
      const hlCount = [...db.raw('highlights').values()].filter((h) => h.sourceId === s.id).length;
      const msgCount = [...db.raw('messages').values()].filter((m) => m.sourceId === s.id && !m.excluded).length;
      const item = new vscode.TreeItem(code ? s.title.split(/[\\/]/).pop() : s.title, code && hlCount ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = `src:${s.id}`;
      item.description = code ? `${s.title.includes('/') ? s.title.slice(0, s.title.lastIndexOf('/')) : ''}` : `${msgCount} ${s.kind === 'note' ? 'notes' : 'items'}`;
      item.iconPath = new vscode.ThemeIcon(code ? 'file-code' : s.kind === 'note' ? 'notebook' : s.kind === 'chat' ? 'comment-discussion' : 'globe');
      item.contextValue = 'source';
      item.tooltip = s.url ? `${s.title}\n${s.url}` : s.title;
      item.command = { command: 'thirdnote.openSource', title: 'Open', arguments: [s.id] };
      return item;
    }
    const h = node.hl;
    const item = new vscode.TreeItem(firstLine(h.note) || firstLine(h.text), vscode.TreeItemCollapsibleState.None);
    item.id = `hl:${h.id}`;
    item.description = h.code && h.code.start ? `line ${h.code.start.line + 1}${h.code.detached ? ' (moved or deleted)' : ''}` : '';
    item.iconPath = new vscode.ThemeIcon(h.code ? 'circle-filled' : 'code', new vscode.ThemeColor(`thirdnote.${h.color || 'yellow'}Mark`));
    const md = new vscode.MarkdownString();
    if (h.note) md.appendText(`${h.note}\n\n`);
    md.appendCodeblock(String(h.text || '').slice(0, 1200), (h.code && h.code.language) || '');
    item.tooltip = md;
    item.contextValue = h.code ? 'item-highlight' : 'item-clip';
    item.command = { command: 'thirdnote.openItem', title: 'Open', arguments: [h.id] };
    return item;
  }

  getParent(node) {
    if (node.type === 'hl') { const s = this.core.db.raw('sources').get(node.hl.sourceId); return s ? { type: 'source', id: s.id, source: s } : undefined; }
    if (node.type === 'source') { return { type: 'topic', id: node.source.topicId, topic: { id: node.source.topicId, name: '', subject: '' } }; }
    return undefined;
  }
}

class ThisFileTree {
  constructor(core, highlights) {
    this.core = core;
    this.highlights = highlights;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    const fire = () => this._emitter.fire();
    core.onDidChange(fire);
    vscode.window.onDidChangeActiveTextEditor(fire);
  }

  getChildren(id) {
    if (id) return [];
    const ed = vscode.window.activeTextEditor;
    if (!ed) return [];
    const placed = this.highlights.rangesFor(ed.document).map((r) => r.item.id);
    const set = new Set(placed);
    return [...placed, ...this.core.itemsForUri(ed.document.uri.toString()).filter((i) => !set.has(i.id)).map((i) => i.id)];
  }

  getTreeItem(id) {
    const it = this.core.item(id);
    if (!it) return new vscode.TreeItem('(removed)');
    const t = new vscode.TreeItem(firstLine(it.note) || firstLine(it.text), vscode.TreeItemCollapsibleState.None);
    t.id = `file:${id}`;
    t.description = it.source && it.source.start ? `line ${it.source.start.line + 1}` : '';
    t.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(`thirdnote.${it.color}Mark`));
    t.contextValue = 'item-highlight';
    t.command = { command: 'thirdnote.openItem', title: 'Open', arguments: [id] };
    return t;
  }
}

module.exports = { CollectionsTree, ThisFileTree, firstLine };
