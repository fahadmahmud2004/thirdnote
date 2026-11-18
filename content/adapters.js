// One adapter per chat site: how to find the conversation id, the messages,
// and whether an answer is still being written. These selectors are the part
// most likely to break when a site changes its layout, so fix them here.
// Exposes globalThis.NMAdapters.
(function () {
  function outermost(els) {
    return els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
  }

  // ---------------------------------------------------------------------------
  // General reader. Sites rename their classes and attributes all the time, so
  // this one uses none of them. It finds the conversation by its shape: the
  // area above the prompt box that holds most of the text, split into turns.
  // Who said what comes from words in the markup ("user", "assistant",
  // "markdown") when there are any, else from layout: a question is a narrower
  // bubble pushed to the right.

  const USER_HINT = /(^|[\s_:-])(user|human|query|prompt|question|request|you)([\s_:-]|$)|user-?message|from-?user/i;
  const AI_HINT = /(^|[\s_:-])(assistant|model|response|answer|bot|ai|markdown|prose)([\s_:-]|$)|model-?response|assistant-?message/i;
  const SKIP_AREA = 'nav, aside, header, footer, form, [role="navigation"], [role="complementary"], [role="banner"], #notemate-root';

  const textLen = (el) => (el.innerText || '').trim().length;

  function visible(el) {
    // A wrapper with display: contents has no box of its own but shows its children.
    if (getComputedStyle(el).display === 'contents') return [...el.children].some(visible);
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // The box an element takes on screen, including display: contents wrappers.
  function rectOf(el) {
    if (getComputedStyle(el).display !== 'contents') return el.getBoundingClientRect();
    const rs = [...el.children].map(rectOf).filter((r) => r.width || r.height);
    if (!rs.length) return new DOMRect();
    const left = Math.min(...rs.map((r) => r.left));
    const top = Math.min(...rs.map((r) => r.top));
    return new DOMRect(left, top, Math.max(...rs.map((r) => r.right)) - left, Math.max(...rs.map((r) => r.bottom)) - top);
  }

  function composer() {
    const boxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]')]
      .filter((el) => visible(el) && !el.closest('#notemate-root'));
    // The prompt box is the lowest one on screen.
    boxes.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    return boxes[0] || null;
  }

  // Children that carry text. Notes printed under the prompt box ("AI can
  // make mistakes") are not part of the conversation.
  function textKids(el, box) {
    const below = box ? box.getBoundingClientRect().top : Infinity;
    return [...el.children].filter((c) => !c.matches(SKIP_AREA) && !(box && c.contains(box)) && visible(c)
      && textLen(c) > 0 && rectOf(c).top < below);
  }

  // The element whose children are the turns of the conversation. Starting
  // at the prompt box and walking up, the first sizeable block of text beside
  // it is the conversation. Inside that, wrappers with a single child are
  // skipped until the turns themselves appear side by side.
  function transcript() {
    const box = composer();
    let el = null;
    for (let child = box, parent = box?.parentElement; parent && parent !== document.documentElement; child = parent, parent = parent.parentElement) {
      const others = [...parent.children].filter((c) => c !== child && !c.matches(SKIP_AREA) && visible(c));
      const best = others.reduce((a, c) => (!a || textLen(c) > textLen(a) ? c : a), null);
      if (best && textLen(best) >= 80) {
        el = best;
        break;
      }
    }
    if (!el) el = document.querySelector('main, [role="main"]') || document.body;
    for (let depth = 0; depth < 40; depth++) {
      const kids = textKids(el, box);
      if (kids.length === 1) {
        el = kids[0];
        continue;
      }
      return kids.length >= 2 ? el : null;
    }
    return null;
  }

  function hintScore(el) {
    let user = 0;
    let ai = 0;
    const nodes = [el, ...el.querySelectorAll('*')].slice(0, 80);
    for (const n of nodes) {
      for (const a of n.attributes) {
        if (!(a.name.startsWith('data-') || a.name === 'class' || a.name === 'aria-label' || a.name === 'role')) continue;
        const s = `${a.name.replace(/^data-/, '')} ${a.value}`;
        if (USER_HINT.test(s)) user++;
        if (AI_HINT.test(s)) ai++;
      }
    }
    return { user, ai };
  }

  // Where the text actually sits inside a turn, as a share of the turn's width.
  function textBox(turn) {
    const outer = rectOf(turn);
    let left = Infinity;
    let right = -Infinity;
    const walker = document.createTreeWalker(turn, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let n;
    let count = 0;
    while ((n = walker.nextNode()) && count < 200) {
      if (!n.nodeValue.trim()) continue;
      count++;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
    }
    if (!outer.width || left === Infinity) return null;
    return { left: (left - outer.left) / outer.width, width: (right - left) / outer.width };
  }

  function generalMessages() {
    const list = transcript();
    if (!list) return [];
    const turns = textKids(list, composer()).filter((c) => textLen(c) > 1);
    if (turns.length < 2) return [];
    const roles = turns.map((turn) => {
      const { user, ai } = hintScore(turn);
      if (user !== ai) return user > ai ? 'user' : 'assistant';
      const box = textBox(turn);
      if (box && box.left > 0.2 && box.width < 0.78) return 'user';
      return null;
    });
    // No signal at all: chats alternate, starting with a question.
    if (roles.every((r) => !r)) roles.forEach((_, i) => { roles[i] = i % 2 ? 'assistant' : 'user'; });
    else roles.forEach((r, i) => { if (!r) roles[i] = 'assistant'; });
    return turns.map((el, i) => ({ el, role: roles[i], key: `${roles[i]}-${i}`, contentEl: el, imgRoot: el }));
  }

  // Runs each layout reader and keeps the one that found the most messages,
  // preferring one that found answers as well as questions. The general
  // reader is a guess and costs more, so it only runs when the site's own
  // readers found no answers.
  const hasBoth = (ms) => ms.some((m) => m.role === 'user') && ms.some((m) => m.role === 'assistant');

  function bestOf(layouts) {
    let best = [];
    let bestScore = -1;
    for (const read of layouts) {
      if (read === generalMessages && hasBoth(best)) break;
      let found;
      try {
        found = read().filter(Boolean);
      } catch {
        continue;
      }
      if (read === generalMessages) return hasBoth(found) ? found : best;
      const score = found.length + (hasBoth(found) ? 1000 : 0);
      if (score > bestScore) {
        best = found;
        bestScore = score;
      }
    }
    return best;
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
      // /c/<id> for saved chats, /uc/<id> for chats without an account.
      m = loc.pathname.match(/\/u?c\/([\w-]+)/);
      return m ? { type: 'chat', id: m[1] } : null;
    },
    messageEls() {
      // ChatGPT has shipped several layouts; read them all and use the one
      // that finds the most messages.
      const layouts = [
        // Current layout: one <li data-message-role> per message.
        () => outermost([...document.querySelectorAll('li[data-message-role], [data-message-role]:not([data-message-author-role])')])
          .map((el, i) => {
            const role = el.getAttribute('data-message-role');
            if (role !== 'user' && role !== 'assistant') return null;
            const answers = el.querySelectorAll('[data-assistant-markdown-root]');
            const contentEl = role === 'user'
              ? el.querySelector('[data-user-message-bubble]') || el
              : answers.length === 1 ? answers[0] : el;
            return { el, role, key: el.id || `${role}-${i}`, contentEl, imgRoot: el };
          }),
        // Older layout (still used on share pages): one element per message.
        () => outermost([...document.querySelectorAll('[data-message-author-role]')])
          .map((el, i) => {
            const author = el.getAttribute('data-message-author-role');
            if (author !== 'user' && author !== 'assistant') return null;
            return {
              el,
              role: author,
              key: el.getAttribute('data-message-id') || `${author}-${i}`,
              contentEl: el.querySelector('.markdown') || el.querySelector('.whitespace-pre-wrap') || el,
              imgRoot: el.closest('article, [data-testid^="conversation-turn"]') || el,
            };
          }),
        // "Units" whose key ends in :user or :assistant.
        () => outermost([...document.querySelectorAll('[data-content-search-unit-key]')])
          .map((el, i) => {
            const unit = el.getAttribute('data-content-search-unit-key') || '';
            const role = /:user$/.test(unit) ? 'user' : /:assistant$/.test(unit) ? 'assistant' : null;
            if (!role) return null;
            const answers = el.querySelectorAll('[data-markdown-text-style]');
            const contentEl = role === 'user'
              ? el.querySelector('[data-user-message-bubble] .whitespace-pre-wrap') || el.querySelector('[data-user-message-bubble]') || el
              : answers.length === 1 ? answers[0] : el;
            const id = el.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id');
            return { el, role, key: id || unit || `${role}-${i}`, contentEl, imgRoot: el };
          }),
        generalMessages,
      ];
      return bestOf(layouts);
    },
    isBusy: () => !!document.querySelector(
      '[data-testid="stop-button"], button[aria-label^="Stop" i], .result-streaming, '
      + '[data-talvt-turn-state]:not([data-talvt-turn-state="complete"]), '
      + 'li[data-message-role="assistant"]:not([data-message-complete])',
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
      const ANSWER = '.font-claude-response, .font-claude-message, [data-is-streaming]';
      const layouts = [
        // Each turn sits in its own [data-test-render-count] wrapper. User
        // turns hold [data-testid="user-message"]; anything else with text
        // is an answer, even when the answer's class names change.
        () => outermost([...document.querySelectorAll('[data-test-render-count]')]).map((turn, i) => {
          const user = turn.querySelector('[data-testid="user-message"]');
          if (user) return { el: turn, role: 'user', key: `user-${i}`, contentEl: user, imgRoot: turn };
          const answer = outermost([...turn.querySelectorAll(ANSWER)]);
          const contentEl = answer.length === 1 ? answer[0] : turn;
          if (!contentEl.textContent.trim()) return null;
          return { el: turn, role: 'assistant', key: `assistant-${i}`, contentEl, imgRoot: turn };
        }),
        () => outermost([...document.querySelectorAll(`[data-testid="user-message"], ${ANSWER}`)]).map((el, i) => {
          const role = el.matches('[data-testid="user-message"]') ? 'user' : 'assistant';
          return { el, role, key: `${role}-${i}`, contentEl: el, imgRoot: el.parentElement?.parentElement || el };
        }),
        generalMessages,
      ];
      return bestOf(layouts);
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
      return bestOf([
        () => outermost([...document.querySelectorAll('user-query, message-content')]).map((el, i) => {
          const role = el.localName === 'user-query' ? 'user' : 'assistant';
          const contentEl = role === 'user'
            ? el.querySelector('.query-text') || el.querySelector('.query-content') || el
            : el;
          return { el, role, key: `${role}-${i}`, contentEl, imgRoot: el };
        }),
        generalMessages,
      ]);
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
    generalMessages,
    detect(loc) {
      // Lets the local test pages in /test pretend to be a chat site.
      const local = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
      const testSite = local && document.documentElement.dataset.nmTestSite;
      if (testSite) return list.find((a) => a.id === testSite) || null;
      return list.find((a) => a.match(loc)) || null;
    },
  };
})();
