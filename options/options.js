const { rpc, COLORS, icon, t } = NM;
const $ = (sel) => document.querySelector(sel);

let settings = await NM.getSettings();

function flashSaved() {
  const el = $('#saved');
  el.innerHTML = `${icon('check', 14)}${NM.escapeHtml(t('op.saved'))}`;
  el.hidden = false;
  clearTimeout(flashSaved.t);
  flashSaved.t = setTimeout(() => { el.hidden = true; }, 1500);
}

async function save(patch) {
  settings = await NM.saveSettings(patch);
  render();
  flashSaved();
}

function seg(el, options, value, onPick) {
  el.replaceChildren(...options.map(([v, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = v === value ? 'on' : '';
    b.onclick = () => onPick(v);
    return b;
  }));
}

function render() {
  NM.applyPage(settings);
  seg($('#theme'), [['system', t('op.system')], ['light', t('op.light')], ['dark', t('op.dark')]], settings.theme || 'system', (v) => save({ theme: v }));
  seg($('#lang'), [['en', 'English'], ['bn', 'বাংলা']], settings.lang || 'en', (v) => save({ lang: v }));

  const sites = [['chatgpt', 'ChatGPT', 'chatgpt.com'], ['claude', 'Claude', 'claude.ai'], ['gemini', 'Gemini', 'gemini.google.com'],
    ['other', 'NotebookLM, DeepSeek, Perplexity…', 'Grok, Copilot, Le Chat, Poe, Qwen, Kimi, Meta AI']];
  $('#sites').replaceChildren(...sites.map(([id, name, host]) => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = '<div class="t"><div class="n"></div><div class="d"></div></div><button class="switch"></button>';
    item.querySelector('.n').textContent = name;
    item.querySelector('.d').textContent = host;
    const sw = item.querySelector('.switch');
    sw.setAttribute('aria-checked', String(settings.sites[id] !== false));
    sw.onclick = () => save({ sites: { ...settings.sites, [id]: settings.sites[id] === false } });
    return item;
  }));

  document.querySelectorAll('.switch[data-key]').forEach((sw) => {
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(!!settings[sw.dataset.key]));
    sw.onclick = () => save({ [sw.dataset.key]: !settings[sw.dataset.key] });
  });

  $('#minChars').value = settings.minChars;

  $('#colors').replaceChildren(...COLORS.map((c, i) => {
    const row = document.createElement('div');
    row.className = 'colour';
    row.innerHTML = `<span class="sw" style="background:${c.swatch}"></span><input type="text"><span class="kbd">${i + 1}</span>`;
    const input = row.querySelector('input');
    input.value = NM.label(c.id);
    input.onchange = () => {
      const v = input.value.trim();
      const labels = { ...settings.colorLabels };
      if (!v || v === t(`color.${c.id}`)) delete labels[c.id];
      else labels[c.id] = v;
      save({ colorLabels: labels });
    };
    return row;
  }));

  $('#export').innerHTML = `${icon('download', 15)}<span>${NM.escapeHtml(t('op.download'))}</span>`;
  showStats();
}

$('#minChars').addEventListener('change', (e) => save({ minChars: Math.max(0, Number(e.target.value) || 0) }));

$('#shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

async function showStats() {
  const { topics, sources } = await rpc('getLibrary');
  const hls = sources.reduce((n, s) => n + s.highlightCount, 0);
  $('#stats').textContent = t('op.stats', { t: topics.length, s: sources.length, h: hls });
}

$('#export').addEventListener('click', async () => {
  const data = await rpc('exportAll');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `thirdnote-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const counts = await rpc('importAll', { data });
    alert(t('op.restored', { s: counts.sources, h: counts.highlights }));
    showStats();
  } catch (err) {
    alert(t('op.restoreFail', { msg: err.message }));
  }
  e.target.value = '';
});

render();
