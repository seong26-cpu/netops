// 오프라인 실행용 서비스 워커: 설치 때 앱 기본 파일을 받아 두고, 네트워크가 없으면 캐시로 응답
const CACHE = 'netops-pub-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './addons.js', './pwa-install.js', './ui-fix.js', './storage.js', './hw.js', './upload.js', './enrich.js', './packs/standard-pack.json', './icons/icon-192.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    try { // index.html이 가리키는 앱 파일(JS·CSS)도 미리 받기
      const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
      const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await Promise.all(assets.map((u) => c.add(u).catch(() => {})));
    } catch (_) { /* 오프라인 설치 시도는 무시 */ }
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('netops-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
