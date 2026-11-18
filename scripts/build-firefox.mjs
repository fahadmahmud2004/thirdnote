// Builds the Firefox version into dist/firefox and zips it for addons.mozilla.org.
// The code is shared with Chrome; only the manifest differs.
//   node scripts/build-firefox.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'firefox');
const files = ['background.js', 'lib', 'content', 'sidepanel', 'reader', 'options', 'home', 'icons'];

const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

delete m.minimum_chrome_version;
m.browser_specific_settings = {
  gecko: {
    id: 'thirdnote@fahadmahmud2004.github.io',
    strict_min_version: '128.0',
    // Everything stays in the browser; nothing is sent to a server.
    data_collection_permissions: { required: ['none'] },
  },
};

// Firefox runs the background as an event page, not a service worker.
m.background = { scripts: [m.background.service_worker], type: 'module' };

// Firefox has a sidebar instead of Chrome's side panel.
m.permissions = m.permissions.filter((p) => p !== 'sidePanel');
m.sidebar_action = {
  default_title: 'ThirdNote',
  default_panel: m.side_panel.default_path,
  default_icon: m.action.default_icon,
  open_at_install: false,
};
delete m.side_panel;

m.options_ui = { page: m.options_page, open_in_tab: true };
delete m.options_page;

// The open shortcut toggles the sidebar.
const { _execute_action: open, ...rest } = m.commands;
m.commands = { _execute_sidebar_action: open, ...rest };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of files) {
  cpSync(join(root, f), join(out, f), { recursive: true, filter: (src) => !/(^|\/)(\._|\.DS_Store)/.test(src) });
}
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);

const zip = join(root, 'dist', `thirdnote-firefox-${m.version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-qrX', zip, '.', '-x', '._*', '*/._*', '*.DS_Store'], { cwd: out, env: { ...process.env, COPYFILE_DISABLE: '1' } });
console.log(zip);
