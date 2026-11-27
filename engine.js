(function (g) {
  'use strict';
  // ORP (optimal recognition point) — позиция подсвеченной буквы, как в Spritz
  function orpIndex(len) {
    if (len <= 1) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 13) return 3;
    return 4;
  }
  const SENT_END = /[.!?…]["'»»)\]]*$/u;
  const SOFT_END = /[,;:—–]["'»)\]]*$/u;

  // chapters: [{title, text}] -> плоский массив слов с метками границ
  function tokenize(chapters) {
    const words = [];
    chapters.forEach(function (ch, ci) {
      const paras = String(ch.text || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
      paras.forEach(function (p) {
        const tokens = p.split(/\s+/).filter(Boolean);
        // тире: в начале абзаца — маркер реплики, клеим к первому слову;
        // внутри предложения — клеим к предыдущему слову (даёт мягкую паузу)
        const merged = [];
        for (let ti = 0; ti < tokens.length; ti++) {
          const t = tokens[ti];
          if (t === '—' || t === '–') {
            if (merged.length === 0 && ti + 1 < tokens.length) {
              merged.push({ t: '— ' + tokens[ti + 1], d: true }); ti++;
            } else if (merged.length > 0) {
              merged[merged.length - 1].t += ' —';
            } else merged.push({ t: '—' });
            continue;
          }
          merged.push({ t: t });
        }
        if (merged.length && /^[«„]/.test(merged[0].t)) merged[0].d = true;
        let sentStart = true;
        merged.forEach(function (m, ti) {
          words.push({ t: m.t, ch: ci, p: ti === 0, s: sentStart, d: !!m.d });
          sentStart = SENT_END.test(m.t);
        });
      });
    });
    return words;
  }

  // точка фокуса с учётом префикса реплики «— »
  function pivotIndex(t) {
    if (t.indexOf('— ') === 0) return 2 + orpIndex(t.length - 2);
    return orpIndex(t.length);
  }

  function chapterStarts(words) {
    const starts = [];
    words.forEach(function (w, i) { if (w.ch !== (words[i - 1] || {}).ch) starts.push(i); });
    return starts;
  }

  // длительность показа слова, мс
  function delayMs(word, next, wpm, opts) {
    const o = Object.assign({ comma: 1.6, sentence: 2.2, paragraph: 2.8, dialogue: 3.5 }, opts || {});
    let d = 60000 / wpm;
    const t = word.t;
    const letters = t.replace(/[^\p{L}\p{N}]/gu, '').length;
    if (letters > 9) d *= 1 + (letters - 9) * 0.05;
    if (/\d/.test(t)) d *= 1.25;
    if (SENT_END.test(t)) d *= o.sentence;
    else if (SOFT_END.test(t)) d *= o.comma;
    if (next && next.p) d = Math.max(d, (60000 / wpm) * o.paragraph);
    if (next && next.d) d = Math.max(d, (60000 / wpm) * o.dialogue);
    if (!next) d *= 2;
    return Math.round(d);
  }

  // назад к началу текущего предложения; если уже в начале — к предыдущему
  function prevSentence(words, i) {
    let j = Math.min(i, words.length - 1);
    if (j <= 0) return 0;
    if (!words[j].s) { while (j > 0 && !words[j].s) j--; return j; }
    j--; while (j > 0 && !words[j].s) j--; return j;
  }
  function prevParagraph(words, i) {
    let j = Math.min(i, words.length - 1);
    if (j <= 0) return 0;
    if (!words[j].p) { while (j > 0 && !words[j].p) j--; return j; }
    j--; while (j > 0 && !words[j].p) j--; return j;
  }

  g.RsvpEngine = { orpIndex: orpIndex, pivotIndex: pivotIndex, tokenize: tokenize, delayMs: delayMs,
    prevSentence: prevSentence, prevParagraph: prevParagraph, chapterStarts: chapterStarts,
    SENT_END: SENT_END, SOFT_END: SOFT_END };
})(typeof self !== 'undefined' ? self : globalThis);
