(function (g) {
  'use strict';

  // ---------- утилиты ----------
  function local(el) { return (el.localName || el.nodeName || '').toLowerCase(); }
  function els(root, name) {
    const out = [];
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (local(all[i]) === name) out.push(all[i]);
    return out;
  }
  function attr(el, name) {
    if (el.getAttribute) {
      const v = el.getAttribute(name) || el.getAttribute('w:' + name) || el.getAttribute('xlink:' + name);
      if (v != null) return v;
    }
    return null;
  }
  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function wc(text) { return text.split(/\s+/).filter(Boolean).length; }

  function decodeBytes(bytes) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
    const m = head.match(/encoding=["']([\w-]+)["']/i);
    if (m) { try { return new TextDecoder(m[1]).decode(bytes); } catch (e) {} }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('windows-1251').decode(bytes); }
  }

  const BLOCK = { p:1, div:1, h1:1, h2:1, h3:1, h4:1, h5:1, h6:1, li:1, br:1, tr:1,
    section:1, article:1, blockquote:1, pre:1, table:1, ul:1, ol:1, hr:1, figcaption:1, td:1, th:1, header:1 };
  function htmlToText(root) {
    const out = [];
    (function walk(node) {
      const kids = node.childNodes || [];
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        if (child.nodeType === 3) out.push(child.nodeValue);
        else if (child.nodeType === 1) {
          const tag = local(child);
          if (tag === 'script' || tag === 'style' || tag === 'head' || tag === 'nav' || tag === 'rt') continue;
          if (BLOCK[tag]) out.push('\n');
          walk(child);
          if (BLOCK[tag]) out.push('\n');
        }
      }
    })(root);
    return out.join('').replace(/[ \t\r]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
  }

  function joinPath(base, href) {
    try {
      const u = new URL(href, 'http://x/' + base);
      return decodeURIComponent(u.pathname.slice(1));
    } catch (e) { return base + href; }
  }
  function zipFile(zip, path) {
    return zip.file(path) || zip.file(encodeURI(path)) || zip.file(decodeURIComponent(path));
  }

  // ---------- EPUB ----------
  async function parseEpub(zip, fallbackName) {
    const containerEntry = zipFile(zip, 'META-INF/container.xml');
    if (!containerEntry) throw new Error('Не найден META-INF/container.xml — это не EPUB?');
    const cdoc = new DOMParser().parseFromString(await containerEntry.async('string'), 'application/xml');
    const rootfile = els(cdoc, 'rootfile')[0];
    const opfPath = attr(rootfile, 'full-path');
    const opfEntry = zipFile(zip, opfPath);
    if (!opfEntry) throw new Error('Не найден OPF: ' + opfPath);
    const odoc = new DOMParser().parseFromString(await opfEntry.async('string'), 'application/xml');
    const baseDir = opfPath.indexOf('/') >= 0 ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const title = txt(els(odoc, 'title')[0]) || fallbackName;
    const author = els(odoc, 'creator').map(txt).filter(Boolean).join(', ');

    const manifest = {};
    els(odoc, 'item').forEach(function (it) {
      manifest[attr(it, 'id')] = { href: attr(it, 'href') || '', type: attr(it, 'media-type') || '', props: attr(it, 'properties') || '' };
    });
    const spine = els(odoc, 'itemref').map(function (r) { return attr(r, 'idref'); });

    // оглавление: NCX или nav-документ
    const tocMap = {};
    const ncxId = Object.keys(manifest).find(function (id) { return manifest[id].type === 'application/x-dtbncx+xml'; });
    if (ncxId) {
      const entry = zipFile(zip, joinPath(baseDir, manifest[ncxId].href));
      if (entry) {
        const ndoc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
        els(ndoc, 'navpoint').forEach(function (np) {
          const label = txt(els(np, 'text')[0]);
          const content = els(np, 'content')[0];
          const src = content && attr(content, 'src');
          if (label && src) tocMap[joinPath(baseDir, src).split('#')[0]] = label;
        });
      }
    }
    const navId = Object.keys(manifest).find(function (id) { return /\bnav\b/.test(manifest[id].props); });
    if (navId && !Object.keys(tocMap).length) {
      const entry = zipFile(zip, joinPath(baseDir, manifest[navId].href));
      if (entry) {
        const ndoc = new DOMParser().parseFromString(decodeBytes(await entry.async('uint8array')), 'text/html');
        const links = ndoc.getElementsByTagName('a');
        for (let i = 0; i < links.length; i++) {
          const href = links[i].getAttribute('href');
          if (href) tocMap[joinPath(baseDir, href).split('#')[0]] = txt(links[i]);
        }
      }
    }

    const chapters = [];
    for (let s = 0; s < spine.length; s++) {
      const item = manifest[spine[s]];
      if (!item || !/html/.test(item.type)) continue;
      const path = joinPath(baseDir, item.href);
      const entry = zipFile(zip, path);
      if (!entry) continue;
      const doc = new DOMParser().parseFromString(decodeBytes(await entry.async('uint8array')), 'text/html');
      const body = doc.body || doc.documentElement;
      const text = htmlToText(body);
      if (wc(text) < 3) continue;
      let chTitle = tocMap[path.split('#')[0]];
      if (!chTitle) {
        const h = body.getElementsByTagName('h1')[0] || body.getElementsByTagName('h2')[0] || body.getElementsByTagName('h3')[0];
        chTitle = txt(h);
      }
      chapters.push({ title: chTitle || 'Глава ' + (chapters.length + 1), text: text });
    }
    if (!chapters.length) throw new Error('В EPUB не найден текст (возможно, DRM-защита).');
    return { title: title, author: author, chapters: chapters, format: 'EPUB' };
  }

  // ---------- FB2 ----------
  function parseFb2(xmlText, fallbackName) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (!els(doc, 'fictionbook').length) throw new Error('Не похоже на FB2.');
    const title = txt(els(doc, 'book-title')[0]) || fallbackName;
    const author = els(doc, 'author').map(function (a) {
      return ['first-name', 'middle-name', 'last-name'].map(function (n) { return txt(els(a, n)[0]); }).filter(Boolean).join(' ');
    }).filter(Boolean).join(', ');

    const chapters = [];
    let cur = null;
    function ensure(t) { cur = { title: t || 'Глава ' + (chapters.length + 1), text: '' }; chapters.push(cur); }
    function lines(el) { return els(el, 'p').map(txt).filter(Boolean); }
    function collect(node) {
      const kids = node.children || [];
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i], tag = local(c);
        if (tag === 'title' || tag === 'epigraph' || tag === 'annotation') {
          const ls = lines(c); if (ls.length) cur.text += ls.join('\n') + '\n';
        } else if (tag === 'p' || tag === 'subtitle' || tag === 'text-author' || tag === 'v') {
          const t = txt(c); if (t) cur.text += t + '\n';
        } else if (tag === 'empty-line') { cur.text += '\n'; }
        else if (tag === 'cite' || tag === 'poem' || tag === 'stanza' || tag === 'section' || tag === 'body') {
          collect(c);
        }
      }
    }
    const bodies = els(doc, 'body').filter(function (b) {
      const n = attr(b, 'name'); return n !== 'notes' && n !== 'comments';
    });
    bodies.forEach(function (body) {
      const sections = [];
      const kids = body.children || [];
      for (let i = 0; i < kids.length; i++) if (local(kids[i]) === 'section') sections.push(kids[i]);
      if (!sections.length) { ensure(null); collect(body); return; }
      sections.forEach(function (sec) {
        let titleEl = null;
        const sk = sec.children || [];
        for (let i = 0; i < sk.length; i++) if (local(sk[i]) === 'title') { titleEl = sk[i]; break; }
        ensure(titleEl ? lines(titleEl).join(' — ') : null);
        collect(sec);
      });
    });
    const clean = chapters.filter(function (c) { return wc(c.text) > 0; });
    if (!clean.length) throw new Error('В FB2 не найден текст.');
    return { title: title, author: author, chapters: clean, format: 'FB2' };
  }

  // ---------- DOCX ----------
  async function parseDocx(zip, fallbackName) {
    const entry = zipFile(zip, 'word/document.xml');
    if (!entry) throw new Error('Не найден word/document.xml — это не DOCX?');
    const doc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
    const chapters = [];
    let cur = { title: fallbackName, text: '' };
    let bookTitle = null;
    els(doc, 'p').forEach(function (p) {
      let style = '';
      const ps = els(p, 'pstyle')[0];
      if (ps) style = attr(ps, 'val') || '';
      let text = '';
      (function walk(n) {
        const kids = n.children || [];
        for (let i = 0; i < kids.length; i++) {
          const c = kids[i], t = local(c);
          if (t === 't') text += c.textContent || '';
          else if (t === 'tab') text += '\t';
          else if (t === 'br' || t === 'cr') text += '\n';
          else walk(c);
        }
      })(p);
      text = text.replace(/[ \t]+/g, ' ').trim();
      if (!text) return;
      const isHeading = /^(heading|title|заголовок)/i.test(style);
      if (isHeading) {
        if (!bookTitle && /^title/i.test(style)) bookTitle = text;
        if (cur.text.trim()) chapters.push(cur);
        cur = { title: text, text: text + '\n' };
      } else cur.text += text + '\n';
    });
    if (cur.text.trim()) chapters.push(cur);
    if (!chapters.length) throw new Error('DOCX пуст.');
    return { title: bookTitle || chapters[0].title || fallbackName, author: '', chapters: chapters, format: 'DOCX' };
  }

  // ---------- RTF ----------
  function rtfToText(src) {
    let i = 0;
    const state = { cp: 1251, uc: 1 };
    const SKIP = { fonttbl:1, colortbl:1, stylesheet:1, listtable:1, listoverridetable:1,
      info:1, pict:1, object:1, themedata:1, colorschememapping:1, latentstyles:1, datastore:1,
      generator:1, xmlnstbl:1, fldrslt:1, nonshppict:1, shppict:1, header:1, footer:1,
      headerl:1, headerr:1, footerl:1, footerr:1, mmathPr:1, defchp:1, defpap:1, sectd:1, docfmt:1 };

    function readControl() {
      // i указывает на символ после backslash
      let kw = '';
      if (/[a-zA-Z]/.test(src[i] || '')) {
        while (i < src.length && /[a-zA-Z]/.test(src[i])) kw += src[i++];
        let num = '';
        if (src[i] === '-') { num += '-'; i++; }
        while (i < src.length && /[0-9]/.test(src[i])) num += src[i++];
        if (src[i] === ' ') i++;
        return { kw: kw, num: num === '' ? null : parseInt(num, 10) };
      }
      const ch = src[i++];
      return { kw: ch, num: null, sym: true };
    }

    function parseGroup() {
      let out = '';
      let skip = false;
      let hex = [];
      function flushHex() {
        if (hex.length) {
          const enc = state.cp === 65001 ? 'utf-8' : 'windows-' + state.cp;
          try { out += new TextDecoder(enc).decode(new Uint8Array(hex)); } catch (e) {}
          hex = [];
        }
      }
      // {\*\destination} — пропускаем целиком
      if (src[i] === '\\' && src[i + 1] === '*') {
        i += 2;
        while (i < src.length && /[a-zA-Z]/.test(src[i])) i++;
        if (src[i] === ' ') i++;
        skip = true;
      }
      let first = true;
      while (i < src.length) {
        const c = src[i];
        if (c === '}') { i++; flushHex(); return skip ? '' : out; }
        if (c === '{') { i++; out += parseGroup(); continue; }
        if (c === '\\') {
          i++;
          if (src[i] === "'") {
            i++;
            const h = parseInt(src.substr(i, 2), 16); i += 2;
            if (!isNaN(h)) hex.push(h);
            continue;
          }
          flushHex();
          const ctl = readControl();
          if (ctl.sym) {
            if (ctl.kw === '\\' || ctl.kw === '{' || ctl.kw === '}') out += ctl.kw;
            else if (ctl.kw === '~') out += ' ';
            else if (ctl.kw === '_') out += '‑';
            else if (ctl.kw === '\n' || ctl.kw === '\r') out += '\n';
            continue;
          }
          const kw = ctl.kw, num = ctl.num;
          if (first && SKIP[kw]) skip = true;
          first = false;
          if (skip) continue;
          if (kw === 'ansicpg' && num) state.cp = num;
          else if (kw === 'uc' && num != null) state.uc = num;
          else if (kw === 'par' || kw === 'line') out += '\n';
          else if (kw === 'tab') out += '\t';
          else if (kw === 'emdash') out += '—';
          else if (kw === 'endash') out += '–';
          else if (kw === 'bullet') out += '•';
          else if (kw === 'lquote') out += '‘';
          else if (kw === 'rquote') out += '’';
          else if (kw === 'ldblquote') out += '“';
          else if (kw === 'rdblquote') out += '”';
          else if (kw === 'u' && num != null) {
            out += String.fromCodePoint(num < 0 ? num + 65536 : num);
            // пропускаем uc запасных символов
            let n = state.uc;
            while (n > 0 && i < src.length) {
              if (src[i] === '\\' && src[i + 1] === "'") { i += 4; n--; }
              else if (src[i] === '\\') { i++; readControl(); n--; }
              else if (src[i] === '{') { const save = i; i++; parseGroup(); n--; }
              else { i++; n--; }
            }
          }
          continue;
        }
        if (c === '\r' || c === '\n') { i++; continue; }
        flushHex();
        out += c; i++;
      }
      flushHex();
      return skip ? '' : out;
    }

    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) throw new Error('Не похоже на RTF.');
    i++;
    const text = parseGroup().replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (wc(text) < 2) throw new Error('RTF пуст или не распознан.');
    return text;
  }

  // ---------- TXT / MD / HTML ----------
  function splitTxtChapters(text, fallbackName, md) {
    const lines = text.split(/\r?\n/);
    const chapters = [];
    let cur = { title: null, text: [] };
    const headRe = md ? /^#{1,3}\s+\S/ :
      /^\s{0,6}((глава|часть|раздел|chapter|part|book|пролог|эпилог|prologue|epilogue)(?![a-zа-яё]).{0,70}|#{1,3}\s+.{1,70})$/i;
    let firstHead = null;
    lines.forEach(function (ln) {
      if (headRe.test(ln) && ln.trim().length < 80) {
        if (cur.text.join('').trim()) chapters.push({ title: cur.title, text: cur.text.join('\n') });
        const t = ln.replace(/^#{1,3}\s+/, '').trim();
        if (!firstHead) firstHead = t;
        cur = { title: t, text: [] };
      } else cur.text.push(md ? ln.replace(/^#{1,6}\s+/, '').replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1').replace(/^>\s?/, '') : ln);
    });
    if (cur.text.join('').trim()) chapters.push({ title: cur.title, text: cur.text.join('\n') });
    if (!chapters.length) chapters.push({ title: 'Текст', text: text });
    chapters.forEach(function (c, i) { if (!c.title) c.title = chapters.length > 1 ? 'Глава ' + (i + 1) : 'Текст'; });
    return { title: firstHead || fallbackName, chapters: chapters };
  }

  // ---------- PDF ----------
  async function parsePdf(bytes, name) {
    let lib = g.pdfjsLib;
    if (!lib) lib = await import('vendor/pdf.min.mjs');
    const pdfjs = lib.getDocument ? lib : lib.default;
    if (!g.pdfjsLib && typeof document !== 'undefined') {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href;
    }
    const stdUrl = (typeof document !== 'undefined') ? new URL('vendor/standard_fonts/', document.baseURI).href : undefined;
    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, standardFontDataUrl: stdUrl }).promise;
    let title = name;
    try { const md = await doc.getMetadata(); if (md && md.info && md.info.Title) title = md.info.Title; } catch (e) {}
    const chapters = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let text = '';
      for (let k = 0; k < tc.items.length; k++) {
        const it = tc.items[k];
        if (typeof it.str === 'string') text += it.str + (it.hasEOL ? '\n' : ' ');
      }
      text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
      if (text) chapters.push({ title: 'Стр. ' + p, text: text });
    }
    if (!chapters.length) throw new Error('В PDF нет текстового слоя (сканы не поддерживаются).');
    return { title: title, author: '', chapters: chapters, format: 'PDF' };
  }

  // ---------- диспетчер ----------
  async function parseBytes(bytes, name) {
    const baseName = name.replace(/\.[^.]+$/, '') || 'Книга';
    const ext = (name.match(/\.([^.]+)$/) || [])[1] || '';
    const e = ext.toLowerCase();
    if (e === 'mobi' || e === 'azw' || e === 'azw3' || e === 'kfx')
      throw new Error('Формат ' + ext.toUpperCase() + ' (Kindle) не поддерживается. Сконвертируй в EPUB, например в Calibre.');
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
      const zip = await g.JSZip.loadAsync(bytes);
      if (zipFile(zip, 'META-INF/container.xml')) return parseEpub(zip, baseName);
      if (zipFile(zip, 'word/document.xml')) return parseDocx(zip, baseName);
      const fb2names = Object.keys(zip.files).filter(function (n) { return /\.fb2$/i.test(n); });
      if (fb2names.length) {
        const b = await zip.file(fb2names[0]).async('uint8array');
        return parseFb2(decodeBytes(b), baseName);
      }
      throw new Error('ZIP поддерживается только как EPUB, DOCX или FB2.ZIP.');
    }
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 400));
    if (head.indexOf('%PDF') === 0) return parsePdf(bytes, baseName);
    if (e === 'fb2' || (head.indexOf('<?xml') >= 0 && /<FictionBook/i.test(head)))
      return parseFb2(decodeBytes(bytes), baseName);
    if (e === 'rtf' || head.indexOf('{\\rtf') === 0)
      return { title: baseName, author: '', chapters: [{ title: 'Текст', text: rtfToText(decodeBytes(bytes)) }], format: 'RTF' };
    if (e === 'html' || e === 'htm' || /<html[\s>]/i.test(head)) {
      const doc = new DOMParser().parseFromString(decodeBytes(bytes), 'text/html');
      const t = txt(doc.getElementsByTagName('title')[0]) || txt(doc.getElementsByTagName('h1')[0]) || baseName;
      const text = htmlToText(doc.body || doc.documentElement);
      if (wc(text) < 2) throw new Error('HTML пуст.');
      return { title: t, author: '', chapters: [{ title: 'Текст', text: text }], format: 'HTML' };
    }
    const text = decodeBytes(bytes);
    if (wc(text) < 2) throw new Error('Файл пуст или не является текстом.');
    const r = splitTxtChapters(text, baseName, e === 'md' || e === 'markdown');
    return { title: r.title, author: '', chapters: r.chapters, format: (e === 'md' || e === 'markdown') ? 'MD' : 'TXT' };
  }

  async function parseFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    return parseBytes(buf, file.name || 'Книга');
  }

  g.BookParsers = { parseFile: parseFile, parseBytes: parseBytes, decodeBytes: decodeBytes, rtfToText: rtfToText };
})(typeof self !== 'undefined' ? self : globalThis);
