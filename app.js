(function () {
  'use strict';
  const R = window.RsvpEngine, P = window.BookParsers, St = window.Store;
  const $ = function (id) { return document.getElementById(id); };

  const S = {
    meta: null, chapters: null, words: [], starts: [],
    idx: 0, playing: false, timer: null, wpm: 300,
    recent: [], wakeLock: null, scrubbing: false,
    settings: { font: 40, theme: 'dark', sentence: 2.2, paragraph: 2.8, comma: 1.6, recent: true }
  };

  // ---------- настройки ----------
  function loadSettings() {
    S.wpm = St.getSetting('wpm', 300);
    Object.keys(S.settings).forEach(function (k) { S.settings[k] = St.getSetting('set:' + k, S.settings[k]); });
    applySettings();
  }
  function applySettings() {
    document.body.dataset.theme = S.settings.theme;
    document.documentElement.style.setProperty('--word-size', S.settings.font + 'px');
    $('recent').classList.toggle('hidden', !S.settings.recent);
    $('wpm').value = S.wpm; $('wpm-label').textContent = S.wpm + ' сл/мин';
    $('set-font').value = S.settings.font; $('set-font-label').textContent = S.settings.font + 'px';
    $('set-theme').value = S.settings.theme;
    $('set-sentence').value = S.settings.sentence; $('set-sentence-label').textContent = '×' + S.settings.sentence;
    $('set-paragraph').value = S.settings.paragraph; $('set-paragraph-label').textContent = '×' + S.settings.paragraph;
    $('set-comma').value = S.settings.comma; $('set-comma-label').textContent = '×' + S.settings.comma;
    $('set-recent').checked = S.settings.recent;
  }

  // ---------- тост ----------
  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isErr);
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, isErr ? 5000 : 2500);
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
      del.className = 'book-del'; del.textContent = '✕'; del.title = 'Удалить';
      del.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        if (confirm('Удалить «' + meta.title + '»?')) { await St.deleteBook(meta.id); renderLibrary(); }
      });
      card.append(info, del);
      card.addEventListener('click', function () { openBook(meta); });
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
    const o = R.orpIndex(t.length);
    $('w-left').textContent = t.slice(0, o);
    $('w-pivot').textContent = t[o] || '';
    $('w-right').textContent = t.slice(o + 1);
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
    if (S.playing) S.timer = setTimeout(tick, 400);
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
    S.timer = setTimeout(tick, d);
  }

  async function play() {
    if (!S.words.length) return;
    if (S.idx >= S.words.length) seek(0);
    S.playing = true;
    $('btn-play').textContent = '⏸';
    $('stage-hint').textContent = 'тап — пауза';
    clearTimeout(S.timer);
    tick();
    try { if (navigator.wakeLock) S.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  function pause() {
    S.playing = false;
    $('btn-play').textContent = '▶';
    $('stage-hint').textContent = 'тап — продолжить';
    clearTimeout(S.timer);
    if (S.wakeLock) { try { S.wakeLock.release(); } catch (e) {} S.wakeLock = null; }
    saveProgress();
  }
  function toggle() { S.playing ? pause() : play(); }

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

  function closeDrawers() {
    $('drawer-chapters').classList.add('hidden');
    $('drawer-settings').classList.add('hidden');
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
    $('stage').addEventListener('click', function (e) {
      if (e.target.closest('#recent')) return;
      toggle();
    });
    $('btn-prev-sent').addEventListener('click', function () { seek(R.prevSentence(S.words, curBase())); });
    $('btn-prev-par').addEventListener('click', function () { seek(R.prevParagraph(S.words, curBase())); });

    $('progress').addEventListener('input', function (ev) { seek(+ev.target.value); });
    $('wpm').addEventListener('input', function (ev) {
      S.wpm = +ev.target.value;
      $('wpm-label').textContent = S.wpm + ' сл/мин';
      St.setSetting('wpm', S.wpm);
      if (S.playing) { clearTimeout(S.timer); S.timer = setTimeout(tick, 60000 / S.wpm); }
    });

    $('btn-chapters').addEventListener('click', function () {
      $('drawer-settings').classList.add('hidden');
      $('drawer-chapters').classList.toggle('hidden');
      const act = $('chapter-list').querySelector('.active');
      if (act) act.scrollIntoView({ block: 'center' });
    });
    $('btn-settings').addEventListener('click', function () {
      $('drawer-chapters').classList.add('hidden');
      $('drawer-settings').classList.toggle('hidden');
    });
    document.querySelectorAll('.drawer-close').forEach(function (b) { b.addEventListener('click', closeDrawers); });

    $('set-font').addEventListener('input', function (ev) {
      S.settings.font = +ev.target.value; St.setSetting('set:font', S.settings.font); applySettings();
    });
    $('set-theme').addEventListener('change', function (ev) {
      S.settings.theme = ev.target.value; St.setSetting('set:theme', S.settings.theme); applySettings();
    });
    [['set-sentence', 'sentence'], ['set-paragraph', 'paragraph'], ['set-comma', 'comma']].forEach(function (pair) {
      $(pair[0]).addEventListener('input', function (ev) {
        S.settings[pair[1]] = +ev.target.value; St.setSetting('set:' + pair[1], S.settings[pair[1]]); applySettings();
      });
    });
    $('set-recent').addEventListener('change', function (ev) {
      S.settings.recent = ev.target.checked; St.setSetting('set:recent', S.settings.recent); applySettings();
    });

    $('btn-restart').addEventListener('click', function () { seek(0); play(); });
    $('btn-to-lib').addEventListener('click', backToLibrary);
    $('btn-hint-close').addEventListener('click', function () {
      $('install-hint').classList.add('hidden'); St.setSetting('hintDismissed', true);
    });

    document.addEventListener('keydown', function (e) {
      if ($('screen-reader').classList.contains('hidden')) return;
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
    await renderLibrary();
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && !navigator.standalone && !St.getSetting('hintDismissed', false)) $('install-hint').classList.remove('hidden');
    if (/[?&]demo=1/.test(location.search)) openDemo();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
