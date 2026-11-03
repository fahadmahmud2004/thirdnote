// Text-quote anchoring. A highlight is stored as the selected text plus a bit
// of text before and after it, all with whitespace removed. That survives
// re-rendering and the differences between a live chat page and our stored
// copy, so the same highlight can be found in both. Exposes globalThis.NMAnchor.
(function () {
  const SKIP = [
    'script', 'style', 'noscript', 'template', 'textarea', 'select', 'button', 'svg', 'iframe', 'object',
    'canvas', 'video', 'audio', 'annotation', 'annotation-xml', '.sr-only', '.cdk-visually-hidden', '.visually-hidden', '.screen-reader-only', '.MJX_Assistive_MathML', '[aria-hidden="true"]', '.katex-html',
    '#notemate-root',
  ].join(',');
  const WS = /[\s​‌‍﻿]/;
  const WS_G = /[\s​‌‍﻿]+/g;
  const CONTEXT = 32;
  const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

  function squeeze(s) {
    return (s || '').replace(WS_G, '');
  }

  function buildIndex(root) {
    const nodes = [];
    let str = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const skip = n.parentElement?.closest(SKIP);
        return skip && root.contains(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode())) {
      const sq = squeeze(n.nodeValue);
      if (!sq) continue;
      nodes.push({ node: n, start: str.length, len: sq.length });
      str += sq;
    }
    return { root, nodes, str };
  }

  // Offset in `text` of the k-th non-space char (start) or just after it (end).
  function rawOffset(text, k, isEnd) {
    if (isEnd && k === 0) return 0;
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (WS.test(text[i])) continue;
      if (!isEnd && count === k) return i;
      count++;
      if (isEnd && count === k) return i + 1;
    }
    return text.length;
  }

  function positionOf(idx, container, offset) {
    const point = (idx.root.ownerDocument || document).createRange();
    try {
      point.setStart(container, offset);
    } catch {
      return null;
    }
    point.collapse(true);
    for (const e of idx.nodes) {
      if (e.node === container) return e.start + squeeze(e.node.nodeValue.slice(0, offset)).length;
      if (point.comparePoint(e.node, 0) > 0) return e.start;
    }
    return idx.str.length;
  }

  function locate(idx, pos, isEnd) {
    for (const e of idx.nodes) {
      if (!isEnd && pos >= e.start && pos < e.start + e.len) {
        return { node: e.node, offset: rawOffset(e.node.nodeValue, pos - e.start, false) };
      }
      if (isEnd && pos > e.start && pos <= e.start + e.len) {
        return { node: e.node, offset: rawOffset(e.node.nodeValue, pos - e.start, true) };
      }
    }
    return null;
  }

  function toRange(idx, s, e) {
    const a = locate(idx, s, false);
    const b = locate(idx, e, true);
    if (!a || !b) return null;
    const range = (idx.root.ownerDocument || document).createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  }

  function blockOf(node) {
    return node.parentElement?.closest('p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th,tr,dt,dd,div');
  }

  // Readable text between two squeezed positions, with line breaks between blocks.
  function displayText(idx, s, e) {
    let out = '';
    let lastBlock = null;
    for (const n of idx.nodes) {
      const ns = n.start;
      const ne = n.start + n.len;
      if (ne <= s || ns >= e) continue;
      const text = n.node.nodeValue;
      const a = s > ns ? rawOffset(text, s - ns, false) : 0;
      const b = e < ne ? rawOffset(text, e - ns, true) : text.length;
      const block = blockOf(n.node);
      if (out && block !== lastBlock && !/\s$/.test(out)) out += '\n';
      lastBlock = block;
      const piece = text.slice(a, b);
      out += n.node.parentElement?.closest('pre') ? piece : piece.replace(/\s+/g, ' ');
    }
    return out.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
  }

  function commonSuffix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
    return i;
  }

  function commonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  function findBest(str, q) {
    if (!q?.exact) return -1;
    const prefix = q.prefix || '';
    const suffix = q.suffix || '';
    let best = -1;
    let bestScore = -1;
    let from = 0;
    for (let guard = 0; guard < 1000; guard++) {
      const i = str.indexOf(q.exact, from);
      if (i < 0) break;
      const end = i + q.exact.length;
      const score =
        commonSuffix(str.slice(Math.max(0, i - prefix.length), i), prefix) +
        commonPrefix(str.slice(end, end + suffix.length), suffix);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
      from = i + 1;
    }
    return best;
  }

  // Quote for a range inside root: { exact, prefix, suffix, text }.
  function quote(root, range) {
    const idx = buildIndex(root);
    const s = positionOf(idx, range.startContainer, range.startOffset);
    const e = positionOf(idx, range.endContainer, range.endOffset);
    if (s == null || e == null || e <= s) return null;
    return {
      exact: idx.str.slice(s, e),
      prefix: idx.str.slice(Math.max(0, s - CONTEXT), s),
      suffix: idx.str.slice(e, e + CONTEXT),
      text: displayText(idx, s, e),
    };
  }

  // Ranges for many quotes in the same root, sharing one index. null = not found.
  function anchorAll(root, quotes) {
    const idx = buildIndex(root);
    return quotes.map((q) => {
      const pos = findBest(idx.str, q);
      return pos < 0 ? null : toRange(idx, pos, pos + q.exact.length);
    });
  }

  function position(root, q) {
    return findBest(buildIndex(root).str, q);
  }

  // Wraps the quote's text in elements from makeEl(). Math is wrapped whole.
  // Returns the created elements (empty if the quote was not found).
  function wrapQuote(root, q, makeEl) {
    const idx = buildIndex(root);
    const s = findBest(idx.str, q);
    if (s < 0) return [];
    const e = s + q.exact.length;
    const els = [];
    const wrappedMath = new Set();
    for (const n of idx.nodes) {
      const ns = n.start;
      const ne = n.start + n.len;
      if (ne <= s || ns >= e) continue;
      const math = n.node.parentElement?.closest('math');
      if (math || n.node.parentElement?.namespaceURI === MATHML_NS) {
        if (math && !wrappedMath.has(math)) {
          wrappedMath.add(math);
          const mark = makeEl();
          math.parentNode.insertBefore(mark, math);
          mark.appendChild(math);
          els.push(mark);
        }
        continue;
      }
      const text = n.node.nodeValue;
      const a = s > ns ? rawOffset(text, s - ns, false) : 0;
      const b = e < ne ? rawOffset(text, e - ns, true) : text.length;
      let target = n.node;
      if (b < text.length) target.splitText(b);
      if (a > 0) target = target.splitText(a);
      const mark = makeEl();
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      els.push(mark);
    }
    return els;
  }

  globalThis.NMAnchor = { squeeze, quote, anchorAll, position, wrapQuote };
})();
