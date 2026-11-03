// Shared constants and helpers. Loaded as a classic script by content scripts
// and extension pages; exposes globalThis.NM.
(function () {
  // `swatch` is the dot in pickers; `mark` is the highlight colour on a page.
  const COLORS = [
    { id: 'yellow', swatch: '#F2C94C', mark: 'rgba(242, 201, 76, 0.42)' },
    { id: 'red', swatch: '#EB6F5C', mark: 'rgba(235, 111, 92, 0.32)' },
    { id: 'green', swatch: '#4CB871', mark: 'rgba(76, 184, 113, 0.32)' },
    { id: 'blue', swatch: '#5B8DEF', mark: 'rgba(91, 141, 239, 0.32)' },
  ];

  const DEFAULT_SETTINGS = {
    sites: { chatgpt: true, claude: true, gemini: true, other: true },
    captureQuestions: true,
    minChars: 0,
    autoTrack: false,
    toolbarEverywhere: true,
    theme: 'system', // 'system' | 'light' | 'dark'
    lang: 'en', // 'en' | 'bn'
    colorLabels: {}, // user's own names; defaults come from i18n
  };

  const SITES = {
    chatgpt: { name: 'ChatGPT', short: 'GPT', color: '#0F8F6E' },
    claude: { name: 'Claude', short: 'Cl', color: '#C2613F' },
    gemini: { name: 'Gemini', short: 'Ge', color: '#3F6FDB' },
    notebooklm: { name: 'NotebookLM', short: 'NB', color: '#4B5563', other: true },
    deepseek: { name: 'DeepSeek', short: 'DS', color: '#4D6BFE', other: true },
    perplexity: { name: 'Perplexity', short: 'Px', color: '#1F8A92', other: true },
    grok: { name: 'Grok', short: 'Gk', color: '#2A2A2A', other: true },
    copilot: { name: 'Copilot', short: 'Co', color: '#2563EB', other: true },
    mistral: { name: 'Le Chat', short: 'Mi', color: '#E2662D', other: true },
    poe: { name: 'Poe', short: 'Po', color: '#5D4BD8', other: true },
    qwen: { name: 'Qwen', short: 'Qw', color: '#6A4BEB', other: true },
    kimi: { name: 'Kimi', short: 'Ki', color: '#222831', other: true },
    metaai: { name: 'Meta AI', short: 'Me', color: '#0668E1', other: true },
    notes: { name: 'Notes', short: '', color: '#8A6D3B' },
  };

  // Settings toggles: the three dedicated sites, plus one for all the others.
  function siteEnabled(settings, id) {
    return settings.sites[SITES[id]?.other ? 'other' : id] !== false;
  }

  // Icon paths (24×24, stroke-based).
  const ICON_PATHS = {
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    refresh: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
    book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-7.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
    left: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    cap: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    notepad: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  };

  function icon(name, size = 16) {
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
  }

  async function getSettings() {
    const { settings = {} } = await chrome.storage.local.get('settings');
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      sites: { ...DEFAULT_SETTINGS.sites, ...settings.sites },
      colorLabels: { ...DEFAULT_SETTINGS.colorLabels, ...settings.colorLabels },
    };
  }

  async function saveSettings(patch) {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  // Most recently used topic ids, newest first.
  async function recentTopicIds() {
    const { recentTopics = [] } = await chrome.storage.local.get('recentTopics');
    return recentTopics;
  }

  async function useTopic(id) {
    const list = [id, ...(await recentTopicIds()).filter((x) => x !== id)].slice(0, 8);
    await chrome.storage.local.set({ recentTopics: list });
  }

  // The collection everything is saved into while "Collecting" is on.
  async function getActive() {
    const { activeTopicId = null, collecting = false } = await chrome.storage.local.get(['activeTopicId', 'collecting']);
    return { topicId: activeTopicId, on: !!(collecting && activeTopicId) };
  }

  async function setActive(patch) {
    const next = {};
    if ('topicId' in patch) next.activeTopicId = patch.topicId;
    if ('on' in patch) next.collecting = !!patch.on;
    await chrome.storage.local.set(next);
    if (patch.topicId) await useTopic(patch.topicId);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // Plain text typed by the user, as safe paragraphs.
  function textToHtml(text) {
    return String(text || '').trim().split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  }

  async function rpc(method, args) {
    const res = await chrome.runtime.sendMessage({ type: 'nm-rpc', method, args });
    if (!res || !res.ok) throw new Error(res?.error || 'ThirdNote did not respond');
    return res.result;
  }

  function siteName(source) {
    if (!source) return '';
    if (source.kind === 'page') return source.site || 'Web page';
    return SITES[source.site]?.name || source.site;
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  globalThis.NM = {
    COLORS, DEFAULT_SETTINGS, SITES, siteEnabled, icon, getSettings, saveSettings, recentTopicIds, useTopic, getActive, setActive,
    escapeHtml, textToHtml, rpc, siteName, plural, timeAgo,
  };
})();
