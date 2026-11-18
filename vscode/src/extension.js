// ThirdNote for VS Code: highlight code, keep notes and snippets in collections, review them later.
const vscode = require('vscode');
const { Store, COLORS, COLOR_LABELS, INBOX } = require('./store');
const { Highlights, displayPath, CONTEXT_CHARS } = require('./highlights');
const { CollectionsTree, ThisFileTree, itemLabel, KIND_LABEL } = require('./tree');
const { Library } = require('./library');
const { toMarkdown } = require('./export');

const MAX_SAVE = 2 * 1024 * 1024; // keep single saves under 2 MB of text

let current = null;

async function activate(context) {
  const store = new Store(context);
  current = store;
  await store.load();

  const highlights = new Highlights(store);
  highlights.activate();
  context.subscriptions.push(highlights);

  const collectionsTree = new CollectionsTree(store);
  const collectionsView = vscode.window.createTreeView('thirdnote.collections', {
    treeDataProvider: collectionsTree,
    dragAndDropController: collectionsTree,
    canSelectMany: true,
    showCollapseAll: true,
  });
  const thisFileView = vscode.window.createTreeView('thirdnote.thisFile', { treeDataProvider: new ThisFileTree(store, highlights) });
  context.subscriptions.push(collectionsView, thisFileView);

  // Status bar: where new saves go.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'thirdnote.setCollecting';
  const updateStatus = () => {
    const id = store.collecting;
    status.text = id ? `$(target) ${store.collectionName(id)}` : '$(bookmark) ThirdNote';
    status.tooltip = id ? `ThirdNote is collecting into "${store.collectionName(id)}". Click to change.` : 'ThirdNote: choose a collection for new saves';
    const total = store.items.length;
    collectionsView.badge = undefined;
    collectionsView.description = total ? `${total} saved` : undefined;
    status.show();
  };
  updateStatus();
  context.subscriptions.push(status, store.onDidChange(updateStatus));

  // Context key for the editor menu.
  const updateCursorKey = () => {
    const ed = vscode.window.activeTextEditor;
    const on = !!ed && highlights.at(ed.document, ed.selection.active).length > 0;
    vscode.commands.executeCommand('setContext', 'thirdnote.cursorOnHighlight', on);
  };
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(updateCursorKey),
    vscode.window.onDidChangeActiveTextEditor(updateCursorKey),
  );

  // ---------- helpers ----------
  const idOf = (arg) => {
    if (!arg) return null;
    if (typeof arg === 'string') return arg;
    if (arg.type === 'item' || arg.type === 'collection') return arg.id;
    if (typeof arg.id === 'string') return arg.id.replace(/^(item|file|col):/, '');
    return null;
  };
  const selectedItemIds = (arg, all) => {
    const list = Array.isArray(all) && all.length ? all : [arg];
    return list.map(idOf).filter((id) => id && store.item(id));
  };
  const targetCollection = () => store.collecting || INBOX;

  async function pickColor(placeHolder = 'Highlight colour') {
    const cfg = vscode.workspace.getConfiguration('thirdnote');
    if (!cfg.get('askForColor', true)) return cfg.get('defaultColor', 'yellow');
    const def = cfg.get('defaultColor', 'yellow');
    const order = [def, ...COLORS.filter((c) => c !== def)];
    const picked = await vscode.window.showQuickPick(
      order.map((c, i) => ({ label: `$(circle-filled) ${COLOR_LABELS[c]}`, description: i === 0 ? 'default' : '', color: c, iconPath: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(`thirdnote.${c}Mark`)) })),
      { placeHolder, title: 'ThirdNote' },
    );
    return picked ? picked.color : null;
  }

  async function pickCollection(placeHolder, { allowNew = true, current } = {}) {
    const items = [
      { label: '$(inbox) Inbox', id: INBOX, description: current === INBOX ? 'current' : '' },
      ...store.collections.map((c) => ({ label: `$(folder) ${c.name}`, id: c.id, description: current === c.id ? 'current' : '' })),
    ];
    if (allowNew) items.push({ label: '$(new-folder) New collection...', id: '__new__' });
    const picked = await vscode.window.showQuickPick(items, { placeHolder, title: 'ThirdNote' });
    if (!picked) return null;
    if (picked.id === '__new__') {
      const c = await newCollection();
      return c ? c.id : null;
    }
    return picked.id;
  }

  async function newCollection() {
    const name = await vscode.window.showInputBox({
      title: 'New collection',
      prompt: 'A subject, project or idea',
      placeHolder: 'e.g. Algorithms, Project X, Interview prep',
      validateInput: (v) => (!v.trim() ? 'Give it a name' : store.collections.some((c) => c.name.toLowerCase() === v.trim().toLowerCase()) ? 'A collection with this name already exists' : null),
    });
    if (!name) return null;
    return store.addCollection(name);
  }

  function savedMessage(what, it) {
    const where = store.collectionName(it.collectionId);
    vscode.window.setStatusBarMessage(`$(check) ThirdNote: ${what} saved to ${where}`, 3000);
  }

  function sourceFor(doc, sel) {
    const full = doc.getText();
    const s = doc.offsetAt(sel.start);
    const e = doc.offsetAt(sel.end);
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    return {
      uri: doc.uri.toString(),
      path: displayPath(doc.uri),
      workspace: folder ? folder.name : '',
      start: { line: sel.start.line, character: sel.start.character },
      end: { line: sel.end.line, character: sel.end.character },
      before: full.slice(Math.max(0, s - CONTEXT_CHARS), s),
      after: full.slice(e, e + CONTEXT_CHARS),
    };
  }

  async function highlight({ withNote }) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const sels = ed.selections.filter((s) => !s.isEmpty);
    if (!sels.length) {
      vscode.window.showInformationMessage('Select some code first, then highlight it.');
      return;
    }
    const color = await pickColor();
    if (!color) return;
    let note = '';
    if (withNote) {
      note = await vscode.window.showInputBox({ title: 'Note for this highlight', prompt: 'Why it matters, or a question you want to be asked when reviewing', placeHolder: 'e.g. Why does this loop stop at n / 2?' });
      if (note === undefined) return;
    }
    let last;
    for (const sel of sels) {
      const text = ed.document.getText(sel);
      if (text.length > MAX_SAVE) { vscode.window.showWarningMessage('That selection is too large to highlight.'); continue; }
      // Replace an existing highlight with exactly the same range instead of stacking another.
      const existing = highlights.at(ed.document, sel.start).find((h) => h.range.isEqual(sel));
      if (existing) {
        store.updateItem(existing.item.id, { color, ...(withNote ? { note } : {}) });
        last = existing.item;
        continue;
      }
      last = store.addItem({
        kind: 'highlight', text, note, color, language: ed.document.languageId,
        collectionId: targetCollection(), source: sourceFor(ed.document, sel),
      });
    }
    if (last) savedMessage('Highlight', last);
  }

  async function saveSelection() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.selection.isEmpty) return;
    const text = ed.selections.filter((s) => !s.isEmpty).map((s) => ed.document.getText(s)).join('\n\n');
    if (text.length > MAX_SAVE) return vscode.window.showWarningMessage('That selection is too large to save.');
    const title = await vscode.window.showInputBox({ title: 'Save snippet', prompt: 'Title (optional)', placeHolder: 'e.g. Binary search template' });
    if (title === undefined) return;
    const it = store.addItem({
      kind: 'snippet', title: title.trim(), text, color: vscode.workspace.getConfiguration('thirdnote').get('defaultColor', 'yellow'),
      language: ed.document.languageId, collectionId: targetCollection(), source: sourceFor(ed.document, ed.selection),
    });
    savedMessage('Snippet', it);
  }

  async function saveFile(uri) {
    let doc;
    if (uri instanceof vscode.Uri) doc = await vscode.workspace.openTextDocument(uri);
    else if (vscode.window.activeTextEditor) doc = vscode.window.activeTextEditor.document;
    if (!doc) return;
    const text = doc.getText();
    if (text.length > MAX_SAVE) return vscode.window.showWarningMessage('That file is too large to save into ThirdNote.');
    const name = doc.uri.path.split('/').pop();
    const it = store.addItem({
      kind: 'file', title: name, text, language: doc.languageId,
      color: vscode.workspace.getConfiguration('thirdnote').get('defaultColor', 'yellow'),
      collectionId: targetCollection(),
      source: { uri: doc.uri.toString(), path: displayPath(doc.uri), workspace: (vscode.workspace.getWorkspaceFolder(doc.uri) || {}).name || '' },
    });
    savedMessage(`"${name}"`, it);
  }

  async function saveClipboard() {
    const text = await vscode.env.clipboard.readText();
    if (!text || !text.trim()) return vscode.window.showInformationMessage('The clipboard is empty. Copy something first.');
    if (text.length > MAX_SAVE) return vscode.window.showWarningMessage('The clipboard text is too large to save.');
    const title = await vscode.window.showInputBox({ title: 'Save clipboard', prompt: 'Title (optional)', value: '', placeHolder: text.split('\n')[0].slice(0, 80) });
    if (title === undefined) return;
    const it = store.addItem({ kind: 'clip', title: title.trim(), text, color: vscode.workspace.getConfiguration('thirdnote').get('defaultColor', 'yellow'), collectionId: targetCollection() });
    savedMessage('Clip', it);
  }

  async function openItem(arg, opts = {}) {
    const it = store.item(idOf(arg));
    if (!it) return;
    if (!it.source || !it.source.uri || it.kind === 'note' || it.kind === 'clip') {
      if (!opts.fromLibrary) library.show({ focusId: it.id });
      return;
    }
    let doc;
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(it.source.uri));
    } catch {
      const choice = await vscode.window.showWarningMessage(`"${it.source.path}" can't be opened. It may have been moved or deleted.`, 'Show in Library');
      if (choice) library.show({ focusId: it.id });
      return;
    }
    let range;
    if (it.kind === 'highlight') {
      const found = highlights.rangesFor(doc).find((r) => r.item.id === it.id);
      if (found) range = found.range;
    }
    if (!range && it.source.start) {
      const p = new vscode.Position(Math.min(it.source.start.line, doc.lineCount - 1), 0);
      range = new vscode.Range(p, p);
    }
    const ed = await vscode.window.showTextDocument(doc, { preview: false, selection: range });
    if (range) ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  async function deleteItem(arg, all) {
    const ids = selectedItemIds(arg, all);
    if (!ids.length) return;
    const label = ids.length === 1 ? `"${itemLabel(store.item(ids[0]))}"` : `${ids.length} items`;
    const ok = await vscode.window.showWarningMessage(`Delete ${label}?`, { modal: true, detail: 'This removes it from ThirdNote. Your files are not changed.' }, 'Delete');
    if (ok !== 'Delete') return;
    for (const id of ids) { highlights.forget(id); store.deleteItem(id); }
  }

  async function editNote(arg) {
    const it = store.item(idOf(arg));
    if (!it) return;
    if (it.kind === 'note') return library.show({ focusId: it.id });
    const note = await vscode.window.showInputBox({ title: `Note for ${KIND_LABEL[it.kind].toLowerCase()}`, value: it.note || '', prompt: 'Leave empty to remove the note' });
    if (note === undefined) return;
    store.updateItem(it.id, { note });
  }

  async function exportMarkdown(collectionId) {
    const scope = collectionId || null;
    const items = scope ? store.itemsIn(scope) : store.items.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (!items.length) return vscode.window.showInformationMessage('Nothing to export yet.');
    const content = toMarkdown(store, items, scope);
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.setStatusBarMessage('ThirdNote: exported. Save the file wherever you like.', 4000);
  }

  const library = new Library(context, store, { openItem, deleteItem: (id) => deleteItem(id), exportMarkdown, newCollection });

  // Hover on a highlight: its note plus quick actions.
  context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: '*' }, {
    provideHover(doc, pos) {
      const hits = highlights.at(doc, pos);
      if (!hits.length) return null;
      const parts = hits.map(({ item, range }) => {
        const md = new vscode.MarkdownString(undefined, true);
        md.isTrusted = { enabledCommands: ['thirdnote.editNote', 'thirdnote.changeColor', 'thirdnote.deleteItem', 'thirdnote.openLibrary', 'thirdnote.moveItem'] };
        const arg = encodeURIComponent(JSON.stringify([item.id]));
        md.appendMarkdown(`**ThirdNote** · ${COLOR_LABELS[item.color]} · ${store.collectionName(item.collectionId).replace(/[\\`*_[\]]/g, '\\$&')}\n\n`);
        if (item.note) md.appendMarkdown(`${item.note.replace(/[\\`*_{}[\]#<>|]/g, '\\$&')}\n\n`);
        md.appendMarkdown([
          `[$(edit) ${item.note ? 'Edit note' : 'Add note'}](command:thirdnote.editNote?${arg})`,
          `[$(symbol-color) Colour](command:thirdnote.changeColor?${arg})`,
          `[$(folder) Move](command:thirdnote.moveItem?${arg})`,
          `[$(library) Library](command:thirdnote.openLibrary?${encodeURIComponent(JSON.stringify([{ focusId: item.id }]))})`,
          `[$(trash) Remove](command:thirdnote.deleteItem?${arg})`,
        ].join(' &nbsp; '));
        return { md, range };
      });
      return new vscode.Hover(parts.map((p) => p.md), parts[0].range);
    },
  }));

  // ---------- commands ----------
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('thirdnote.highlight', () => highlight({ withNote: false }));
  reg('thirdnote.highlightWithNote', () => highlight({ withNote: true }));
  reg('thirdnote.saveSelection', saveSelection);
  reg('thirdnote.saveFile', saveFile);
  reg('thirdnote.saveClipboard', saveClipboard);
  reg('thirdnote.writeNote', () => library.show({ compose: true }));
  reg('thirdnote.openLibrary', (intent) => library.show(intent && typeof intent === 'object' && !intent.type ? intent : {}));
  reg('thirdnote.review', () => library.show({ review: true }));
  reg('thirdnote.searchItems', async () => {
    const all = store.items.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (!all.length) return vscode.window.showInformationMessage('Nothing saved yet.');
    const picked = await vscode.window.showQuickPick(all.map((it) => ({
      label: `$(${it.kind === 'highlight' ? 'circle-filled' : it.kind === 'note' ? 'note' : it.kind === 'clip' ? 'clippy' : 'code'}) ${itemLabel(it)}`,
      description: it.source && it.source.path ? `${it.source.path}${it.source.start ? `:${it.source.start.line + 1}` : ''}` : store.collectionName(it.collectionId),
      detail: it.note && it.kind !== 'note' ? it.note.replace(/\s+/g, ' ').slice(0, 140) : undefined,
      id: it.id,
    })), { placeHolder: 'Search highlights, notes, snippets and clips', matchOnDescription: true, matchOnDetail: true, title: 'ThirdNote' });
    if (picked) openItem(picked.id);
  });
  reg('thirdnote.newCollection', newCollection);
  reg('thirdnote.setCollecting', async () => {
    const items = [
      { label: '$(circle-slash) Off', description: 'Ask nothing, save to Inbox', id: null },
      { label: '$(inbox) Inbox', id: INBOX },
      ...store.collections.map((c) => ({ label: `$(folder) ${c.name}`, id: c.id })),
      { label: '$(new-folder) New collection...', id: '__new__' },
    ].map((x) => ({ ...x, description: x.description || (x.id && x.id === store.collecting ? 'collecting now' : '') }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Every new highlight, snippet and clip goes into...', title: 'ThirdNote: Collecting' });
    if (!picked) return;
    if (picked.id === '__new__') {
      const c = await newCollection();
      if (c) store.setCollecting(c.id);
    } else store.setCollecting(picked.id);
  });
  reg('thirdnote.exportMarkdown', () => exportMarkdown(null));
  reg('thirdnote.exportBackup', async () => {
    const target = await vscode.window.showSaveDialog({ filters: { JSON: ['json'] }, defaultUri: vscode.Uri.file(require('os').homedir() + `/thirdnote-backup-${new Date().toISOString().slice(0, 10)}.json`), title: 'Back up ThirdNote' });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(store.data, null, 1), 'utf8'));
    vscode.window.showInformationMessage(`ThirdNote backup saved (${store.items.length} items).`);
  });
  reg('thirdnote.importBackup', async () => {
    const [file] = (await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false, title: 'Restore ThirdNote backup' })) || [];
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8')); } catch { return vscode.window.showErrorMessage('That file is not a ThirdNote backup.'); }
    if (!parsed || !Array.isArray(parsed.items)) return vscode.window.showErrorMessage('That file is not a ThirdNote backup.');
    const how = await vscode.window.showQuickPick([
      { label: 'Merge', description: 'Add what is missing, keep everything you have', id: 'merge' },
      { label: 'Replace', description: 'Swap everything for the backup', id: 'replace' },
    ], { placeHolder: `The backup has ${parsed.items.length} items` });
    if (!how) return;
    if (how.id === 'replace') {
      const ok = await vscode.window.showWarningMessage(`Replace all ${store.items.length} items with the backup?`, { modal: true }, 'Replace');
      if (ok !== 'Replace') return;
      store.replaceAll(parsed);
      highlights.live.clear();
      vscode.window.showInformationMessage('ThirdNote restored from backup.');
    } else {
      const added = store.merge(parsed);
      vscode.window.showInformationMessage(`ThirdNote: ${added} items added from the backup.`);
    }
    highlights.redrawAll();
  });
  reg('thirdnote.removeHighlightAtCursor', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const hits = highlights.at(ed.document, ed.selection.active);
    if (!hits.length) return;
    for (const h of hits) { highlights.forget(h.item.id); store.deleteItem(h.item.id); }
    updateCursorKey();
  });
  const jump = (dir) => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const ranges = highlights.rangesFor(ed.document).map((r) => r.range);
    if (!ranges.length) return vscode.window.setStatusBarMessage('ThirdNote: no highlights in this file', 2000);
    const pos = ed.selection.active;
    let target = dir > 0 ? ranges.find((r) => r.start.isAfter(pos)) : [...ranges].reverse().find((r) => r.start.isBefore(pos) && !r.contains(pos));
    if (!target) target = dir > 0 ? ranges[0] : ranges[ranges.length - 1];
    ed.selection = new vscode.Selection(target.start, target.end);
    ed.revealRange(target, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };
  reg('thirdnote.nextHighlight', () => jump(1));
  reg('thirdnote.previousHighlight', () => jump(-1));

  reg('thirdnote.openItem', openItem);
  reg('thirdnote.editNote', editNote);
  reg('thirdnote.changeColor', async (arg, all) => {
    const ids = selectedItemIds(arg, all);
    if (!ids.length) return;
    const color = await pickColor('New colour');
    if (color) for (const id of ids) store.updateItem(id, { color });
  });
  reg('thirdnote.moveItem', async (arg, all) => {
    const ids = selectedItemIds(arg, all);
    if (!ids.length) return;
    const to = await pickCollection('Move to...', { current: store.item(ids[0]).collectionId || INBOX });
    if (to) for (const id of ids) store.updateItem(id, { collectionId: to });
  });
  reg('thirdnote.copyItem', async (arg) => {
    const it = store.item(idOf(arg));
    if (!it) return;
    await vscode.env.clipboard.writeText(it.kind === 'note' ? [it.title, it.note].filter(Boolean).join('\n\n') : it.text);
    vscode.window.setStatusBarMessage('ThirdNote: copied', 2000);
  });
  reg('thirdnote.deleteItem', deleteItem);
  reg('thirdnote.renameCollection', async (node) => {
    const c = store.collection(idOf(node));
    if (!c) return;
    const name = await vscode.window.showInputBox({ title: 'Rename collection', value: c.name, validateInput: (v) => (v.trim() ? null : 'Give it a name') });
    if (name) store.renameCollection(c.id, name);
  });
  reg('thirdnote.deleteCollection', async (node) => {
    const c = store.collection(idOf(node));
    if (!c) return;
    const n = store.itemsIn(c.id).length;
    if (!n) return store.deleteCollection(c.id);
    const choice = await vscode.window.showWarningMessage(
      `Delete the collection "${c.name}"?`,
      { modal: true, detail: `It has ${n} item${n === 1 ? '' : 's'}.` },
      'Move items to Inbox', 'Delete items too',
    );
    if (!choice) return;
    if (choice === 'Delete items too') for (const it of store.itemsIn(c.id)) highlights.forget(it.id);
    store.deleteCollection(c.id, { keepItems: choice === 'Move items to Inbox' });
  });
  reg('thirdnote.collectInto', (node) => {
    const id = idOf(node);
    store.setCollecting(store.collecting === id ? null : id);
  });
  reg('thirdnote.reviewCollection', (node) => library.show({ review: true, collectionId: idOf(node) }));
  reg('thirdnote.exportCollection', (node) => exportMarkdown(idOf(node)));

  // Welcome once, on first install.
  if (!context.globalState.get('thirdnote.welcomed')) {
    context.globalState.update('thirdnote.welcomed', true);
    vscode.window.showInformationMessage('ThirdNote is ready. Select code and press Alt+Shift+H to highlight it.', 'Open Library').then((c) => { if (c) library.show({}); });
  }

  return { store, highlights, library }; // used by the tests
}

function deactivate() {
  return current ? current.flush() : undefined;
}

module.exports = { activate, deactivate };
