// Copies the ThirdNote browser pages (library, reader, board, editor, settings) and the data layer into the
// VS Code extension, so both products share one codebase. Small, checked rewrites make the pages work inside
// a VS Code webview, where navigation and storage go through the extension instead of the browser.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const web = path.join(__dirname, '..', 'web');
const core = path.join(__dirname, '..', 'core');

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (name.startsWith('._') || name === '.DS_Store') continue;
    const a = path.join(from, name);
    const b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copyDir(a, b, filter);
    else if (filter(name)) fs.copyFileSync(a, b);
  }
}

function patch(file, swaps) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b] of swaps) {
    if (!s.includes(a)) throw new Error(`${path.basename(file)} changed: "${a}" not found`);
    s = s.split(a).join(b);
  }
  fs.writeFileSync(file, s);
}

fs.rmSync(web, { recursive: true, force: true });
for (const dir of ['lib', 'reader', 'home', 'options', 'icons']) copyDir(path.join(root, dir), path.join(web, dir));
fs.rmSync(path.join(web, 'lib', 'api.js'));
fs.rmSync(path.join(web, 'lib', 'db.js'));

patch(path.join(web, 'reader', 'reader.js'), [
  ['new URLSearchParams(location.search)', 'new URLSearchParams(TN.search)'],
  ["history.replaceState(null, '', `?${p}`);", 'TN.replace(`?${p}`);'],
  ["window.open(readerUrl(p), '_blank')", 'TN.open(readerUrl(p))'],
]);
// Code highlights keep their lines and indentation in the highlight list, the review cards and Markdown.
patch(path.join(web, 'reader', 'reader.js'), [
  ["hl.image ? h('img', { src: hl.image, alt: '' }) : h('div', { class: 'text' }, hl.text),", "hl.image ? h('img', { src: hl.image, alt: '' }) : h('div', { class: hl.code ? 'text code' : 'text' }, hl.text),"],
  ["hl.image ? h('img', { src: hl.image, alt: '' }) : hl.text,\n", "hl.image ? h('img', { src: hl.image, alt: '' }) : hl.code ? h('pre', { class: 'code-answer' }, hl.text) : hl.text,\n"],
  ["lines.push(`- **[${NM.label(hl.color)}]** ${hl.image ? `![](${hl.image.slice(0, 40)}…)` : hl.text.replace(/\\n+/g, ' ')}`);",
   "lines.push(hl.code ? `- **[${NM.label(hl.color)}]** \\`${hl.code.path}:${(hl.code.start ? hl.code.start.line : 0) + 1}\\`\\n\\n  \\`\\`\\`${hl.code.language || ''}\\n${hl.text.replace(/^/gm, '  ')}\\n  \\`\\`\\`` : `- **[${NM.label(hl.color)}]** ${hl.image ? `![](${hl.image.slice(0, 40)}…)` : hl.text.replace(/\\n+/g, ' ')}`);"],
]);
fs.appendFileSync(path.join(web, 'reader', 'reader.css'), `
/* VS Code: code highlights */
.hcard .text.code, .code-answer { font-family: var(--mono); white-space: pre; overflow-x: auto; font-size: 12.5px; line-height: 1.55; tab-size: 4; }
.code-answer { margin: 0; text-align: left; background: var(--surface-2); border-radius: 8px; padding: 10px 12px; }
`);
// In VS Code the PDF is made directly, no print dialog.
patch(path.join(web, 'lib', 'i18n.js'), [
  ["'rd.exportPdf': 'PDF (Print, then Save as PDF)',", "'rd.exportPdf': 'PDF',"],
  ["'rd.exportPdf': 'PDF (Print, তারপর Save as PDF)',", "'rd.exportPdf': 'PDF',"],
]);
patch(path.join(web, 'lib', 'editor.js'), [
  ["window.open(src, '_blank', 'noopener');", 'TN.open(src);'],
  ["window.open(link.href, '_blank', 'noopener');", "TN.open(link.getAttribute('href'));"],
]);

// Data layer: the same api.js, running in the extension host over a small IndexedDB stand-in.
fs.mkdirSync(core, { recursive: true });
let api = fs.readFileSync(path.join(root, 'lib', 'api.js'), 'utf8');
const imp = "import { tx, reqP } from './db.js';";
if (!api.includes(imp)) throw new Error('api.js changed: db import not found');
fs.writeFileSync(path.join(core, 'api.mjs'), api.replace(imp, "import { tx, reqP } from './minidb.mjs';"));
console.log('web pages and data layer synced');
