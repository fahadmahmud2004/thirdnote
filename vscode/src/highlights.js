// Draws highlights in editors and keeps them attached to the right code while you edit.
const vscode = require('vscode');
const COLORS = ['yellow', 'red', 'green', 'blue'];

const CONTEXT_CHARS = 64;

class Highlights {
  constructor(store) {
    this.store = store;
    this.types = {};
    for (const c of COLORS) {
      this.types[c] = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor(`thirdnote.${c}`),
        overviewRulerColor: new vscode.ThemeColor(`thirdnote.${c}Mark`),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        borderRadius: '2px',
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });
    }
    this.noteType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        margin: '0 0 0 2.5em',
        fontStyle: 'italic',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    // uri string -> Map(itemId -> { start, end }) as offsets in the live document
    this.live = new Map();
    this.disposables = [];
    this._redrawTimer = null;
  }

  activate() {
    const w = vscode.window;
    const ws = vscode.workspace;
    this.disposables.push(
      w.onDidChangeVisibleTextEditors(() => this.redrawAll()),
      ws.onDidChangeTextDocument((e) => this.onEdit(e)),
      ws.onDidCloseTextDocument((doc) => this.live.delete(doc.uri.toString())),
      ws.onDidRenameFiles((e) => this.onRename(e)),
      ws.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('thirdnote')) this.redrawAll(); }),
      this.store.onDidChange(() => this.scheduleRedraw()),
      ...Object.values(this.types),
      this.noteType,
    );
    this.redrawAll();
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }

  scheduleRedraw() {
    clearTimeout(this._redrawTimer);
    this._redrawTimer = setTimeout(() => this.redrawAll(), 30);
  }

  redrawAll() {
    for (const ed of vscode.window.visibleTextEditors) this.redraw(ed);
  }

  // Ranges of every highlight found in this document, resolving any we have not placed yet.
  rangesFor(doc) {
    const key = doc.uri.toString();
    const items = this.store.itemsForUri(key);
    let map = this.live.get(key);
    if (!map) { map = new Map(); this.live.set(key, map); }
    const ids = new Set(items.map((i) => i.id));
    for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);

    const out = [];
    for (const it of items) {
      let off = map.get(it.id);
      if (!off) {
        off = resolve(doc, it);
        if (!off) continue;
        map.set(it.id, off);
        this.syncItem(doc, it, off);
      }
      const range = new vscode.Range(doc.positionAt(off.start), doc.positionAt(off.end));
      out.push({ item: it, range });
    }
    return out.sort((a, b) => a.range.start.compareTo(b.range.start));
  }

  redraw(editor) {
    const doc = editor.document;
    const cfg = vscode.workspace.getConfiguration('thirdnote');
    const show = cfg.get('showInEditor', true);
    const byColor = Object.fromEntries(COLORS.map((c) => [c, []]));
    const notes = [];
    if (show && doc.uri.scheme !== 'output') {
      for (const { item, range } of this.rangesFor(doc)) {
        byColor[item.color || 'yellow'].push({ range });
        if (cfg.get('showNoteAtLineEnd', true) && item.note) {
          const line = doc.lineAt(range.end.line);
          const short = item.note.replace(/\s+/g, ' ').trim();
          notes.push({
            range: new vscode.Range(line.range.end, line.range.end),
            renderOptions: { after: { contentText: short.length > 60 ? `${short.slice(0, 59)}...` : short } },
          });
        }
      }
    }
    for (const c of COLORS) editor.setDecorations(this.types[c], byColor[c]);
    editor.setDecorations(this.noteType, notes);
  }

  // Keep stored position and text in step with where the highlight now sits.
  syncItem(doc, item, off) {
    const start = doc.positionAt(off.start);
    const end = doc.positionAt(off.end);
    const text = doc.getText(new vscode.Range(start, end));
    const full = doc.getText();
    const src = {
      ...item.source,
      start: { line: start.line, character: start.character },
      end: { line: end.line, character: end.character },
      before: full.slice(Math.max(0, off.start - CONTEXT_CHARS), off.start),
      after: full.slice(off.end, off.end + CONTEXT_CHARS),
    };
    const same = item.text === text && sameLoc(item.source, src);
    if (!same) this.store.updateItem(item.id, { text, source: src }, { quiet: true });
  }

  onEdit(e) {
    const key = e.document.uri.toString();
    const map = this.live.get(key);
    if (!map || !map.size || !e.contentChanges.length) return;
    const changes = [...e.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
    let touched = false;
    for (const [id, off] of map) {
      let { start, end } = off;
      for (const ch of changes) {
        const cs = ch.rangeOffset;
        const ce = cs + ch.rangeLength;
        const delta = ch.text.length - ch.rangeLength;
        if (ce <= start) {
          start += delta; end += delta;
        } else if (cs >= end) {
          // after the highlight
        } else if (cs >= start && ce <= end) {
          end += delta; // typed inside
        } else if (cs <= start && ce >= end) {
          start = end = cs; // the whole highlight was replaced
        } else if (cs < start) {
          start = cs + ch.text.length; end += delta; // cut into its start
        } else {
          end = cs; // cut into its end
        }
      }
      if (start !== off.start || end !== off.end) {
        touched = true;
        if (end <= start) {
          map.delete(id);
          // The code is gone from this file. Keep the item; it shows as detached until undo brings it back.
          if (this.store.item(id)) this.store.updateItem(id, { source: { detached: true } }, { quiet: true });
        } else {
          off.start = start; off.end = end;
          let it = this.store.item(id);
          if (it) {
            if (it.source && it.source.detached) { this.store.updateItem(id, { source: { detached: false } }, { quiet: true }); it = this.store.item(id); }
            this.syncItem(e.document, it, off);
          }
        }
      }
    }
    if (touched) {
      for (const ed of vscode.window.visibleTextEditors) if (ed.document === e.document) this.redraw(ed);
    }
  }

  onRename(e) {
    let changed = false;
    for (const { oldUri, newUri } of e.files) {
      const oldKey = oldUri.toString();
      for (const it of this.store.items) {
        if (!it.source || !it.source.uri) continue;
        if (it.source.uri === oldKey || it.source.uri.startsWith(`${oldKey}/`)) {
          const uri = newUri.toString() + it.source.uri.slice(oldKey.length);
          this.store.updateItem(it.id, { source: { uri, path: displayPath(vscode.Uri.parse(uri)) } }, { quiet: true });
          changed = true;
        }
      }
      this.live.delete(oldKey);
    }
    if (changed) this.store.touch();
    this.redrawAll();
  }

  at(doc, position) {
    return this.rangesFor(doc).filter(({ range }) => range.contains(position));
  }

  forget(id) {
    for (const map of this.live.values()) map.delete(id);
  }
}

