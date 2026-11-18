// Sidebar views: every collection with its items, and the highlights of the open file.
const vscode = require('vscode');
const { INBOX, COLOR_LABELS } = require('./store');

const KIND_ICON = { highlight: 'circle-filled', snippet: 'code', file: 'file-code', note: 'note', clip: 'clippy' };
const KIND_LABEL = { highlight: 'Highlight', snippet: 'Snippet', file: 'File', note: 'Note', clip: 'Clip' };
const MIME = 'application/vnd.code.tree.thirdnote.collections';

function firstLine(s, max = 70) {
  const line = String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 1)}...` : line;
}

function itemLabel(it) {
  if (it.title) return firstLine(it.title);
  if (it.kind === 'note') return firstLine(it.note) || 'Untitled note';
  return firstLine(it.text) || KIND_LABEL[it.kind] || 'Item';
}

function itemDescription(it) {
  if (it.source && it.source.path) {
    const line = it.source.start ? `:${it.source.start.line + 1}` : '';
    const name = it.source.path.split(/[\\/]/).pop();
    return `${name}${line}${it.source.detached ? ' (moved or deleted)' : ''}`;
  }
  return KIND_LABEL[it.kind] || '';
}

function itemTooltip(it, store) {
  const md = new vscode.MarkdownString(undefined, true);
  md.supportThemeIcons = true;
  md.appendMarkdown(`**${escapeMd(itemLabel(it))}**  \n`);
  md.appendMarkdown(`$(${KIND_ICON[it.kind] || 'note'}) ${KIND_LABEL[it.kind] || ''} · ${COLOR_LABELS[it.color] || ''} · ${escapeMd(store.collectionName(it.collectionId))}`);
  if (it.source && it.source.path) md.appendMarkdown(`  \n$(file) ${escapeMd(it.source.path)}${it.source.start ? `:${it.source.start.line + 1}` : ''}`);
  if (it.note && it.kind !== 'note') md.appendMarkdown(`\n\n${escapeMd(it.note)}`);
  const body = it.kind === 'note' ? it.note : it.text;
  if (body) {
    const clipped = body.length > 1200 ? `${body.slice(0, 1200)}\n...` : body;
    if (it.kind === 'note') md.appendMarkdown(`\n\n${escapeMd(clipped)}`);
    else md.appendCodeblock(clipped, it.language || '');
  }
  md.appendMarkdown(`\n\n_${new Date(it.createdAt).toLocaleString()}_`);
  return md;
}

function escapeMd(s) {
  return String(s || '').replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}

function makeItemNode(it, store) {
  const t = new vscode.TreeItem(itemLabel(it), vscode.TreeItemCollapsibleState.None);
  t.id = `item:${it.id}`;
  t.description = itemDescription(it);
  t.tooltip = itemTooltip(it, store);
  t.iconPath = new vscode.ThemeIcon(KIND_ICON[it.kind] || 'note', new vscode.ThemeColor(`thirdnote.${it.color || 'yellow'}Mark`));
  t.contextValue = `item-${it.kind}`;
  t.command = { command: 'thirdnote.openItem', title: 'Open', arguments: [it.id] };
  return t;
}

class CollectionsTree {
  constructor(store) {
    this.store = store;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    store.onDidChange(() => this._emitter.fire());
    this.dropMimeTypes = [MIME];
    this.dragMimeTypes = [MIME];
  }

  getTreeItem(node) {
    if (node.type === 'item') {
      const it = this.store.item(node.id);
      return it ? makeItemNode(it, this.store) : new vscode.TreeItem('(removed)');
    }
    const isInbox = node.id === INBOX;
    const count = this.store.itemsIn(node.id).length;
    const collecting = this.store.collecting === node.id;
    const t = new vscode.TreeItem(
      isInbox ? 'Inbox' : this.store.collectionName(node.id),
      count ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    t.id = `col:${node.id}`;
    t.description = `${count}${collecting ? ' · collecting' : ''}`;
    t.iconPath = new vscode.ThemeIcon(collecting ? 'target' : isInbox ? 'inbox' : 'folder', collecting ? new vscode.ThemeColor('thirdnote.yellowMark') : undefined);
    t.contextValue = isInbox ? 'collection-inbox' : 'collection';
    t.tooltip = collecting ? 'New saves go here' : undefined;
    return t;
  }

  getChildren(node) {
    if (!node) {
      return [{ type: 'collection', id: INBOX }, ...this.store.collections.map((c) => ({ type: 'collection', id: c.id }))];
    }
    if (node.type === 'collection') return this.store.itemsIn(node.id).map((it) => ({ type: 'item', id: it.id }));
    return [];
  }

  getParent(node) {
    if (node.type === 'item') {
      const it = this.store.item(node.id);
      return { type: 'collection', id: (it && it.collectionId) || INBOX };
    }
    return undefined;
  }

  handleDrag(nodes, dataTransfer) {
    const ids = nodes.filter((n) => n.type === 'item').map((n) => n.id);
    if (ids.length) dataTransfer.set(MIME, new vscode.DataTransferItem(ids));
  }

  async handleDrop(target, dataTransfer) {
    const entry = dataTransfer.get(MIME);
    if (!entry || !target) return;
    const ids = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
    const colId = target.type === 'collection' ? target.id : ((this.store.item(target.id) || {}).collectionId || INBOX);
    for (const id of ids || []) this.store.updateItem(id, { collectionId: colId });
  }
}

class ThisFileTree {
  constructor(store, highlights) {
    this.store = store;
    this.highlights = highlights;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    const fire = () => this._emitter.fire();
    store.onDidChange(fire);
    vscode.window.onDidChangeActiveTextEditor(fire);
  }

  getTreeItem(id) {
    const it = this.store.item(id);
    if (!it) return new vscode.TreeItem('(removed)');
    const t = makeItemNode(it, this.store);
    t.id = `file:${it.id}`;
    t.description = it.source && it.source.start ? `line ${it.source.start.line + 1}` : '';
    if (it.note) t.description += ` · ${firstLine(it.note, 40)}`;
    return t;
  }

  getChildren(id) {
    if (id) return [];
    const ed = vscode.window.activeTextEditor;
    if (!ed) return [];
    const placed = this.highlights.rangesFor(ed.document).map((r) => r.item.id);
    const placedSet = new Set(placed);
    const rest = this.store.itemsForUri(ed.document.uri.toString()).filter((i) => !placedSet.has(i.id)).map((i) => i.id);
    return [...placed, ...rest];
  }
}

module.exports = { CollectionsTree, ThisFileTree, itemLabel, firstLine, KIND_LABEL };
