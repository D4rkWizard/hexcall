'use strict';
// Hexhub UI translation (same approach as Hexcall): the interface is written in German. For other languages
// every visible text (static HTML, toasts, dialogs, titles, placeholders) is translated on the fly by a DOM observer.
// Modules add their own dictionaries:  I18N.add('en', { 'Deutsch': 'English' }, [[/^(\d+) Replays$/, '$1 replays']])
// Languages without an own entry fall back to English.

const I18N = (() => {
  const D = {};       // lang -> { dict, patterns, html }
  const QUOTES = { de: ['„', '“'], en: ['"', '"'], ru: ['«', '»'], pl: ['„', '”'], fr: ['« ', ' »'], es: ['«', '»'] };
  let lang = 'de';
  let observer = null;
  const original = new WeakMap();

  function add(l, dict = {}, patterns = [], html = {}) {
    const t = D[l] = D[l] || { dict: {}, patterns: [], html: {} };
    Object.assign(t.dict, dict); t.patterns.push(...patterns); Object.assign(t.html, html);
  }

  const word = (k) => {
    const own = D[lang], en = D.en;
    if (own && own.dict[k] !== undefined) return own.dict[k];
    if (en && en.dict[k] !== undefined) return en.dict[k];
    return undefined;
  };

  function tr(s) {
    if (lang === 'de' || typeof s !== 'string') return s;
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim().replace(/\s+/g, ' ');
    if (!core) return s;
    const w = word(core);
    if (w !== undefined) return lead + w + trail;
    const q = /^„(.+)“$/.exec(core);
    if (q && word(q[1]) !== undefined) return lead + quote(word(q[1])) + trail;
    const pats = [...((D[lang] && D[lang].patterns) || []), ...(lang !== 'en' && D.en ? D.en.patterns : [])];
    for (const [re, rep] of pats) if (re.test(core)) return lead + core.replace(re, typeof rep === 'function' ? rep : (m, ...g) => rep.replace(/\$(\d)/g, (x, i) => { const v = g[i - 1]; return typeof v === 'string' ? (word(v) !== undefined ? word(v) : v) : ''; })) + trail;
    return s;
  }

  function translateNode(node) {
    if (lang === 'de') return;
    if (node.nodeType === 3) { const t = tr(node.data); if (t !== node.data) node.data = t; return; }
    if (node.nodeType !== 1) return;
    if (node.closest && node.closest('[data-no-i18n]')) return;
    const k = node.dataset && node.dataset.i18nHtml;
    const html = k && ((D[lang] && D[lang].html[k]) || (D.en && D.en.html[k]));
    if (html && !original.has(node)) { original.set(node, node.innerHTML); node.innerHTML = html; }
    for (const attr of ['title', 'placeholder']) {
      if (node.hasAttribute && node.hasAttribute(attr)) { const v = node.getAttribute(attr), t = tr(v); if (t !== v) node.setAttribute(attr, t); }
    }
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'IFRAME') return;
    for (const c of node.childNodes) translateNode(c);
  }

  function start(l) {
    lang = ['de', 'en', 'ru', 'pl', 'fr', 'es'].includes(l) ? l : 'en';
    document.documentElement.lang = lang;
    if (observer) observer.disconnect();
    if (lang === 'de') return;
    translateNode(document.body);
    document.title = tr(document.title);
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData' || m.type === 'attributes') translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
  }

  function quote(t) { const [a, b] = QUOTES[lang] || QUOTES.en; return a + t + b; }

  return { add, start, tr, quote, get lang() { return lang; } };
})();
