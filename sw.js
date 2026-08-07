/* Miroir Anatomique — service worker
   Met l'app en cache pour qu'elle démarre hors ligne une fois installée.
   Les fichiers MediaPipe (CDN) sont mis en cache à la volée : après la
   première utilisation en ligne, l'app fonctionne sans réseau. */

/* ⚠️ Incrémenter CACHE à CHAQUE mise en ligne : sinon les téléphones qui ont
   déjà chargé l'app gardent l'ancienne version. */
const CACHE = "miroir-v8";
const CORE = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/layers.js",
  "./js/lens.js",
  "./js/segment.js",
  "./js/terms.js",
  "./js/labels.js",
  "./js/mirror.js",
  "./js/firstaid.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/* Les modules lourds (moteur 3D) et les modèles anatomiques ne sont PAS
   pré-chargés : ils pèsent 14 Mo et tout le monde n'active pas la 3D.
   Le gestionnaire `fetch` les met en cache au premier usage. */

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isModel = url.hostname.includes("jsdelivr.net")
               || url.hostname.includes("storage.googleapis.com")
               || url.pathname.includes("/assets/anatomy/")   // les .glb, lourds et figés
               || url.pathname.includes("/modules/");

  // Modèle et runtime MediaPipe : cache d'abord (gros fichiers, jamais modifiés)
  if (isModel) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // App : réseau d'abord, cache en secours (pour recevoir les mises à jour)
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
