import { api, MUTATING } from './lib/api.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'nm-save-selection', title: 'Save selection to ThirdNote', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'nm-save-page', title: 'Save this whole page to ThirdNote', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'nm-capture', title: 'Capture an area to ThirdNote', contexts: ['page', 'image', 'video', 'link'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'nm-save-selection') send(tab.id, { type: 'nm-context-save' });
  if (info.menuItemId === 'nm-save-page') send(tab.id, { type: 'nm-save-page' });
  if (info.menuItemId === 'nm-capture') send(tab.id, { type: 'nm-capture', mode: 'area' });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'capture-area' && tab?.id) send(tab.id, { type: 'nm-capture', mode: 'area' });
  if (command === 'save-page' && tab?.id) send(tab.id, { type: 'nm-save-page' });
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
    if (method === 'fetchImage') return { ok: true, result: await fetchImage(args.url) };
    if (method === 'readFrames') return { ok: true, result: await readFrames(sender.tab?.id, args.area) };
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

// What the page shows inside its frames (Excel on the web and other apps
// that run their document in a frame from another site). Only on Save page.
async function readFrames(tabId, area = 0) {
  if (!tabId) return [];
  const target = { tabId, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: ['lib/sanitize.js'] });
    const results = await chrome.scripting.executeScript({
      target,
      args: [area],
      // Only big frames: the document an app shows, not an embedded video or an ad.
      func: (topArea) => {
        if (window.top === window || innerWidth * innerHeight < topArea * 0.4) return null;
        try {
          const page = globalThis.NMSanitize.fromPage(document);
          return page.text.length > 40 ? { url: location.href, html: page.html, text: page.text, size: innerWidth * innerHeight } : null;
        } catch {
          return null;
        }
      },
    });
    return results.map((r) => r.result).filter(Boolean).sort((a, b) => b.size - a.size).slice(0, 4);
  } catch {
    return [];
  }
}

// An image from a page, as a data: URL a saved copy can keep. Fetched here
// because the extension may read any site, which a page's own script can't.
async function fetchImage(url) {
  if (!/^https?:/i.test(url || '')) return '';
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return '';
    let blob = await res.blob();
    if (!/^image\//.test(blob.type)) return '';
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (scale < 1 || blob.size > 400000) {
      const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${blob.type};base64,${btoa(bin)}`;
  } catch {
    return '';
  }
}
