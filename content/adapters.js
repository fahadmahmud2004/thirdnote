// One adapter per chat site: how to find the conversation id, the messages,
// and whether an answer is still being written. These selectors are the part
// most likely to break when a site changes its layout, so fix them here.
// Exposes globalThis.NMAdapters.
(function () {
  function outermost(els) {
    return els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
  }

  function firstQuestion(list) {
    const u = list.find((m) => m.role === 'user');
    const t = (u ? NMSanitize.fromElement(u.contentEl).text : '').replace(/\s+/g, ' ').trim();
    return t.length > 70 ? `${t.slice(0, 70)}…` : t;
  }

  function cleanTitle(raw, generic, list) {
    const t = (raw || '').trim().replace(/\s+/g, ' ');
    if (!t || generic.includes(t.toLowerCase())) return firstQuestion(list) || 'Untitled chat';
    return t;
  }

  const chatgpt = {
    id: 'chatgpt',
    name: 'ChatGPT',
    match: (loc) => /(^|\.)chatgpt\.com$/.test(loc.hostname) || loc.hostname === 'chat.openai.com',
    pageInfo(loc) {
      let m = loc.pathname.match(/\/share\/([\w-]+)/);
      if (m) return { type: 'share', id: m[1] };
      m = loc.pathname.match(/\/c\/([\w-]+)/);
      return m ? { type: 'chat', id: m[1] } : null;
    },
    messageEls() {
      // Older layout (still used on share pages): one element per message.
      const old = outermost([...document.querySelectorAll('[data-message-author-role]')]);
      if (old.length) {
        return old
          .map((el, i) => {
            const author = el.getAttribute('data-message-author-role');
            if (author !== 'user' && author !== 'assistant') return null;
            return {
              el,
              role: author,
              key: el.getAttribute('data-message-id') || `${author}-${i}`,
              contentEl: el.querySelector('.markdown') || el.querySelector('.whitespace-pre-wrap') || el,
            };
          })
          .filter(Boolean);
      }
      // Current layout: "units" whose key ends in :user or :assistant.
      return outermost([...document.querySelectorAll('[data-content-search-unit-key]')])
        .map((el, i) => {
          const unit = el.getAttribute('data-content-search-unit-key') || '';
          const role = /:user$/.test(unit) ? 'user' : /:assistant$/.test(unit) ? 'assistant' : null;
          if (!role) return null;
          const answers = el.querySelectorAll('[data-markdown-text-style]');
          const contentEl = role === 'user'
            ? el.querySelector('[data-user-message-bubble] .whitespace-pre-wrap') || el.querySelector('[data-user-message-bubble]') || el
            : answers.length === 1 ? answers[0] : el;
          const id = el.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id');
          return { el, role, key: id || unit || `${role}-${i}`, contentEl };
        })
        .filter(Boolean);
    },
    isBusy: () => !!document.querySelector(
      '[data-testid="stop-button"], .result-streaming, [data-talvt-turn-state]:not([data-talvt-turn-state="complete"])',
    ),
    title() {
      return cleanTitle(document.title.replace(/\s*[-|–]\s*ChatGPT\s*$/i, ''), ['chatgpt', 'new chat'], this.messageEls());
    },
  };

  const claude = {
    id: 'claude',
    name: 'Claude',
    match: (loc) => loc.hostname === 'claude.ai',
    pageInfo(loc) {
      let m = loc.pathname.match(/\/share\/([\w-]+)/);
      if (m) return { type: 'share', id: m[1] };
      m = loc.pathname.match(/\/chat\/([\w-]+)/);
      return m ? { type: 'chat', id: m[1] } : null;
    },
    messageEls() {
      const els = outermost([
        ...document.querySelectorAll('[data-testid="user-message"], .font-claude-response, .font-claude-message'),
      ]);
      return els.map((el, i) => {
        const role = el.matches('[data-testid="user-message"]') ? 'user' : 'assistant';
        return { el, role, key: `${role}-${i}`, contentEl: el };
      });
    },
    isBusy: () => !!document.querySelector('[data-is-streaming="true"]'),
    title() {
      return cleanTitle(document.title.replace(/\s*[-|–—]\s*Claude\s*$/i, ''), ['claude', 'new chat'], this.messageEls());
    },
  };

  const gemini = {
    id: 'gemini',
    name: 'Gemini',
    match: (loc) => loc.hostname === 'gemini.google.com',
    pageInfo(loc) {
      let m = loc.pathname.match(/\/share\/([\w-]+)/);
      if (m) return { type: 'share', id: m[1] };
      m = loc.pathname.match(/\/app\/([\w-]+)/) || loc.pathname.match(/\/gem\/[^/]+\/([\w-]+)/);
      return m ? { type: 'chat', id: m[1] } : null;
    },
    // Chat pages wrap answers in <model-response>; share pages only have
    // <message-content>, so match that directly.
    messageEls() {
      return outermost([...document.querySelectorAll('user-query, message-content')]).map((el, i) => {
        const role = el.localName === 'user-query' ? 'user' : 'assistant';
        const contentEl = role === 'user'
          ? el.querySelector('.query-text') || el.querySelector('.query-content') || el
          : el;
        return { el, role, key: `${role}-${i}`, contentEl };
      });
    },
    isBusy: () => !!document.querySelector('button[aria-label*="Stop" i]'),
    title() {
      const selected = document.querySelector('.conversation.selected .conversation-title');
      return cleanTitle(selected?.textContent, ['gemini', 'google gemini'], this.messageEls());
    },
  };

  // Other AI chat sites: no per-message parsing. The conversation area is
  // saved as one block and kept up to date while the chat grows.
  const OTHER_AI = [
    { id: 'notebooklm', host: /^notebooklm\.google\.com$/ },
    { id: 'deepseek', host: /^chat\.deepseek\.com$/ },
    { id: 'perplexity', host: /(^|\.)perplexity\.ai$/ },
    { id: 'grok', host: /^(grok\.com|x\.com)$/, path: /^\/(c|chat|i\/grok)/ },
    { id: 'copilot', host: /^copilot\.microsoft\.com$/ },
    { id: 'mistral', host: /^chat\.mistral\.ai$/ },
    { id: 'poe', host: /^poe\.com$/ },
    { id: 'qwen', host: /^chat\.qwen\.ai$/ },
    { id: 'kimi', host: /(^|\.)kimi\.(com|ai)$/ },
    { id: 'metaai', host: /^(www\.)?meta\.ai$/ },
  ];

  function otherAi(site) {
    const root = () => document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    return {
      id: site.id,
      generic: true,
      match: (loc) => site.host.test(loc.hostname) && (!site.path || site.path.test(loc.pathname)),
      pageInfo(loc) {
        if (loc.pathname.length <= 1 && !loc.search) return null;
        const share = /\/(share|s)\//.test(loc.pathname);
        return { type: share ? 'share' : 'chat', id: `${loc.pathname}${loc.search}`.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') };
      },
      messageEls() {
        const el = root();
        return el ? [{ el, role: 'assistant', key: 'page', contentEl: el }] : [];
      },
      isBusy: () => !!document.querySelector('button[aria-label*="Stop" i]'),
      title() {
        const t = document.title.replace(/\s*[-|–—]\s*[^-|–—]+$/, '').trim();
        return t || document.title || site.id;
      },
    };
  }

  const list = [chatgpt, claude, gemini, ...OTHER_AI.map(otherAi)];

  globalThis.NMAdapters = {
    list,
    detect(loc) {
      // Lets the local test pages in /test pretend to be a chat site.
      const local = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
      const testSite = local && document.documentElement.dataset.nmTestSite;
      if (testSite) return list.find((a) => a.id === testSite) || null;
      return list.find((a) => a.match(loc)) || null;
    },
  };
})();
