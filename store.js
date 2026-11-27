(function (g) {
  'use strict';
  const DB = 'rsvp-reader-db', VER = 1;
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function () {
        const d = r.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('content')) d.createObjectStore('content', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('progress')) d.createObjectStore('progress', { keyPath: 'id' });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function req(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        const t = d.transaction(store, mode);
        const out = fn(t.objectStore(store));
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error); };
      });
    });
  }
  const Store = {
    addBook: function (meta, chapters) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          const t = d.transaction(['books', 'content'], 'readwrite');
          t.objectStore('books').put(meta);
          t.objectStore('content').put({ id: meta.id, chapters: chapters });
          t.oncomplete = function () { res(meta); };
          t.onerror = function () { rej(t.error); };
        });
      });
    },
    listBooks: function () { return req('books', 'readonly', function (s) { return s.getAll(); }); },
    getChapters: function (id) {
      return req('content', 'readonly', function (s) { return s.get(id); }).then(function (r) { return r ? r.chapters : null; });
    },
    deleteBook: function (id) {
      return db().then(function (d) {
        return new Promise(function (res, rej) {
          const t = d.transaction(['books', 'content', 'progress'], 'readwrite');
          t.objectStore('books').delete(id);
          t.objectStore('content').delete(id);
          t.objectStore('progress').delete(id);
          t.oncomplete = function () { res(); };
          t.onerror = function () { rej(t.error); };
        });
      });
    },
    getProgress: function (id) { return req('progress', 'readonly', function (s) { return s.get(id); }); },
    saveProgress: function (id, data) {
      return req('progress', 'readwrite', function (s) { return s.put(Object.assign({ id: id }, data)); });
    },
    getSetting: function (k, def) {
      try { const v = localStorage.getItem('rsvp:' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    setSetting: function (k, v) { try { localStorage.setItem('rsvp:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  g.Store = Store;
})(typeof self !== 'undefined' ? self : globalThis);
