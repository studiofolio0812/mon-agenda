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

/* ---------- Notifications push (rappels d'habitudes et d'événements) ----------
   Le message envoyé par la fonction serveur est un JSON { title, body, url, tag,
   data?, actions? }. `tag` évite d'empiler deux notifications identiques.
   `data` porte le type (habit/event) et, pour une habitude, de quoi la cocher
   (habitId, date, time). `actions` = boutons affichés sous la notification. */
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Mon Agenda', body: e.data ? e.data.text() : '' }; }
  const titre = data.title || 'Mon Agenda';
  // repli : si la fonction serveur n'envoie pas encore `data`, on déduit le type de l'étiquette
  const meta = data.data || (typeof data.tag === 'string' && data.tag.startsWith('habit-') ? { type: 'habit' } : {});
  const opts = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || (meta.type === 'habit' ? './?go=habits' : './'), meta },
  };
  if (Array.isArray(data.actions) && data.actions.length) opts.actions = data.actions;
  e.waitUntil(self.registration.showNotification(titre, opts));
});

// dépose une habitude cochée dans une petite file IndexedDB, que l'app videra à sa prochaine ouverture
function queueHabitDone(meta) {
  return new Promise(res => {
    let open;
    try { open = indexedDB.open('mon-agenda-pending', 1); } catch (err) { return res(); }
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('habitDone')) open.result.createObjectStore('habitDone', { keyPath: 'key' }); };
    open.onerror = () => res();
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('habitDone')) { db.close(); return res(); }
      const tx = db.transaction('habitDone', 'readwrite');
      tx.objectStore('habitDone').put({ key: `${meta.habitId}|${meta.date}|${meta.time}`, habitId: meta.habitId, date: meta.date, time: meta.time });
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => { db.close(); res(); };
    };
  });
}

self.addEventListener('notificationclick', e => {
  const meta = (e.notification.data && e.notification.data.meta) || {};
  const url = (e.notification.data && e.notification.data.url) || './';
  e.notification.close();

  // bouton « ✓ Fait » sur une habitude : on coche sans ouvrir l'app
  if (e.action === 'done' && meta.type === 'habit' && meta.habitId) {
    e.waitUntil((async () => {
      // 1) si un onglet est ouvert, on le prévient en direct
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      let livre = false;
      for (const c of list) { if (c.url.includes(self.location.origin)) { c.postMessage({ type: 'habit-done', habitId: meta.habitId, date: meta.date, time: meta.time }); livre = true; } }
      // 2) et dans tous les cas on met en file (appliqué à la prochaine ouverture, app fermée comprise)
      await queueHabitDone(meta);
    })());
    return;
  }

  // clic normal : on ouvre l'app (et on l'envoie sur la section Habitudes si c'est une habitude)
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const dejaOuvert = list.find(c => c.url.includes(self.location.origin));
      if (dejaOuvert) {
        if (meta.type === 'habit') dejaOuvert.postMessage({ type: 'navigate', go: 'habits' });
        return dejaOuvert.focus();
      }
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
