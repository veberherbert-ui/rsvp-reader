(function () {
  'use strict';
  const R = window.RsvpEngine, P = window.BookParsers, St = window.Store;
  const $ = function (id) { return document.getElementById(id); };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const APP_VERSION = 'v7';
  const FONTS = { serif: 'Georgia, "Times New Roman", serif', sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' };

  const S = {
    meta: null, chapters: null, words: [], starts: [],
    idx: 0, playing: false, timer: null, nextAt: 0, wpm: 300,
    recent: [], wakeLock: null, scrubbing: false,
    settings: { font: 40, theme: 'dark', sentence: 2.2, paragraph: 2.8, comma: 1.6, dialogue: 3.5, recent: true, wordfont: 'serif', smooth: 'soft' }
  };

  // ---------- настройки ----------
  function loadSettings() {
    S.wpm = St.getSetting('wpm', 300);
    Object.keys(S.settings).forEach(function (k) { S.settings[k] = St.getSetting('set:' + k, S.settings[k]); });
    applySettings();
  }
  function applyVisual() {
    document.body.dataset.theme = S.settings.theme;
    document.documentElement.style.setProperty('--word-size', S.settings.font + 'px');
    document.documentElement.style.setProperty('--word-font', FONTS[S.settings.wordfont]);
    $('recent').classList.toggle('hidden', !S.settings.recent);
  }
  function applySettings() {
    applyVisual();
    $('wpm').value = S.wpm; $('wpm-label').textContent = S.wpm + ' сл/мин';
    $('set-font').value = S.settings.font; $('set-font-label').textContent = S.settings.font + 'px';
    $('set-theme').value = S.settings.theme;
    $('set-sentence').value = S.settings.sentence; $('set-sentence-label').textContent = '×' + S.settings.sentence;
    $('set-paragraph').value = S.settings.paragraph; $('set-paragraph-label').textContent = '×' + S.settings.paragraph;
    $('set-comma').value = S.settings.comma; $('set-comma-label').textContent = '×' + S.settings.comma;
    $('set-recent').checked = S.settings.recent;
    $('set-wordfont').value = S.settings.wordfont;
    $('set-smooth').value = S.settings.smooth;
    $('set-dialogue').value = S.settings.dialogue; $('set-dialogue-label').textContent = '×' + S.settings.dialogue;
  }

  // ---------- тост ----------
  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isErr);
    t.classList.remove('hidden', 'out', 'show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { t.classList.add('hidden'); t.classList.remove('out', 'show'); }, 180);
    }, isErr ? 5000 : 2500);
  }

  // ---------- библиотека ----------
  async function renderLibrary() {
    const books = await St.listBooks();
    books.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    const list = $('book-list');
    list.innerHTML = '';
    $('lib-empty').classList.toggle('hidden', books.length > 0);
    for (const meta of books) {
      const prog = await St.getProgress(meta.id);
      const pct = prog && meta.wordCount ? Math.min(100, Math.round(prog.i / meta.wordCount * 100)) : 0;
      const card = document.createElement('div');
      card.className = 'book-card';
      const info = document.createElement('div');
      info.className = 'book-info';
      const h = document.createElement('div'); h.className = 'book-title'; h.textContent = meta.title;
      const sub = document.createElement('div'); sub.className = 'book-sub';
      sub.textContent = (meta.author ? meta.author + ' · ' : '') + meta.format + ' · ' + Math.round(meta.wordCount / 1000) + ' тыс. слов';
      const bar = document.createElement('div'); bar.className = 'book-bar';
      const fill = document.createElement('div'); fill.style.width = pct + '%';
      bar.appendChild(fill);
      const pctEl = document.createElement('div'); pctEl.className = 'book-pct'; pctEl.textContent = pct + '%';
      info.append(h, sub, bar, pctEl);
      const del = document.createElement('button');
      del.className = 'book-del'; del.setAttribute('aria-label', 'Удалить книгу');
      del.innerHTML = '<svg class="icon"><use href="#i-trash"/></svg>';
      del.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        if (confirm('Удалить «' + meta.title + '»?')) { await St.deleteBook(meta.id); renderLibrary(); }
      });
      card.append(info, del);
      card.addEventListener('click', function () { openBook(meta); });
      card.classList.add('enter');
      card.style.animationDelay = Math.min(list.children.length * 100, 500) + 'ms';
      list.appendChild(card);
    }
  }

  async function importFiles(files) {
    for (const file of files) {
      toast('Импортирую: ' + file.name + '…');
      try {
        const book = await P.parseFile(file);
        const words = R.tokenize(book.chapters);
        if (!words.length) throw new Error('Не удалось извлечь текст.');
        const id = (crypto.randomUUID ? crypto.randomUUID() : 'b' + Date.now() + Math.random().toString(36).slice(2));
        const meta = { id: id, title: book.title, author: book.author, format: book.format,
          wordCount: words.length, chapterCount: book.chapters.length, addedAt: Date.now() };
        await St.addBook(meta, book.chapters);
        toast('Добавлено: ' + book.title + ' (' + words.length + ' слов)');
      } catch (e) {
        console.error(e);
        toast(file.name + ': ' + (e.message || 'не удалось прочитать'), true);
      }
    }
    renderLibrary();
  }


  const DEMO_TEXT = 'Представь, что текст сам приходит к тебе. Глазам больше не нужно бегать по строкам: каждое слово появляется в одной и той же точке экрана. Красная буква — точка фокуса, за неё и держись взглядом.\n\nСкорость регулируется ползунком внизу. Начни с трёхсот слов в минуту, а когда освоишься — поднимай выше. На запятых и точках ридер сам делает паузы, чтобы мысль успевала сложиться.\n\nУпустил нить? Кнопки «предл.» и «абзац» откатят назад, ползунок перемотает в любое место книги, а лента сверху хранит последние слова: тапни любое — и продолжишь с него. Приятного чтения!';
  function openDemo() {
    const chapters = [{ title: 'Как это работает', text: DEMO_TEXT }];
    const meta = { id: 'demo', title: 'Демо: как это работает', author: '', format: 'DEMO',
      wordCount: R.tokenize(chapters).length, chapterCount: 1, addedAt: Date.now() };
    openBook(meta, chapters);
  }

  // ---------- ридер ----------
  async function openBook(meta, presetChapters) {
    const chapters = presetChapters || await St.getChapters(meta.id);
    if (!chapters) { toast('Книга не найдена в хранилище', true); return; }
    S.meta = meta; S.chapters = chapters;
    S.words = R.tokenize(chapters);
    S.starts = R.chapterStarts(S.words);
    const prog = await St.getProgress(meta.id);
    $('reader-title').textContent = meta.title;
    $('progress').max = Math.max(0, S.words.length - 1);
    buildChapterList();
    $('screen-library').classList.add('hidden');
    $('screen-reader').classList.remove('hidden');
    $('overlay').classList.add('hidden');
    pause();
    seek(prog ? Math.min(prog.i, S.words.length - 1) : 0);
  }

  function buildChapterList() {
    const list = $('chapter-list');
    list.innerHTML = '';
    S.chapters.forEach(function (c, ci) {
      const b = document.createElement('button');
      b.className = 'chapter-item';
      b.textContent = c.title;
      b.dataset.ch = ci;
      b.addEventListener('click', function () {
        seek(S.starts[ci] || 0);
        closeDrawers();
      });
      list.appendChild(b);
    });
  }

  function renderWord(i) {
    const w = S.words[i];
    if (!w) return;
    const t = w.t;
    const o = R.pivotIndex(t);
    const wordEl = $('word');
    wordEl.style.fontSize = S.settings.font + 'px';
    $('w-left').textContent = t.slice(0, o);
    $('w-pivot').textContent = t[o] || '';
    $('w-right').textContent = t.slice(o + 1);
    // авто-кегль по фактической ширине: итеративно уменьшаем, пока слово не влезет;
    // фокус-буква остаётся ровно по центру (сетка 1fr auto 1fr)
    let fitSize = S.settings.font;
    for (let k = 0; k < 4; k++) {
      void wordEl.offsetWidth;
      const needW = $('w-left').offsetWidth + $('w-pivot').offsetWidth + $('w-right').offsetWidth;
      const availW = wordEl.clientWidth;
      if (needW <= availW || availW <= 0 || fitSize <= 12) break;
      fitSize = Math.max(12, Math.floor(fitSize * availW / needW * 0.98));
      wordEl.style.fontSize = fitSize + 'px';
    }
    void wordEl.offsetWidth;
    wordEl.style.setProperty('--ph', ($('w-pivot').offsetWidth / 2) + 'px');
    if (S.playing && S.settings.smooth === 'soft' && !reduceMotion.matches && $('word').animate) {
      const d = R.delayMs(w, S.words[i + 1], S.wpm, S.settings);
      const fade = Math.max(40, Math.min(110, Math.round(d * 0.35)));
      try {
        $('word').getAnimations().forEach(function (a) { a.cancel(); });
        $('word').animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: fade, easing: 'ease-out' });
      } catch (e) {}
    }
    const chEl = $('reader-chapter');
    const chTitle = (S.chapters[w.ch] || {}).title || '';
    if (chEl.textContent !== chTitle) {
      chEl.textContent = chTitle;
      const items = $('chapter-list').children;
      for (let k = 0; k < items.length; k++) items[k].classList.toggle('active', +items[k].dataset.ch === w.ch);
    }
  }

  function pushRecent(i) {
    S.recent.push(i);
    if (S.recent.length > 12) S.recent.shift();
    renderRecent();
  }
  function rebuildRecent() {
    S.recent = [];
    for (let k = Math.max(0, S.idx - 12); k < S.idx; k++) S.recent.push(k);
    renderRecent();
  }
  function renderRecent() {
    const el = $('recent');
    el.innerHTML = '';
    S.recent.forEach(function (i) {
      const s = document.createElement('span');
      s.textContent = S.words[i].t;
      s.addEventListener('click', function (ev) { ev.stopPropagation(); seek(i); });
      el.appendChild(s);
    });
  }

  function updatePos() {
    const len = S.words.length;
    const shown = Math.min(S.idx, len);
    $('progress').value = Math.min(S.idx, len - 1);
    $('pos-label').textContent = shown + ' / ' + len;
    $('pct-label').textContent = len ? Math.round(shown / len * 100) + '%' : '0%';
  }

  function seek(i) {
    S.idx = Math.max(0, Math.min(i, S.words.length));
    if (S.idx >= S.words.length) { finish(); return; }
    $('overlay').classList.add('hidden');
    renderWord(S.idx);
    rebuildRecent();
    updatePos();
    saveProgress();
    clearTimeout(S.timer);
    if (S.playing) { S.nextAt = performance.now() + 400; S.timer = setTimeout(tick, 400); }
  }

  function tick() {
    if (!S.playing) return;
    if (S.idx >= S.words.length) { finish(); return; }
    const w = S.words[S.idx];
    renderWord(S.idx);
    pushRecent(S.idx);
    const d = R.delayMs(w, S.words[S.idx + 1], S.wpm, S.settings);
    S.idx++;
    updatePos();
    if (S.idx % 20 === 0) saveProgress();
    const now = performance.now();
    S.nextAt = Math.max(S.nextAt + d, now + 16);
    S.timer = setTimeout(tick, S.nextAt - now);
  }

  async function play() {
    if (!S.words.length) return;
    if (S.idx >= S.words.length) seek(0);
    S.playing = true;
    setPlayState(true);
    clearTimeout(S.timer);
    S.nextAt = performance.now();
    tick();
    try { if (navigator.wakeLock) S.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  function pause() {
    S.playing = false;
    setPlayState(false);
    clearTimeout(S.timer);
    if (S.wakeLock) { try { S.wakeLock.release(); } catch (e) {} S.wakeLock = null; }
    saveProgress();
  }
  function toggle() { S.playing ? pause() : play(); }
  function setPlayState(on) {
    const b = $('btn-play');
    b.dataset.state = on ? 'playing' : 'paused';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Пауза' : 'Продолжить');
  }

  function finish() {
    pause();
    S.idx = S.words.length;
    updatePos();
    $('overlay').classList.remove('hidden');
  }

  let lastSave = 0;
  function saveProgress() {
    if (!S.meta || S.meta.id === 'demo') return;
    const now = Date.now();
    if (now - lastSave < 800) return;
    lastSave = now;
    St.saveProgress(S.meta.id, { i: S.idx, t: now });
  }
  function saveProgressForce() { lastSave = 0; saveProgress(); }

  function backToLibrary() {
    pause();
    saveProgressForce();
    S.meta = null; S.words = []; S.chapters = null;
    $('screen-reader').classList.add('hidden');
    $('screen-library').classList.remove('hidden');
    closeDrawers();
    renderLibrary();
  }

  function openDrawer(el) {
    el.classList.remove('hidden', 'closing');
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('open'); }); });
  }
  function closeDrawer(el) {
    if (el.classList.contains('hidden')) return;
    el.classList.remove('open', 'dragging');
    el.classList.add('closing');
    el.style.transform = ''; el.style.opacity = '';
    let done = false;
    const finish = function () {
      if (done) return; done = true;
      el.classList.add('hidden'); el.classList.remove('closing');
      el.removeEventListener('transitionend', finish);
    };
    el.addEventListener('transitionend', finish);
    setTimeout(finish, 320);
  }
  function closeDrawers() {
    closeDrawer($('drawer-chapters'));
    closeDrawer($('drawer-settings'));
  }
  // drag-to-dismiss: тянем заголовок вниз, отпускаем за половину — закрывается (Kinetics)
  function bindDrawerDrag(el) {
    const head = el.querySelector('.drawer-head');
    let dragging = false, startY = 0, dy = 0, t0 = 0, h = 1;
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      dragging = true; startY = e.clientY; dy = 0; t0 = performance.now(); h = el.offsetHeight || 1;
      el.classList.add('dragging');
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      el.style.transform = 'translateY(' + dy + 'px)';
      el.style.opacity = String(Math.max(0.4, 1 - dy / h));
    });
    const up = function () {
      if (!dragging) return;
      dragging = false;
      const v = dy / Math.max(1, performance.now() - t0);
      el.classList.remove('dragging');
      el.style.transform = ''; el.style.opacity = '';
      if (dy > h * 0.5 || v > 0.5) closeDrawer(el);
      dy = 0;
    };
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  }

  function curBase() { return S.playing ? Math.max(0, S.idx - 1) : S.idx; }

  // ---------- события ----------
  function bind() {
    $('btn-import').addEventListener('click', function () { $('file-input').click(); });
    $('btn-demo').addEventListener('click', openDemo);
    $('file-input').addEventListener('change', function (ev) {
      const files = Array.from(ev.target.files || []);
      ev.target.value = '';
      if (files.length) importFiles(files);
    });
    // drag&drop на десктопе
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) importFiles(Array.from(e.dataTransfer.files));
    });

    $('btn-back').addEventListener('click', backToLibrary);
    $('btn-play').addEventListener('click', toggle);
    $('btn-prev-sent').addEventListener('click', function () { seek(R.prevSentence(S.words, curBase())); });
    $('btn-prev-par').addEventListener('click', function () { seek(R.prevParagraph(S.words, curBase())); });

    $('progress').addEventListener('input', function (ev) { seek(+ev.target.value); });
    $('wpm').addEventListener('input', function (ev) {
      S.wpm = +ev.target.value;
      $('wpm-label').textContent = S.wpm + ' сл/мин';
      St.setSetting('wpm', S.wpm);
      if (S.playing) { clearTimeout(S.timer); S.nextAt = performance.now() + 60000 / S.wpm; S.timer = setTimeout(tick, 60000 / S.wpm); }
    });

    $('btn-chapters').addEventListener('click', function () {
      closeDrawer($('drawer-settings'));
      const d = $('drawer-chapters');
      if (d.classList.contains('open')) closeDrawer(d); else openDrawer(d);
      const act = $('chapter-list').querySelector('.active');
      if (act) setTimeout(function () { act.scrollIntoView({ block: 'center' }); }, 60);
    });
    $('btn-settings').addEventListener('click', function () {
      closeDrawer($('drawer-chapters'));
      const d = $('drawer-settings');
      if (d.classList.contains('open')) closeDrawer(d); else openDrawer(d);
    });
    bindDrawerDrag($('drawer-chapters'));
    bindDrawerDrag($('drawer-settings'));
    document.querySelectorAll('.drawer-close').forEach(function (b) { b.addEventListener('click', closeDrawers); });

    $('set-font').addEventListener('input', function (ev) {
      S.settings.font = +ev.target.value; St.setSetting('set:font', S.settings.font);
      applyVisual();
      $('set-font-label').textContent = S.settings.font + 'px';
    });
    $('set-theme').addEventListener('change', function (ev) {
      S.settings.theme = ev.target.value; St.setSetting('set:theme', S.settings.theme);
      document.body.classList.add('no-transitions');
      applySettings();
      void document.body.offsetWidth;
      requestAnimationFrame(function () { requestAnimationFrame(function () { document.body.classList.remove('no-transitions'); }); });
    });
    $('set-wordfont').addEventListener('change', function (ev) {
      S.settings.wordfont = ev.target.value; St.setSetting('set:wordfont', S.settings.wordfont); applyVisual();
    });
    [['set-sentence', 'sentence'], ['set-paragraph', 'paragraph'], ['set-comma', 'comma'], ['set-dialogue', 'dialogue']].forEach(function (pair) {
      $(pair[0]).addEventListener('input', function (ev) {
        S.settings[pair[1]] = +ev.target.value; St.setSetting('set:' + pair[1], S.settings[pair[1]]);
        $(pair[0] + '-label').textContent = '×' + S.settings[pair[1]];
      });
    });
    $('set-recent').addEventListener('change', function (ev) {
      S.settings.recent = ev.target.checked; St.setSetting('set:recent', S.settings.recent);
      $('recent').classList.toggle('hidden', !S.settings.recent);
    });
    $('set-smooth').addEventListener('change', function (ev) {
      S.settings.smooth = ev.target.value; St.setSetting('set:smooth', S.settings.smooth);
    });

    $('btn-restart').addEventListener('click', function () { seek(0); play(); });
    $('btn-to-lib').addEventListener('click', backToLibrary);
    $('btn-update').addEventListener('click', async function () {
      toast('Проверяю обновление…');
      try {
        const reg = ('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistration() : null;
        if (!reg) { location.reload(); return; }
        await reg.update();
        const newer = reg.installing || reg.waiting;
        if (newer) {
          await new Promise(function (res) {
            const w = reg.installing || reg.waiting;
            if (!w || w.state === 'activated') return res();
            w.addEventListener('statechange', function () { if (w.state === 'activated') res(); });
            setTimeout(res, 8000);
          });
          location.reload();
        } else {
          toast('Установлена последняя версия ✓');
        }
      } catch (e) { location.reload(); }
    });
    $('btn-share').addEventListener('click', async function () {
      const url = new URL('./', location.href).href;
      const data = { title: 'Вспышка — скорочтение', text: 'RSVP-ридер: книги любых форматов по одному слову, с точкой фокуса. Ставится на айфон как приложение.', url: url };
      try {
        if (navigator.share) await navigator.share(data);
        else throw { name: 'NoShare' };
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); }
        catch (e2) { toast('Ссылка: ' + url); }
      }
    });
    $('btn-hint-close').addEventListener('click', function () {
      $('install-hint').classList.add('hidden'); St.setSetting('hintDismissed', true);
    });

    document.addEventListener('keydown', function (e) {
      if ($('screen-reader').classList.contains('hidden')) return;
      if (e.key === 'Escape') { closeDrawers(); return; }
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') seek(R.prevSentence(S.words, curBase()));
      else if (e.key === 'ArrowRight') {
        let j = curBase() + 1;
        while (j < S.words.length && !S.words[j].s) j++;
        seek(Math.min(j, S.words.length - 1));
      }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        S.wpm = Math.max(100, Math.min(900, S.wpm + (e.key === 'ArrowUp' ? 25 : -25)));
        St.setSetting('wpm', S.wpm); applySettings();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && S.playing) pause();
      if (!document.hidden && S.playing) play();
    });
    window.addEventListener('pagehide', saveProgressForce);
  }

  // ---------- старт ----------
  async function init() {
    loadSettings();
    bind();
    $('app-version').textContent = 'Вспышка ' + APP_VERSION;
    await renderLibrary();
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && !navigator.standalone && !St.getSetting('hintDismissed', false)) $('install-hint').classList.remove('hidden');
    if (/[?&]demo=1/.test(location.search)) openDemo();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        // новый воркер взял управление — перезагружаемся в свежую версию
        if (hadController) location.reload();
      });
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        setInterval(function () { reg.update().catch(function () {}); }, 30 * 60 * 1000);
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) reg.update().catch(function () {});
        });
      }).catch(function () {});
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
