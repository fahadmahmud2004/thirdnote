// Turns live page HTML into a small, safe subset we can store and re-render.
// KaTeX math is replaced by its MathML, which Chrome renders natively.
// Exposes globalThis.NMSanitize.
(function () {
  const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
  const DROP = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'button', 'input', 'textarea', 'select', 'form',
    'noscript', 'link', 'meta', 'svg', 'canvas', 'video', 'audio', 'template', 'dialog',
  ]);
  const KEEP = new Set([
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup', 'a', 'img', 'table', 'thead', 'tbody',
    'tfoot', 'tr', 'th', 'td', 'caption', 'div', 'span', 'details', 'summary', 'figure', 'figcaption',
    'kbd', 'small', 'dl', 'dt', 'dd', 'mark',
  ]);
  const ATTRS = {
    a: ['href', 'title'], img: ['src', 'alt', 'data-w', 'data-part'], div: ['data-post', 'data-part'], p: ['data-part'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'], ol: ['start'], code: ['data-lang'], mark: ['data-c'],
  };
  // Labels only screen readers see, e.g. "You said" on Gemini.
  const HIDDEN_UI = '.sr-only, .cdk-visually-hidden, .visually-hidden, .screen-reader-only, .katex-html, .MJX_Assistive_MathML';
  const BLOCK = /^(p|div|li|h[1-6]|pre|blockquote|tr|table|ul|ol|dl|dt|dd|figure|figcaption|details|summary|hr|br)$/;

  function isHiddenUi(el) {
    return el.matches(HIDDEN_UI) || el.getAttribute('aria-hidden') === 'true';
  }

  function prepareMath(root) {
    root.querySelectorAll('.katex').forEach((k) => {
      const math = k.querySelector('math');
      if (!math) return;
      if (k.closest('.katex-display')) math.setAttribute('display', 'block');
      k.replaceWith(math);
    });
  }

  // Chat sites put a language label and copy button inside <pre>; keep only the code.
  function prepareCode(root) {
    root.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      if (!code) return;
      const lang = (code.className.match(/language-([\w+#.-]+)/) || [])[1] || code.getAttribute('data-code-language');
      if (lang) code.setAttribute('data-lang', lang);
      pre.replaceChildren(code);
    });
  }

  function cleanMath(el) {
    el.querySelectorAll('*').forEach((e) => {
      if (e.namespaceURI !== MATHML_NS) e.remove();
    });
    for (const e of [el, ...el.querySelectorAll('*')]) {
      for (const attr of Array.from(e.attributes)) {
        if (/^on|href|src|style|class/i.test(attr.name)) e.removeAttribute(attr.name);
      }
    }
  }

  function clean(parent) {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        continue;
      }
      // Whitespace that only formats the site's own HTML source.
      if (child.nodeType === Node.TEXT_NODE) {
        if (/\n/.test(child.nodeValue) && !child.nodeValue.trim() && !parent.closest?.('pre')) child.nodeValue = ' ';
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.namespaceURI === MATHML_NS) {
        cleanMath(child);
        continue;
      }
      const name = child.localName.toLowerCase();
      if (DROP.has(name) || isHiddenUi(child)) {
        child.remove();
        continue;
      }
      clean(child);
      if (!KEEP.has(name)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      // Resolve URLs while the element still knows its document's base URL.
      const href = name === 'a' ? child.href : '';
      const src = name === 'img' ? child.src : '';
      const allowed = ATTRS[name] || [];
      for (const attr of Array.from(child.attributes)) {
        if (!allowed.includes(attr.name)) child.removeAttribute(attr.name);
      }
      if (name === 'a') {
        if (/^(https?:|mailto:)/i.test(href)) {
          child.setAttribute('href', href);
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        } else {
          child.removeAttribute('href');
        }
      }
      if (name === 'img') {
        if (/^(https?:|data:image\/)/i.test(src)) child.setAttribute('src', src);
        else child.remove();
      }
    }
  }

  // Plain text with line breaks at block boundaries; math annotations skipped.
  function toText(root) {
    let out = '';
    (function walk(node) {
      for (const c of node.childNodes) {
        if (c.nodeType === Node.TEXT_NODE) {
          out += c.nodeValue;
        } else if (c.nodeType === Node.ELEMENT_NODE) {
          const name = c.localName.toLowerCase();
          if (name === 'annotation' || name === 'annotation-xml') continue;
          const block = BLOCK.test(name);
          if (block && out && !out.endsWith('\n')) out += '\n';
          walk(c);
          if (block && !out.endsWith('\n')) out += '\n';
          if (name === 'td' || name === 'th') out += ' ';
        }
      }
    })(root);
    return out
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function finish(wrap) {
    prepareMath(wrap);
    prepareCode(wrap);
    clean(wrap);
    return { html: wrap.innerHTML.trim(), text: toText(wrap) };
  }

  // Sites keep renaming their code components (ChatGPT's inline code is now a
  // styled <span>), so code is found by how it looks on the live page: text
  // set in a monospace font. Multi-line blocks become <pre><code>, the rest
  // inline <code>. Live and cloned trees are walked in the same order.
  const MONO = /mono|courier|consolas|menlo|monaco|fira code|source code|jetbrains/i;

  function markCode(live, clone) {
    const liveAll = [live, ...live.querySelectorAll('*')];
    const cloneAll = [clone, ...clone.querySelectorAll('*')];
    if (liveAll.length !== cloneAll.length) return;
    const blocks = [];
    const inlines = [];
    for (let i = 0; i < liveAll.length; i++) {
      const node = liveAll[i];
      if (node.namespaceURI === MATHML_NS || node.closest('pre, .katex, math')) continue;
      if (blocks.some((b) => liveAll[b].contains(node)) || inlines.some((b) => liveAll[b].contains(node))) continue;
      const cs = getComputedStyle(node);
      if (!MONO.test(cs.fontFamily) || !node.textContent.trim()) continue;
      const block = !/^inline/.test(cs.display);
      const text = node.innerText ?? node.textContent;
      if (block && /\n/.test(text.trim())) blocks.push(i);
      else if (!block || node.localName !== 'code') inlines.push(i);
    }
    for (const i of blocks) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = (liveAll[i].innerText ?? liveAll[i].textContent).replace(/\n$/, '');
      pre.appendChild(code);
      cloneAll[i].replaceWith(pre);
    }
    for (const i of inlines) {
      if (cloneAll[i].localName === 'code') continue;
      const code = document.createElement('code');
      code.textContent = liveAll[i].textContent;
      cloneAll[i].replaceWith(code);
    }
  }

  function fromElement(el) {
    const wrap = document.createElement('div');
    const clone = el.cloneNode(true);
    try {
      if (el.isConnected) markCode(el, clone);
    } catch { /* best effort: plain clone still works */ }
    wrap.appendChild(clone);
    return finish(wrap);
  }

  function fromRange(range) {
    const wrap = document.createElement('div');
    const anc = range.commonAncestorContainer;
    const pre = (anc.nodeType === Node.ELEMENT_NODE ? anc : anc.parentElement)?.closest('pre');
    if (pre) {
      const p = document.createElement('pre');
      p.appendChild(range.cloneContents());
      wrap.appendChild(p);
    } else {
      wrap.appendChild(range.cloneContents());
    }
    return finish(wrap);
  }

  // A whole web page, kept readable: the main content area only, without
  // menus, sidebars, footers, hidden elements, tiny icons or our own UI.
  const PAGE_SKIP = [
    'nav', 'aside', 'footer', 'header', 'form', '#notemate-root',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
    '[role="search"]', '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="menubar"]', '[role="toolbar"]', '[role="tablist"]',
    '[aria-modal="true"]', '[hidden]', '.sr-only', '.visually-hidden',
  ].join(', ');

  // Other browser extensions write their own badges into pages (video stats,
  // price trackers, grammar tips). They are not the page, so they are left
  // out: by their names, and by links that point back to an extension.
  const EXT_NAME = /(^|[\s_-])(vidiq|vid-iq|tubebuddy|grammarly|keepa|wappalyzer|maxai|glasp)/i;
  const EXT_LINK = /^(chrome|moz)-extension:|[?&]utm_medium=(chrome[_-]?)?extension|[?&]utm_source=(chrome[_-]?)?extension/i;

  function extensionUi(el) {
    if (EXT_NAME.test(el.localName) || EXT_NAME.test(el.id || '') || EXT_NAME.test(typeof el.className === 'string' ? el.className : '')) return el;
    if (el.localName !== 'a' || !EXT_LINK.test(el.getAttribute('href') || '')) return null;
    // The badge around the link: grow while it holds only short text and no
    // other real link or picture.
    let box = el;
    for (let up = el.parentElement; up && up !== el.ownerDocument.body; up = up.parentElement) {
      const others = [...up.querySelectorAll('a[href], img')].some((x) => x !== el && !(x.localName === 'a' && EXT_LINK.test(x.getAttribute('href') || '')));
      if (others || (up.innerText || '').trim().length > 120) break;
      box = up;
    }
    return box;
  }

  function pageRoot(doc) {
    const text = (el) => (el?.innerText || '').trim().length;
    const picks = [...doc.querySelectorAll('main, [role="main"], article, #content, #main')]
      .filter((el) => text(el) > 200);
    // The largest candidate that still holds most of the page's main text.
    picks.sort((a, b) => text(b) - text(a));
    const best = picks[0];
    return best && text(best) > text(doc.body) * 0.3 ? best : doc.body;
  }

  // ---------------------------------------------------------------------------
  // Feeds (Facebook, Instagram, X, Reddit, LinkedIn...): a page made of many
  // similar posts. Each post is rebuilt as a small card: who posted, when, a
  // short link to the post, its text and pictures. Buttons, counters,
  // comments and other screen furniture are left out, so posts stay apart.

  const POST_UNIT = 'article, [role="article"], [aria-posinset], [role="feed"] > *';
  const POST_LINK = /\/(posts|permalink|photo|photos|p|reel|reels|status|videos?|watch|comments|story\.php)\b|story_fbid=|[?&]v=/i;
  const TIME_TEXT = /^(\d+\s?(s|m|h|d|w|y|mo|min|mins|hr|hrs|sec|secs|day|days|week|weeks|month|months|year|years)\b.*|just now|yesterday.*|today.*|\d{1,2}\s\w+(\s\d{4})?|\w+\s\d{1,2}(,\s\d{4})?(\sat\s.*)?)$/i;
  const JUNK_LINE = /^(like|likes|love|comment|comments|share|shares|reply|replies|follow|following|message|send|save|saved|more|see more|see less|see translation|see original|view more comments|view more replies|view all \d+ comments?|view \d+ (more )?repl(y|ies)|suggested for you|sponsored|original audio|edited|author|top fan|most relevant|all comments|newest|write a (public )?comment.*|add a comment.*|and \d+ others?|reels?|posted to|[·•…|.,:-])$/i;
  const COUNT_LINE = /^[\d\s.,:/·•+%KMBkmb()-]+$|^\d+(\.\d+)?x$/; // counters, durations, "1x" playback speed
  // "118 reactions", "12K views", "Liked by Sara and 40 others": shown as one
  // line of numbers under the post instead of loose text.
  const STAT = /(\d[\d.,]*\s?[KMBkmb]?)\s*(likes?|reactions?|comments?|shares?|views?|plays?|reposts?|retweets?|replies|upvotes?|points?|watching)\b/i;
  const LIKED_BY = /^liked by .{1,80}$/i;
  const GIBBERISH = /^(?=\S*\d)(?=\S*[a-z])\S{20,}$/i; // scrambled anti-copy text

  const isBlockDisplay = (el) => {
    const d = getComputedStyle(el).display;
    return d !== 'none' && d !== 'contents' && !/^inline/.test(d);
  };
  const shown = (el) => !el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true });

  function outermostOf(els) {
    return els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
  }

  function feedUnits(root) {
    const units = outermostOf([...root.querySelectorAll(POST_UNIT)])
      .filter((el) => shown(el) && (el.textContent.trim() || el.querySelector('img')));
    if (units.length < 2) return null;
    // A long article with a few small "related" cards beside it is not a feed.
    const sizes = units.map((u) => (u.innerText || '').length);
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    if (Math.max(...sizes) > total * 0.6) return null;
    return units;
  }

  // Pages of repeated cards without post markup (a YouTube grid, a shop
  // listing): the most repeated block that holds a picture and a link.
  function cardUnits(root) {
    const sig = (el) => `${el.localName}.${[...el.classList].sort().join('.')}`;
    const counts = new Map();
    for (const img of root.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (r.width < 120 || r.height < 60) continue;
      for (let el = img.parentElement; el && el !== root; el = el.parentElement) {
        const p = el.parentElement;
        if (!p || !el.querySelector('a[href]')) continue;
        const k = sig(el);
        if ([...p.children].filter((c) => sig(c) === k).length < 3) continue;
        counts.set(k, (counts.get(k) || 0) + 1);
        break;
      }
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 4) return null;
    return outermostOf([...root.querySelectorAll(best[0].split('.')[0])].filter((el) => sig(el) === best[0] && shown(el)));
  }

  function goodLine(line, seen) {
    // Scrambled words are dropped from inside a line too, then any separator
    // left hanging at either end.
    const s = line.split(/\s+/).filter((w) => !GIBBERISH.test(w)).join(' ')
      .replace(/^[\s·•|,:-]+|[\s·•|,:-]+$/g, '').trim();
    if (s.length < 2 || JUNK_LINE.test(s) || COUNT_LINE.test(s) || GIBBERISH.test(s) || seen.has(s.toLowerCase())) return null;
    seen.add(s.toLowerCase());
    return s;
  }

  function postCard(u, doc) {
    const inner = outermostOf([...u.querySelectorAll(POST_UNIT)].filter((el) => el !== u)); // comments
    const out = (el) => inner.some((c) => c.contains(el)) || !!el.closest('[role="button"], button, form, [role="toolbar"], [role="menu"], nav, aside');
    const links = [...u.querySelectorAll('a[href]')].filter((a) => !out(a) && shown(a));

    const timeEl = [...u.querySelectorAll('time')].find((x) => !out(x));
    const permalink = (timeEl && timeEl.closest('a[href]'))
      || links.find((a) => POST_LINK.test(a.href) && TIME_TEXT.test(a.innerText.trim()))
      || links.find((a) => POST_LINK.test(a.href));
    let when = timeEl ? (timeEl.innerText || timeEl.getAttribute('datetime') || '').trim() : '';
    if (!when && permalink) {
      const label = (permalink.innerText || '').trim();
      if (TIME_TEXT.test(label) && label.length < 30) when = label;
      else if (TIME_TEXT.test(permalink.getAttribute('aria-label') || '')) when = permalink.getAttribute('aria-label');
    }

    const heading = [...u.querySelectorAll('h1, h2, h3, h4, h5, strong, [role="heading"]')]
      .find((x) => !out(x) && shown(x) && (x.innerText || '').trim().length > 1 && (x.innerText || '').trim().length < 80);
    const nameLink = links.find((a) => a !== permalink && !a.querySelector('img') && (() => {
      const s = (a.innerText || '').trim();
      return s.length > 1 && s.length < 60 && !TIME_TEXT.test(s) && !GIBBERISH.test(s);
    })());
    const authorEl = heading || nameLink;
    const author = authorEl ? (authorEl.innerText || '').split('\n')[0].trim() : '';

    const seen = new Set([author.toLowerCase(), when.toLowerCase()].filter(Boolean));
    // Text: the innermost blocks that hold text, in reading order.
    const els = [...u.querySelectorAll('*')];
    const holds = new Set();
    const leaves = [];
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!el.textContent.trim() || out(el) || el.closest('a') === permalink && permalink) continue;
      if (/^(script|style|noscript|svg|button|time)$/.test(el.localName) || !isBlockDisplay(el)) continue;
      if (!holds.has(el)) leaves.push(el);
      for (let up = el.parentElement; up && up !== u && !holds.has(up); up = up.parentElement) holds.add(up);
    }
    leaves.reverse();
    const lines = [];
    const stats = new Map(); // kind -> text
    const addStat = (text) => {
      const m = text.match(STAT);
      const kind = m ? m[2].toLowerCase().replace(/s$/, '') : 'liked';
      if (!stats.has(kind) && stats.size < 4) stats.set(kind, text.replace(/\s+/g, ' ').trim());
    };
    for (const el of leaves) {
      if (authorEl && (authorEl === el || authorEl.contains(el))) continue;
      if (!shown(el)) continue;
      for (const raw of (el.innerText || '').split('\n')) {
        const t = raw.replace(/\s+/g, ' ').trim();
        if (t.length < 60 && (STAT.test(t) || LIKED_BY.test(t))) {
          addStat(t);
          continue;
        }
        const line = goodLine(raw, seen);
        if (line) lines.push(line);
      }
    }
    // Counts that sites only put in labels for screen readers or on buttons.
    for (const el of u.querySelectorAll('[aria-label], [role="button"], button')) {
      if (inner.some((c) => c.contains(el))) continue;
      for (const t of [el.getAttribute('aria-label') || '', el.innerText || '']) {
        const m = t.length < 80 && t.match(STAT);
        if (m) addStat(`${m[1].trim()} ${m[2].toLowerCase()}`);
      }
    }

    // The poster's round picture, if there is one near the top.
    let avatar = null;
    for (const img of u.querySelectorAll('img')) {
      if (out(img) || !shown(img)) continue;
      const r = img.getBoundingClientRect();
      if (r.width >= 20 && r.width <= 72 && Math.abs(r.width - r.height) < 8) {
        avatar = img.currentSrc || img.src;
        break;
      }
      if (r.width >= 120) break;
    }

    const pics = [];
    const srcs = new Set();
    const width = u.getBoundingClientRect().width || 1;
    for (const img of u.querySelectorAll('img')) {
      if (out(img) || !shown(img)) continue;
      const r = img.getBoundingClientRect();
      const src = img.currentSrc || img.src;
      if (r.width < 120 || r.height < 80 || !src || srcs.has(src)) continue;
      srcs.add(src);
      pics.push({ src, alt: img.alt || '', w: Math.round(Math.min(70, Math.max(25, (r.width / width) * 100))) });
    }

    if (!author && !lines.length && !pics.length) return null;
    const el = (tag, text, part) => {
      const e = doc.createElement(tag);
      if (text) e.textContent = text;
      if (part) e.setAttribute('data-part', part);
      return e;
    };
    const card = el('div');
    card.setAttribute('data-post', '');
    if (author || when || permalink) {
      const head = el('div', '', 'head');
      if (avatar) {
        const img = el('img', '', 'avatar');
        img.setAttribute('src', avatar);
        img.setAttribute('alt', '');
        head.append(img);
      }
      const who = el('p', '', 'who');
      if (author) who.append(el('strong', author));
      if (when || permalink) {
        const small = el('small');
        if (when) small.append(when);
        if (when && permalink) small.append(' · ');
        if (permalink) {
          const a = el('a', globalThis.NM?.t ? NM.t('page.openPost') : 'Open post');
          a.setAttribute('href', permalink.href);
          small.append(a);
        }
        if (author) who.append(el('br'));
        who.append(small);
      }
      head.append(who);
      card.append(head);
    }
    for (const line of lines.slice(0, 60)) card.append(el('p', line));
    if (pics.length) {
      const media = el('div', '', 'media');
      for (const pic of pics.slice(0, 10)) {
        const img = el('img');
        img.setAttribute('src', pic.src);
        img.setAttribute('alt', pic.alt);
        if (pics.length > 1) img.setAttribute('data-w', String(Math.min(pic.w, 48)));
        media.append(img);
      }
      card.append(media);
    }
    if (stats.size) {
      const row = el('p', '', 'stats');
      row.append(el('small', [...stats.values()].join('  ·  ')));
      card.append(row);
    }
    return card;
  }

  function fromFeed(units, doc) {
    const wrap = doc.createElement('div');
    let n = 0;
    for (const u of units.slice(0, 150)) {
      let card = null;
      try {
        card = postCard(u, doc);
      } catch { /* skip a post we can't read */ }
      if (!card) continue;
      wrap.append(card);
      n++;
    }
    if (!n) return null;
    clean(wrap);
    return { html: wrap.innerHTML.trim(), text: toText(wrap), posts: n };
  }

  function fromPage(doc = document) {
    const root = pageRoot(doc);
    const units = feedUnits(root) || (root !== doc.body ? feedUnits(doc.body) : null) || cardUnits(root);
    if (units) {
      const feed = fromFeed(units, doc);
      if (feed) return feed;
    }
    const clone = root.cloneNode(true);
    const liveAll = [root, ...root.querySelectorAll('*')];
    const cloneAll = [clone, ...clone.querySelectorAll('*')];
    if (liveAll.length === cloneAll.length) {
      // Decide what to leave out while the live and cloned trees still match
      // node for node, then mark code, then remove.
      const drop = [];
      const index = new Map(liveAll.map((el, i) => [el, i]));
      const rootWidth = root.getBoundingClientRect().width || innerWidth;
      for (let i = 1; i < liveAll.length; i++) {
        const el = liveAll[i];
        if (el.namespaceURI === MATHML_NS) continue;
        const ext = extensionUi(el);
        if (ext && index.has(ext)) {
          drop.push(cloneAll[index.get(ext)]);
          continue;
        }
        let skip = el.matches(PAGE_SKIP) && !el.querySelector('main, article');
        if (!skip && getComputedStyle(el).display !== 'contents' && el.checkVisibility
          && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) skip = true;
        if (!skip && el.localName === 'img') {
          const r = el.getBoundingClientRect();
          if (r.width < 48 || r.height < 32) skip = true;
          // Pictures that were small on the page (thumbnails in a grid) stay
          // small in the saved copy, as a share of the line's width.
          const share = (r.width / rootWidth) * 100;
          if (!skip && share < 70) cloneAll[i].setAttribute('data-w', String(Math.round(Math.min(40, Math.max(18, share)))));
        }
        if (skip) drop.push(cloneAll[i]);
      }
      try {
        markCode(root, clone);
      } catch { /* best effort */ }
      drop.forEach((el) => el.remove());
    }
    const tidy = doc.createElement('div');
    tidy.appendChild(clone);
    prepareMath(tidy);
    prepareCode(tidy);
    clean(tidy);
    // Tidy: drop blocks left empty once the page's UI was removed.
    let changed = true;
    while (changed) {
      changed = false;
      tidy.querySelectorAll('div, span, p, li, ul, ol, figure, td, tr, table, a, strong, em, b, i').forEach((el) => {
        if (!el.textContent.trim() && !el.querySelector('img, math, hr, br')) {
          el.remove();
          changed = true;
        }
      });
    }
    // Unwrap divs and spans: the stored copy only needs the real blocks.
    tidy.querySelectorAll('span').forEach((el) => el.replaceWith(...el.childNodes));
    tidy.querySelectorAll('div').forEach((el) => {
      if (el.querySelector(':scope > p, :scope > ul, :scope > ol, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > pre, :scope > table, :scope > div, :scope > figure, :scope > blockquote')) {
        el.replaceWith(...el.childNodes);
      }
    });
    tidy.querySelectorAll('div').forEach((el) => {
      const p = doc.createElement('p');
      p.append(...el.childNodes);
      el.replaceWith(p);
    });
    return { html: tidy.innerHTML.replace(/\s{2,}/g, ' ').trim(), text: toText(tidy) };
  }

  // Re-sanitizes stored HTML before it is rendered in an extension page.
  function cleanHtml(html) {
    const doc = new DOMParser().parseFromString(`<!doctype html><body><div>${html || ''}</div>`, 'text/html');
    const wrap = doc.body.firstElementChild;
    clean(wrap);
    return wrap.innerHTML;
  }

  // Images keep a width (percent of the line) in data-w, since inline styles
  // are not stored. This applies it after rendering.
  function sizeImages(root) {
    if (!root) return;
    // Repair: an image frame dropped inside another one goes beside it.
    root.querySelectorAll('figure figure').forEach((inner) => {
      let outer = inner.parentElement.closest('figure');
      while (outer.parentElement?.closest('figure')) outer = outer.parentElement.closest('figure');
      outer.after(inner);
    });
    root.querySelectorAll('.nm-sized').forEach((el) => {
      el.classList.remove('nm-sized');
      el.style.width = '';
    });
    root.querySelectorAll('img').forEach((img) => {
      const w = Number(img.dataset.w);
      const fig = img.parentElement?.tagName === 'FIGURE' && img.parentElement.querySelectorAll('img').length === 1 ? img.parentElement : null;
      const box = fig || img;
      if (w > 0 && w < 100) {
        box.style.width = `calc(${w}% - 10px)`;
        box.classList.add('nm-sized');
        if (fig) img.style.width = '100%';
      } else {
        box.style.width = '';
        box.classList.remove('nm-sized');
        img.style.width = '';
      }
    });
  }

  globalThis.NMSanitize = { fromElement, fromRange, fromPage, cleanHtml, toText, sizeImages };
})();
