// Service worker: deixa o app abrir sem internet. Os dados offline ficam no cache do Firestore.
const CACHE = "ponto-v2";
const SHELL = ["./", "./index.html", "./app.js", "./firebase-config.js", "./manifest.webmanifest",
               "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin && u.hostname !== "www.gstatic.com") return;
  // Rede primeiro (pega atualizações); sem rede, usa o cache.
  e.respondWith(
    fetch(e.request)
      .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
