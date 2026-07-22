/* Service worker de Mon Agenda.
   Stratégie « réseau d'abord » : on tente toujours le réseau (pour avoir la
   dernière version de l'app), et on retombe sur le cache si pas de connexion.
   Les appels à Supabase (données vivantes) ne sont jamais mis en cache. */
const CACHE = 'mon-agenda-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // un par un : si un fichier échoue, les autres sont quand même mis en cache
      // (addAll() en bloc annulerait TOUT à la moindre erreur)
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase, polices… : on laisse passer

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      // hors ligne : la réponse en cache, sinon la page de l'app (quel que soit le chemin demandé)
      .catch(() => caches.match(req)
        .then(r => r || caches.match('./index.html'))
        .then(r => r || caches.match('./')))
  );
});
