// ThirdNote for VS Code: the ThirdNote library, reader, board and review, plus code highlights that stay on their code.
const vscode = require('vscode');
const { Core } = require('./core');
const { Highlights, displayPath, CONTEXT_CHARS } = require('./highlights');
const { CollectionsTree, ThisFileTree, firstLine } = require('./tree');
const { Pages } = require('./pages');

const COLORS = ['yellow', 'red', 'green', 'blue'];
const COLOR_LABELS = { yellow: 'Yellow', red: 'Red', green: 'Green', blue: 'Blue' };
const MAX_SAVE = 2 * 1024 * 1024;

let core = null;

async function activate(context) {
  core = new Core(context);
  await core.init();

  // First run: match the pages to VS Code's light or dark theme.
  if (!core.storage.settings) {
    const dark = [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind);
    core.setStorage({ settings: { theme: dark ? 'dark' : 'light' } });
  }

  const highlights = new Highlights(core);
  highlights.activate();
  context.subscriptions.push(highlights);

  const pages = new Pages(context, core, { openCode: (uri) => openCode(uri) });

  const collections = new CollectionsTree(core);
  const collectionsView = vscode.window.createTreeView('thirdnote.collections', { treeDataProvider: collections, showCollapseAll: true });
  const thisFileView = vscode.window.createTreeView('thirdnote.thisFile', { treeDataProvider: new ThisFileTree(core, highlights) });
  context.subscriptions.push(collectionsView, thisFileView);

  // Status bar: where new saves go.
  const status = vscode.window.createStatusBarItem('thirdnote.target', vscode.StatusBarAlignment.Left, 50);
  status.name = 'ThirdNote';
  status.command = 'thirdnote.setCollecting';
  const paintStatus = async () => {
    const topics = await core.topics();
    const st = core.storage;
    const on = st.collecting && topics.find((t) => t.id === st.activeTopicId);
    status.text = on ? `$(target) ${on.name}` : '$(bookmark) ThirdNote';
    status.tooltip = on ? `ThirdNote is collecting into "${core.topicLabel(on)}". Click to change.` : 'ThirdNote: choose where new highlights and notes go';
    status.show();
  };
  paintStatus();
  context.subscriptions.push(status, core.onDidChange(paintStatus), core.onDidChangeStorage(paintStatus));

  const updateCursorKey = () => {
    const ed = vscode.window.activeTextEditor;
    vscode.commands.executeCommand('setContext', 'thirdnote.cursorOnHighlight', !!ed && highlights.at(ed.document, ed.selection.active).length > 0);
  };
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateCursorKey), vscode.window.onDidChangeActiveTextEditor(updateCursorKey));

  // ---------- helpers ----------
  const idOf = (arg) => {
    if (!arg) return null;
    if (typeof arg === 'string') return arg;
    if (arg.type === 'hl') return arg.id;
    if (typeof arg.id === 'string') return arg.id;
    return null;
  };

  async function pickColor(placeHolder = 'Highlight colour') {
    const cfg = vscode.workspace.getConfiguration('thirdnote');
    const def = cfg.get('defaultColor', 'yellow');
    if (!cfg.get('askForColor', true)) return def;
    const order = [def, ...COLORS.filter((c) => c !== def)];
    const picked = await vscode.window.showQuickPick(
      order.map((c, i) => ({ label: COLOR_LABELS[c], description: i === 0 ? 'default' : '', color: c, iconPath: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(`thirdnote.${c}Mark`)) })),
      { placeHolder, title: 'ThirdNote' },
    );
    return picked ? picked.color : null;
  }

  async function pickTopic(placeHolder, { allowNew = true } = {}) {
    const topics = await core.topics();
    const items = topics.map((t) => ({ label: `$(folder) ${t.name}`, description: t.subject, id: t.id }));
    if (allowNew) items.push({ label: '$(new-folder) New collection...', id: '__new__' });
    const picked = await vscode.window.showQuickPick(items, { placeHolder, title: 'ThirdNote' });
    if (!picked) return null;
    if (picked.id === '__new__') { const t = await newCollection(); return t ? t.id : null; }
    return picked.id;
  }

  async function newCollection() {
    const subject = await vscode.window.showInputBox({ title: 'New collection (1 of 2)', prompt: 'Subject or area', value: 'VS Code', placeHolder: 'e.g. Algorithms, Project X' });
    if (subject === undefined) return null;
    const name = await vscode.window.showInputBox({ title: 'New collection (2 of 2)', prompt: 'Collection name', placeHolder: 'e.g. Graph problems, Auth flow', validateInput: (v) => (v.trim() ? null : 'Give it a name') });
    if (!name) return null;
    const t = await core.call('saveTopic', { subject, name });
    core.setStorage({ vscodeTopicId: t.id });
    return t;
  }

  function anchorFor(doc, sel) {
    const full = doc.getText();
    const s = doc.offsetAt(sel.start);
    const e = doc.offsetAt(sel.end);
    return {
      uri: doc.uri.toString(),
      path: displayPath(doc.uri),
      start: { line: sel.start.line, character: sel.start.character },
      end: { line: sel.end.line, character: sel.end.character },
      before: full.slice(Math.max(0, s - CONTEXT_CHARS), s),
      after: full.slice(e, e + CONTEXT_CHARS),
    };
  }

  async function saved(what, topicId) {
    const t = (await core.topics()).find((x) => x.id === topicId);
    vscode.window.setStatusBarMessage(`$(check) ThirdNote: ${what} saved to ${t ? t.name : 'ThirdNote'}`, 3000);
  }

  async function highlight({ color, withNote = false } = {}) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const sels = ed.selections.filter((s) => !s.isEmpty);
    if (!sels.length) return vscode.window.showInformationMessage('Select some code first, then highlight it.');
    color = color || (await pickColor());
    if (!color) return;
    let note = '';
    if (withNote) {
      note = await vscode.window.showInputBox({ title: 'Note for this highlight', prompt: 'Why it matters, or a question for your review', placeHolder: 'e.g. Why does this loop stop at n / 2?' });
      if (note === undefined) return;
    }
    const topicId = await core.targetTopic();
    for (const sel of sels) {
      const text = ed.document.getText(sel);
      if (text.length > MAX_SAVE) { vscode.window.showWarningMessage('That selection is too large to highlight.'); continue; }
      const same = highlights.at(ed.document, sel.start).find((h) => h.range.isEqual(sel));
      if (same) { await core.call('updateHighlight', { id: same.item.id, color, ...(withNote ? { note } : {}) }); core.changed('updateHighlight'); continue; }
      await core.addCode({ doc: ed.document, text, color, note, anchor: anchorFor(ed.document, sel), topicId });
    }
    saved('Highlight', topicId);
  }

  async function saveSelection() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.selection.isEmpty) return;
    const text = ed.selections.filter((s) => !s.isEmpty).map((s) => ed.document.getText(s)).join('\n\n');
    if (text.length > MAX_SAVE) return vscode.window.showWarningMessage('That selection is too large to save.');
    const note = await vscode.window.showInputBox({ title: 'Save snippet', prompt: 'A title or note (optional)', placeHolder: 'e.g. Binary search template' });
    if (note === undefined) return;
    const topicId = await core.targetTopic();
    await core.addCode({ doc: ed.document, text, color: vscode.workspace.getConfiguration('thirdnote').get('defaultColor', 'yellow'), note, topicId });
    saved('Snippet', topicId);
  }

  async function saveFile(uri) {
    let doc;
    if (uri instanceof vscode.Uri) doc = await vscode.workspace.openTextDocument(uri);
    else if (vscode.window.activeTextEditor) doc = vscode.window.activeTextEditor.document;
    if (!doc) return;
    const text = doc.getText();
    if (text.length > MAX_SAVE) return vscode.window.showWarningMessage('That file is too large to save into ThirdNote.');
    const topicId = await core.targetTopic();
    await core.addCode({ doc, text, color: 'blue', note: `Whole file: ${doc.uri.path.split('/').pop()}`, topicId });
    saved('File', topicId);
  }

  async function saveClipboard() {
    const text = await vscode.env.clipboard.readText();
    if (!text || !text.trim()) return vscode.window.showInformationMessage('The clipboard is empty. Copy something first.');
    if (text.length > MAX_SAVE) return vscode.window.showWarningMessage('The clipboard text is too large to save.');
    const looksLikeCode = /[{};]\s*$|^\s{2,}\S|=>|\bfunction\b|\bdef\b|\bclass\b/m.test(text) && text.split('\n').length > 1;
    const topicId = await core.targetTopic();
    await core.addTextNote(text, topicId, { asCode: looksLikeCode });
    saved('Clipboard', topicId);
  }

  async function openCode(uri, highlightId) {
    let doc;
    try { doc = await vscode.workspace.openTextDocument(uri); } catch {
      return vscode.window.showWarningMessage(`ThirdNote can't open ${uri.fsPath || uri.toString()}. It may have been moved or deleted.`);
    }
    let range;
    if (highlightId) {
      const found = highlights.rangesFor(doc).find((r) => r.item.id === highlightId);
      if (found) range = found.range;
    }
    const ed = await vscode.window.showTextDocument(doc, { preview: false, selection: range, viewColumn: vscode.ViewColumn.One });
    if (range) ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  async function openItem(arg) {
    const id = idOf(arg);
    const it = core.item(id);
    if (it && it.source && it.source.uri) return openCode(vscode.Uri.parse(it.source.uri), id);
    const h = core.db.raw('highlights').get(id);
    if (h) pages.show('reader', `?source=${encodeURIComponent(h.sourceId)}&hl=${encodeURIComponent(id)}`);
  }

  async function deleteItem(arg) {
    const id = idOf(arg);
    const h = core.db.raw('highlights').get(id);
    if (!h) return;
    const ok = await vscode.window.showWarningMessage(`Delete this highlight?`, { modal: true, detail: firstLine(h.note || h.text, 120) + '\n\nYour code is not changed.' }, 'Delete');
    if (ok !== 'Delete') return;
    highlights.forget(id);
    await core.call('deleteHighlight', { id });
    // A clip without its highlight is only the copied code: remove it too.
    const m = core.db.raw('messages').get(`${h.sourceId}|${h.messageKey}`);
    if (m && m.role === 'clip') await core.call('deleteMessage', { id: m.id });
    core.changed('deleteHighlight', { sourceId: h.sourceId });
  }

  const readerFor = async (mode) => {
    const st = core.storage;
    const topicId = (st.collecting && st.activeTopicId) || (await core.targetTopic());
    pages.show('reader', `?topic=${encodeURIComponent(topicId)}${mode ? `&mode=${mode}` : ''}`);
  };

  // Hover on a highlight: its note and quick actions.
  context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: '*' }, {
    provideHover(doc, pos) {
      const hits = highlights.at(doc, pos);
      if (!hits.length) return null;
      const parts = hits.map(({ item, range }) => {
        const md = new vscode.MarkdownString(undefined, true);
        md.isTrusted = { enabledCommands: ['thirdnote.editNote', 'thirdnote.changeColor', 'thirdnote.deleteItem', 'thirdnote.openInReader'] };
        const arg = encodeURIComponent(JSON.stringify([item.id]));
        md.appendMarkdown(`**ThirdNote** · ${COLOR_LABELS[item.color]}\n\n`);
        if (item.note) md.appendMarkdown(`${item.note.replace(/[\\`*_{}[\]#<>|]/g, '\\$&')}\n\n`);
        md.appendMarkdown([
          `[$(edit) ${item.note ? 'Edit note' : 'Add note'}](command:thirdnote.editNote?${arg})`,
          `[$(symbol-color) Colour](command:thirdnote.changeColor?${arg})`,
          `[$(book) Open in reader](command:thirdnote.openInReader?${arg})`,
          `[$(trash) Remove](command:thirdnote.deleteItem?${arg})`,
        ].join(' &nbsp; '));
        return { md, range };
      });
      return new vscode.Hover(parts.map((p) => p.md), parts[0].range);
    },
  }));

  // ---------- commands ----------
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('thirdnote.highlight', () => highlight());
  for (const c of COLORS) reg(`thirdnote.highlight${c[0].toUpperCase()}${c.slice(1)}`, () => highlight({ color: c }));
  reg('thirdnote.highlightWithNote', () => highlight({ withNote: true }));
  reg('thirdnote.saveSelection', saveSelection);
  reg('thirdnote.saveFile', saveFile);
  reg('thirdnote.saveClipboard', saveClipboard);
  reg('thirdnote.writeNote', () => readerFor(''));
  reg('thirdnote.openLibrary', () => pages.show('home'));
  reg('thirdnote.review', () => readerFor('review'));
  reg('thirdnote.board', () => readerFor('board'));
  reg('thirdnote.settings', () => pages.show('options'));
  reg('thirdnote.newCollection', newCollection);
  reg('thirdnote.openSource', (id) => pages.show('reader', `?source=${encodeURIComponent(idOf(id))}`));
  reg('thirdnote.openTopic', (node) => pages.show('reader', `?topic=${encodeURIComponent(idOf(node))}`));
  reg('thirdnote.boardTopic', (node) => pages.show('reader', `?topic=${encodeURIComponent(idOf(node))}&mode=board`));
  reg('thirdnote.reviewTopic', (node) => pages.show('reader', `?topic=${encodeURIComponent(idOf(node))}&mode=review`));
  reg('thirdnote.collectInto', (node) => {
    const id = idOf(node);
    const st = core.storage;
    const on = !(st.collecting && st.activeTopicId === id);
    core.setStorage({ activeTopicId: id, collecting: on, vscodeTopicId: id });
  });
  reg('thirdnote.setCollecting', async () => {
    const topics = await core.topics();
    const st = core.storage;
    const items = [
      { label: '$(circle-slash) Off', description: 'Save to the last collection used in VS Code', id: null },
      ...topics.map((t) => ({ label: `$(folder) ${t.name}`, description: `${t.subject}${st.collecting && st.activeTopicId === t.id ? ' · collecting now' : ''}`, id: t.id })),
      { label: '$(new-folder) New collection...', id: '__new__' },
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Every new highlight, snippet and note goes into...', title: 'ThirdNote: Collecting' });
    if (!picked) return;
    if (picked.id === '__new__') { const t = await newCollection(); if (t) core.setStorage({ activeTopicId: t.id, collecting: true }); }
    else if (picked.id) core.setStorage({ activeTopicId: picked.id, collecting: true, vscodeTopicId: picked.id });
    else core.setStorage({ collecting: false });
  });
  reg('thirdnote.removeHighlightAtCursor', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    for (const h of highlights.at(ed.document, ed.selection.active)) {
      highlights.forget(h.item.id);
      const rec = core.db.raw('highlights').get(h.item.id);
      await core.call('deleteHighlight', { id: h.item.id });
      const m = rec && core.db.raw('messages').get(`${rec.sourceId}|${rec.messageKey}`);
      if (m && m.role === 'clip') await core.call('deleteMessage', { id: m.id });
    }
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
  reg('thirdnote.searchItems', async () => {
    const lib = await core.call('getAllHighlights');
    const list = (Array.isArray(lib) ? lib : lib.highlights || []).slice().sort((a, b) => b.createdAt - a.createdAt);
    if (!list.length) return vscode.window.showInformationMessage('Nothing highlighted yet.');
    const picked = await vscode.window.showQuickPick(list.map((h) => ({
      label: firstLine(h.note) || firstLine(h.text),
      description: h.code ? `${h.code.path}:${(h.code.start?.line ?? 0) + 1}` : '',
      detail: h.note ? firstLine(h.text, 140) : undefined,
      id: h.id,
      iconPath: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(`thirdnote.${h.color || 'yellow'}Mark`)),
    })), { placeHolder: 'Search your highlights', matchOnDescription: true, matchOnDetail: true, title: 'ThirdNote' });
    if (picked) openItem(picked.id);
  });
  reg('thirdnote.openItem', openItem);
  reg('thirdnote.openInReader', (arg) => {
    const h = core.db.raw('highlights').get(idOf(arg));
    if (h) pages.show('reader', `?source=${encodeURIComponent(h.sourceId)}&hl=${encodeURIComponent(h.id)}`);
  });
  reg('thirdnote.editNote', async (arg) => {
    const h = core.db.raw('highlights').get(idOf(arg));
    if (!h) return;
    const note = await vscode.window.showInputBox({ title: 'Note', value: h.note || '', prompt: 'Leave empty to remove the note' });
    if (note === undefined) return;
    await core.call('updateHighlight', { id: h.id, note });
    core.changed('updateHighlight', { sourceId: h.sourceId });
  });
  reg('thirdnote.changeColor', async (arg) => {
    const h = core.db.raw('highlights').get(idOf(arg));
    if (!h) return;
    const color = await pickColor('New colour');
    if (color) { await core.call('updateHighlight', { id: h.id, color }); core.changed('updateHighlight', { sourceId: h.sourceId }); }
  });
  reg('thirdnote.copyItem', async (arg) => {
    const h = core.db.raw('highlights').get(idOf(arg));
    if (h) { await vscode.env.clipboard.writeText(h.text || ''); vscode.window.setStatusBarMessage('ThirdNote: copied', 2000); }
  });
  reg('thirdnote.deleteItem', deleteItem);
  reg('thirdnote.moveSource', async (node) => {
    const id = idOf(node);
    const to = await pickTopic('Move to...');
    if (to) await core.call('updateSource', { id, topicId: to });
  });
  reg('thirdnote.deleteSource', async (node) => {
    const s = core.db.raw('sources').get(idOf(node));
    if (!s) return;
    const ok = await vscode.window.showWarningMessage(`Delete "${s.title}" from ThirdNote?`, { modal: true, detail: 'Its highlights and notes are removed. Your files are not changed.' }, 'Delete');
    if (ok === 'Delete') await core.call('deleteSource', { id: s.id });
  });

  if (!context.globalState.get('thirdnote.welcomed.v11')) {
    context.globalState.update('thirdnote.welcomed.v11', true);
    vscode.window.showInformationMessage('ThirdNote now has the full library, reader, board and review. Right-click code to highlight it.', 'Open Library').then((c) => { if (c) pages.show('home'); });
  }

  return { core, highlights, pages }; // used by the tests
}

function deactivate() {
  if (core) core.flush();
}

module.exports = { activate, deactivate };
