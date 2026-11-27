const VERSION = 'vspyshka-v5';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './engine.js', './parsers.js', './store.js',
  './manifest.webmanifest',
  './vendor/jszip.min.js', './vendor/pdf.min.mjs', './vendor/pdf.worker.min.mjs',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon.png',
  './vendor/standard_fonts/FoxitDingbats.pfb', './vendor/standard_fonts/FoxitFixed.pfb', './vendor/standard_fonts/FoxitFixedBold.pfb', './vendor/standard_fonts/FoxitFixedBoldItalic.pfb', './vendor/standard_fonts/FoxitFixedItalic.pfb', './vendor/standard_fonts/FoxitSerif.pfb', './vendor/standard_fonts/FoxitSerifBold.pfb', './vendor/standard_fonts/FoxitSerifBoldItalic.pfb', './vendor/standard_fonts/FoxitSerifItalic.pfb', './vendor/standard_fonts/FoxitSymbol.pfb', './vendor/standard_fonts/LiberationSans-Bold.ttf', './vendor/standard_fonts/LiberationSans-BoldItalic.ttf', './vendor/standard_fonts/LiberationSans-Italic.ttf', './vendor/standard_fonts/LiberationSans-Regular.ttf', './vendor/standard_fonts/LICENSE_FOXIT', './vendor/standard_fonts/LICENSE_LIBERATION'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
