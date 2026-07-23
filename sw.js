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

/* ---------- Notifications push (rappels de traitement, événements, tâches) ----------
   Le message envoyé par la fonction serveur est un JSON { title, body, url, tag }.
   `tag` évite d'empiler deux notifications identiques (ex. si l'envoi est relancé). */
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Mon Agenda', body: e.data ? e.data.text() : '' }; }
  const titre = data.title || 'Mon Agenda';
  e.waitUntil(self.registration.showNotification(titre, {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || './' },
  }));
});
// clic sur la notification : on retrouve un onglet déjà ouvert, sinon on en ouvre un
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const dejaOuvert = list.find(c => c.url.includes(self.location.origin));
      if (dejaOuvert) return dejaOuvert.focus();
      return self.clients.openWindow(url);
    })
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
