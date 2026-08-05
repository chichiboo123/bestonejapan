/* =========================================================================
 * BestOne in Japan - service-worker.js
 * -------------------------------------------------------------------------
 * PWA 설치 및 오프라인 지원을 담당합니다.
 *
 * ★ 코드를 수정해 GitHub 에 올렸는데 예전 화면이 보인다면
 *   아래 CACHE_VERSION 의 숫자를 올려주세요. (예: v15 → v16)
 *   그러면 브라우저가 새 파일을 다시 받아옵니다.
 *
 * ★ 앱 파일을 다루는 방식 (v15 에서 바뀌었습니다)
 *   예전에는 "네트워크 먼저" 였습니다. 그래서 앱을 켤 때마다
 *   style.css · script.js 같은 큰 파일을 매번 다시 받아오느라
 *   화면이 뜨기까지 오래 걸렸습니다.
 *   지금은 "저장된 파일 먼저 → 뒤에서 조용히 새 파일 확인" 방식입니다.
 *   화면은 즉시 뜨고, 새 버전을 찾으면 앱에 알려 [새로고침] 안내를 띄웁니다.
 * ========================================================================= */

const CACHE_VERSION = 'v15';
const SHELL_CACHE = 'bestone-shell-' + CACHE_VERSION;
const DATA_CACHE  = 'bestone-media-' + CACHE_VERSION;

/** 설치할 때 미리 저장해 두는 파일들 (앱 껍데기) */
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

/**
 * 당장 필요하지는 않지만 있으면 좋은 파일들.
 * 설치를 늦추지 않도록 뒤에서 천천히 저장합니다.
 * (transit.js 는 [현지 > 노선] 을 열 때, 그림은 로그인 화면에서만 씁니다)
 */
const EXTRA_FILES = [
  './data/transit.js',
  './assets/img/login-hero.webp',
  './assets/img/login-hero.jpg'
];

/* ---------- 설치 ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 하나가 실패해도 나머지는 저장되도록 한 개씩 담습니다.
    await Promise.all(SHELL_FILES.map(f => cache.add(f).catch(() => null)));
    // 큰 파일들은 설치를 막지 않고 뒤에서 저장합니다.
    Promise.all(EXTRA_FILES.map(f => cache.add(f).catch(() => null)));
    await self.skipWaiting();
  })());
});

/* ---------- 활성화 (옛 캐시 정리) ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/** 앱 화면에 알림을 보냅니다 (새 버전이 준비되었을 때 등) */
async function tellClients(message) {
  const list = await self.clients.matchAll({ type: 'window' });
  list.forEach(c => { try { c.postMessage(message); } catch (e) { /* 무시 */ } });
}

/* ---------- 요청 처리 ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  // GET 이 아닌 요청(Apps Script 저장 등)은 그대로 통과시킵니다.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Apps Script API / AI / 날씨 API 는 절대 캐시하지 않습니다(항상 최신 정보).
  if (url.hostname.indexOf('script.google.com') >= 0 ||
      url.hostname.indexOf('script.googleusercontent.com') >= 0 ||
      url.hostname.indexOf('generativelanguage.googleapis.com') >= 0 ||
      url.hostname.indexOf('api.groq.com') >= 0 ||
      url.hostname.indexOf('open-meteo.com') >= 0) {
    return;
  }

  // 이미지(Google Drive 사진, QR 코드 등) : 캐시 우선 → 오프라인에서도 보입니다.
  const isImage = req.destination === 'image' ||
    url.hostname.indexOf('drive.google.com') >= 0 ||
    url.hostname.indexOf('googleusercontent.com') >= 0;

  if (isImage) {
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 폰트 등 외부 정적 자원 : 캐시 우선
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(DATA_CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached))
    );
    return;
  }

  /* ---- 앱 파일(HTML/CSS/JS) : 저장된 것 먼저, 새 파일은 뒤에서 확인 ----
   * 화면이 곧바로 뜨는 것이 가장 중요합니다.
   * 새 파일을 발견하면 캐시에 담아 두고 앱에 알려줍니다. */
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req) ||
                   (req.mode === 'navigate' ? await cache.match('./index.html') : null);

    const fetching = fetch(req).then(async res => {
      if (res && res.ok) {
        const copy = res.clone();
        // 내용이 실제로 달라졌을 때만 "새 버전" 이라고 알립니다.
        if (cached) {
          try {
            const oldText = await cached.clone().text();
            const newText = await res.clone().text();
            if (oldText !== newText) tellClients({ type: 'UPDATE_READY' });
          } catch (e) { /* 글자가 아닌 파일은 비교하지 않습니다 */ }
        }
        cache.put(req, copy).catch(() => {});
      }
      return res;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(fetching);   // 저장된 것을 바로 보여주고, 확인은 뒤에서 계속
      return cached;
    }

    const fresh = await fetching;
    if (fresh) return fresh;
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('오프라인 상태입니다.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});

/* ---------- 페이지에서 보낸 메시지 ---------- */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
