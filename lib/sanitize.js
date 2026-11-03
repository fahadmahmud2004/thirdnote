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
    'kbd', 'small', 'dl', 'dt', 'dd',
  ]);
  const ATTRS = {
    a: ['href', 'title'], img: ['src', 'alt'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'], ol: ['start'], code: ['data-lang'],
  };
  // Labels only screen readers see, e.g. "You said" on Gemini.
  const HIDDEN_UI = '.sr-only, .cdk-visually-hidden, .visually-hidden, .screen-reader-only';
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
      const lang = (code.className.match(/language-([\w+#.-]+)/) || [])[1];
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

  function fromElement(el) {
    const wrap = document.createElement('div');
    wrap.appendChild(el.cloneNode(true));
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

  // Re-sanitizes stored HTML before it is rendered in an extension page.
  function cleanHtml(html) {
    const doc = new DOMParser().parseFromString(`<!doctype html><body><div>${html || ''}</div>`, 'text/html');
    const wrap = doc.body.firstElementChild;
    clean(wrap);
    return wrap.innerHTML;
  }

  globalThis.NMSanitize = { fromElement, fromRange, cleanHtml, toText };
})();
