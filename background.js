import { api, MUTATING } from './lib/api.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'nm-save-selection', title: 'Save selection to ThirdNote', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'nm-capture', title: 'Capture an area to ThirdNote', contexts: ['page', 'image', 'video', 'link'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'nm-save-selection') send(tab.id, { type: 'nm-context-save' });
  if (info.menuItemId === 'nm-capture') send(tab.id, { type: 'nm-capture', mode: 'area' });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'capture-area' && tab?.id) send(tab.id, { type: 'nm-capture', mode: 'area' });
});

function send(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'nm-rpc') return false;
  handle(msg, sender).then(sendResponse);
  return true;
});

async function handle({ method, args = {} }, sender) {
  try {
    if (method === 'openReader') {
      const url = chrome.runtime.getURL(`reader/reader.html?${new URLSearchParams(args)}`);
      await chrome.tabs.create({ url });
      return { ok: true, result: true };
    }
    if (method === 'captureVisible') {
      // From a content script: its own tab. From the side panel: the window it names.
      const windowId = sender.tab?.windowId ?? args.windowId;
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });
      return { ok: true, result: dataUrl };
    }
    const fn = api[method];
    if (!fn) throw new Error(`Unknown method: ${method}`);
    const result = await fn(args);
    if (MUTATING.has(method)) broadcast(method, args);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// Tell open extension pages and content scripts that data changed, so the
// side panel, reader and in-page highlights stay current.
function broadcast(method, args) {
  const sourceId = args.sourceId || (/Source$/.test(method) ? args.id : undefined);
  const msg = { type: 'nm-changed', method, sourceId };
  chrome.runtime.sendMessage(msg).catch(() => {});
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id) send(tab.id, msg);
    }
  });
}