function sameLoc(a, b) {
  if (!a || !b) return false;
  return a.start && b.start && a.end && b.end &&
    a.start.line === b.start.line && a.start.character === b.start.character &&
    a.end.line === b.end.line && a.end.character === b.end.character &&
    a.before === b.before && a.after === b.after;
}

// Find where a saved highlight lives in the document now.
function resolve(doc, item) {
  const text = item.text;
  if (!text) return null;
  const src = item.source || {};
  const full = doc.getText();
  if (src.start && src.end) {
    try {
      const r = new vscode.Range(src.start.line, src.start.character, src.end.line, src.end.character);
      const s = doc.offsetAt(r.start);
      const e = doc.offsetAt(r.end);
      if (full.slice(s, e) === text) return { start: s, end: e };
    } catch { /* stale position */ }
  }
  // Search every occurrence and pick the one whose surroundings and line fit best.
  const hits = [];
  let i = full.indexOf(text);
  while (i !== -1 && hits.length < 2000) {
    hits.push(i);
    i = full.indexOf(text, i + 1);
  }
  if (!hits.length) return null;
  const wantLine = src.start ? src.start.line : 0;
  let best = null;
  for (const h of hits) {
    const before = full.slice(Math.max(0, h - CONTEXT_CHARS), h);
    const after = full.slice(h + text.length, h + text.length + CONTEXT_CHARS);
    const ctx = suffixMatch(before, src.before || '') + prefixMatch(after, src.after || '');
    const dist = Math.abs(doc.positionAt(h).line - wantLine);
    const score = ctx * 10 - Math.min(dist, 5000) * 0.01;
    if (!best || score > best.score) best = { score, start: h };
  }
  return { start: best.start, end: best.start + text.length };
}

function suffixMatch(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function prefixMatch(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function displayPath(uri) {
  if (uri.scheme === 'untitled') return uri.path;
  const rel = vscode.workspace.asRelativePath(uri, true);
  return rel || uri.fsPath || uri.path;
}

module.exports = { Highlights, displayPath, CONTEXT_CHARS };
