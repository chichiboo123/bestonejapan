/* =========================================================================
 * BestOne in Japan - service-worker.js
 * -------------------------------------------------------------------------
 * PWA 설치 및 오프라인 지원을 담당합니다.
 *
 * ★ 코드를 수정해 GitHub 에 올렸는데 예전 화면이 보인다면
 *   아래 CACHE_VERSION 의 숫자를 올려주세요. (예: v1 → v2)
 *   그러면 브라우저가 새 파일을 다시 받아옵니다.
 * ========================================================================= */

const CACHE_VERSION = 'v11';
const SHELL_CACHE = 'bestone-shell-' + CACHE_VERSION;
const DATA_CACHE  = 'bestone-media-' + CACHE_VERSION;

/** 설치할 때 미리 저장해 두는 파일들 (앱 껍데기) */
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './data/transit.js',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './assets/img/login-hero.webp',
  './assets/img/login-hero.jpg'
];

/* ---------- 설치 ---------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES).catch(() => {
        // 일부 파일이 없어도 설치는 계속 진행합니다.
        return Promise.all(SHELL_FILES.map(f => cache.add(f).catch(() => null)));
      }))
      .then(() => self.skipWaiting())
  );
});

/* ---------- 활성화 (옛 캐시 정리) ---------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- 요청 처리 ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  // GET 이 아닌 요청(Apps Script 저장 등)은 그대로 통과시킵니다.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Apps Script API / AI(제미나이) API 는 절대 캐시하지 않습니다(항상 최신 데이터).
  if (url.hostname.indexOf('script.google.com') >= 0 ||
      url.hostname.indexOf('script.googleusercontent.com') >= 0 ||
      url.hostname.indexOf('generativelanguage.googleapis.com') >= 0) {
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

  // 앱 파일(HTML/CSS/JS) : 네트워크 우선 → 항상 최신 코드를 보게 됩니다.
  // 네트워크가 없으면 저장해 둔 파일을 사용합니다.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(cached => {
        if (cached) return cached;
        // 페이지 요청인데 캐시도 없으면 index.html 로 대체
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('오프라인 상태입니다.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }))
  );
});

/* ---------- 페이지에서 보낸 메시지 ---------- */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
