/* =========================================================================
 * BestOne in Japan - script.js  (Part 1/3: 기반 · 통신 · 로그인)
 * ========================================================================= */

/* ---------- 설정 가져오기 ---------- */
const CFG   = window.BESTONE_CONFIG;
const API   = CFG.API_CONFIG;
const CO    = CFG.COUNTRY_CONFIG;
const PFX   = API.STORAGE_PREFIX;
const TZ    = CO.timezone;
const TZ_OFFSET_HOURS = 9; // Asia/Tokyo (일광절약시간 없음)

/** 주요 메뉴 정의 (모바일 하단 탭바 + PC 사이드바가 이 정의를 함께 씁니다) */
const TABS = [
  { key: 'today',    label: '오늘', icon: 'wb_sunny' },
  { key: 'schedule', label: '일정', icon: 'calendar_month' },
  { key: 'booking',  label: '예약', icon: 'confirmation_number' },
  { key: 'local',    label: '현지', icon: 'travel_explore' },
  { key: 'record',   label: '기록', icon: 'auto_stories' }
];

/* ---------- 앱 상태 ---------- */
const S = {
  token: null,
  me: '',
  trip: {},
  members: [],
  schedules: [], scheduleComments: [], reservations: [], flights: [], accommodations: [],
  dailyRecords: [], sharedRecords: [], japanesePhrases: [], japaneseWords: [],
  stations: [], buses: [], routes: [], expenses: [], photos: [],
  tab: 'today',
  date: null,          // 일정 · 기록 · 사진 · 지출이 공유하는 '선택된 날짜'
  bookingTab: 'flight',
  localTab: 'transit',
  recordTab: 'day',
  filters: {
    phraseCat: 'all', phraseFav: false, phraseQ: '',
    wordCat: 'all', wordFav: false, wordQ: '',
    bookingType: 'all', bookingQ: '',
    stationQ: '', busQ: '', routeQ: '', scheduleQ: ''
  },
  transit: { city: 'tokyo', mode: 'route', from: null, to: null, result: null, searched: false, line: 0 },
  lastSync: null,
  loading: false,
  booted: false
};

/* =========================================================================
 * 1. 작은 도구들
 * ========================================================================= */

const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

/**
 * 안전한 DOM 생성기.
 * 사용자 입력은 항상 textContent 로만 들어가므로 HTML 주입이 불가능합니다.
 */
function h(tag, props, children) {
  const el = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach(k => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'html') el.innerHTML = v;           // 앱이 만든 고정 마크업에만 사용
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'dataset') Object.keys(v).forEach(d => { el.dataset[d] = v[d]; });
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
  }
  (Array.isArray(children) ? children : (children === undefined || children === null ? [] : [children]))
    .forEach(c => {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
    });
  return el;
}
/** Google Material Symbols 아이콘 (ligature 방식) */
function mi(name, extraClass) {
  return h('span', {
    class: 'mi' + (extraClass ? ' ' + extraClass : ''),
    'aria-hidden': 'true',
    text: name
  });
}

/** 아이콘 + 글자 버튼 */
function iconBtn(icon, label, cls, onclick) {
  return h('button', {
    type: 'button', class: cls || 'btn btn-sm', onclick: onclick, 'aria-label': label
  }, [mi(icon, 'mi-sm'), h('span', { text: label })]);
}

function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
function mount(el, nodes) {
  clear(el);
  (Array.isArray(nodes) ? nodes : [nodes]).forEach(n => { if (n) el.appendChild(n); });
}

/* ---------- localStorage ---------- */
function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(PFX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(PFX + key, JSON.stringify(value)); return true; }
  catch (e) { return false; }
}
function lsDel(key) { try { localStorage.removeItem(PFX + key); } catch (e) {} }

/* ---------- 날짜 · 시간 (Asia/Tokyo 기준) ---------- */
function tokyoNowParts() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const t = new Date(utc + TZ_OFFSET_HOURS * 3600000);
  return {
    y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(),
    hh: t.getHours(), mm: t.getMinutes(), dow: t.getDay(), date: t
  };
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function todayStr() {
  const p = tokyoNowParts();
  return p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
}
function nowTimeStr() {
  const p = tokyoNowParts();
  return pad2(p.hh) + ':' + pad2(p.mm);
}
/** 'yyyy-mm-dd' + 'HH:MM' -> epoch(ms), 도쿄 시각 기준 */
function tokyoEpoch(dateStr, timeStr) {
  if (!dateStr) return NaN;
  const d = String(dateStr).split('-').map(Number);
  const t = String(timeStr || '00:00').split(':').map(Number);
  if (d.length < 3 || isNaN(d[0])) return NaN;
  return Date.UTC(d[0], d[1] - 1, d[2], (t[0] || 0) - TZ_OFFSET_HOURS, t[1] || 0, 0);
}
function nowEpoch() { return Date.now(); }
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
function fmtDateKo(dateStr, withDow) {
  if (!dateStr) return '';
  const p = String(dateStr).split('-');
  if (p.length < 3) return dateStr;
  let s = Number(p[1]) + '월 ' + Number(p[2]) + '일';
  if (withDow) {
    const dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    s += ' (' + DOW_KO[dt.getUTCDay()] + ')';
  }
  return s;
}
function fmtDateFull(dateStr) {
  if (!dateStr) return '';
  const p = String(dateStr).split('-');
  if (p.length < 3) return dateStr;
  const dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  return p[0] + '년 ' + Number(p[1]) + '월 ' + Number(p[2]) + '일 ' + DOW_KO[dt.getUTCDay()] + '요일';
}
function addDaysStr(dateStr, n) {
  const p = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
}
function diffDays(a, b) {
  const pa = String(a).split('-').map(Number), pb = String(b).split('-').map(Number);
  if (pa.length < 3 || pb.length < 3) return 0;
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function fmtRelative(ms) {
  if (!isFinite(ms)) return '';
  const abs = Math.abs(ms);
  const min = Math.floor(abs / 60000);
  const hh = Math.floor(min / 60), mm = min % 60;
  const day = Math.floor(hh / 24);
  let s;
  if (day >= 1) s = day + '일 ' + (hh % 24) + '시간';
  else if (hh >= 1) s = hh + '시간 ' + mm + '분';
  else s = min + '분';
  return ms >= 0 ? s + ' 후' : s + ' 전';
}
function fmtSyncTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const utc = d.getTime() + (new Date()).getTimezoneOffset() * 0; // 로컬 표시
  const l = new Date(d);
  return pad2(l.getHours()) + ':' + pad2(l.getMinutes()) + ':' + pad2(l.getSeconds());
}
function minusMinutes(timeStr, minutes) {
  if (!timeStr) return '';
  const t = String(timeStr).split(':').map(Number);
  let total = (t[0] || 0) * 60 + (t[1] || 0) - (Number(minutes) || 0);
  while (total < 0) total += 1440;
  return pad2(Math.floor(total / 60) % 24) + ':' + pad2(total % 60);
}

/* ---------- 기타 ---------- */
function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
function truthy(v) { return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1'; }
function catInfo(key) {
  return CFG.CATEGORIES.filter(c => c.key === key)[0] ||
    { key: key || 'etc', label: key || '기타', icon: 'push_pin', color: '#8b8377' };
}
function memberInfo(nickname) {
  const m = S.members.filter(x => x.nickname === nickname)[0];
  if (m) return m;
  const p = CFG.USER_PRESETS.filter(x => x.nickname === nickname)[0];
  if (p) return { nickname: nickname, displayName: p.label, emoji: p.emoji, color: '#7d9db3' };
  return { nickname: nickname || '', displayName: nickname || '', emoji: '🙂', color: '#7d9db3' };
}
function isMine(rec) { return rec && (rec.createdBy === S.me || rec.author === S.me); }
function byId(list, id) { return list.filter(x => String(x.id) === String(id))[0] || null; }
function sortByTime(a, b) {
  const ta = (a.startTime || '99:99'), tb = (b.startTime || '99:99');
  if (ta === tb) return String(a.title || '').localeCompare(String(b.title || ''));
  return ta < tb ? -1 : 1;
}
function sortByDateTime(a, b) {
  const da = (a.date || '9999'), db = (b.date || '9999');
  if (da !== db) return da < db ? -1 : 1;
  return sortByTime(a, b);
}

/* =========================================================================
 * 2. 통신 (Apps Script)
 * ========================================================================= */

/** 사용자에게 보여줄 오류 메시지로 변환 */
function describeError(err) {
  if (!err) return '알 수 없는 오류가 발생했습니다.';
  if (err.code === 'NO_API_URL') return err.message;
  if (err.code === 'TIMEOUT') return '서버 응답이 너무 늦습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
  if (err.code === 'NETWORK') {
    return !navigator.onLine
      ? '인터넷에 연결되어 있지 않습니다. 연결 후 다시 시도해 주세요.'
      : '서버에 연결하지 못했습니다. (Failed to fetch / CORS)\nApps Script 배포 설정 문제일 가능성이 높습니다.';
  }
  if (err.code === 'BAD_RESPONSE') {
    return '서버가 올바른 응답을 주지 않았습니다. Apps Script 를 새 버전으로 다시 배포했는지 확인해 주세요.';
  }
  return err.message || '오류가 발생했습니다.';
}

function apiError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Apps Script 호출.
 * - POST + Content-Type: text/plain 으로 보내 preflight(OPTIONS)를 피합니다.
 * - redirect: 'follow' (Apps Script 는 응답 전에 리디렉션합니다)
 * - no-cors 는 사용하지 않습니다(응답을 읽어야 하므로).
 */
async function callApi(action, payload, opts) {
  opts = opts || {};
  const url = API.API_URL;
  if (!url || url.indexOf('PUT_YOUR') === 0 || url.indexOf('http') !== 0) {
    throw apiError('NO_API_URL',
      'config.js 의 API_URL 이 아직 설정되지 않았습니다.\nApps Script 웹 앱 주소(.../exec)를 넣어 주세요.');
  }

  const body = Object.assign({ action: action }, payload || {});
  if (S.token && !body.token) body.token = S.token;

  const attempts = (opts.retry === undefined ? API.RETRY : opts.retry) + 1;
  let lastErr = null;

  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeout || API.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        // text/plain 은 CORS 안전 목록에 있어 preflight 가 발생하지 않습니다.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) throw apiError('BAD_RESPONSE', 'HTTP ' + res.status);
      const textBody = await res.text();
      let json;
      try { json = JSON.parse(textBody); }
      catch (e) { throw apiError('BAD_RESPONSE', '응답을 해석할 수 없습니다.'); }
      return json;

    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') lastErr = apiError('TIMEOUT', '요청 시간이 초과되었습니다.');
      else if (err && err.code) lastErr = err;
      else lastErr = apiError('NETWORK', String(err && err.message ? err.message : err));

      // 네트워크 오류만 재시도
      if (lastErr.code !== 'NETWORK' || i === attempts - 1) break;
      await new Promise(r => setTimeout(r, 900 * (i + 1)));
    }
  }
  throw lastErr;
}

/** 성공 응답이면 data 를 돌려주고, 실패면 예외를 던집니다. */
async function api(action, payload, opts) {
  const json = await callApi(action, payload, opts);
  if (json && json.success) return json.data || {};
  const e = apiError(json && json.error ? json.error : 'SERVER_ERROR',
    (json && json.message) ? json.message : '서버에서 오류를 돌려주었습니다.');
  e.data = json && json.data;
  if (e.code === 'INVALID_SESSION') handleSessionExpired();
  throw e;
}

function handleSessionExpired() {
  lsDel('token');
  S.token = null;
  toast('로그인이 만료되었습니다. 다시 로그인해 주세요.', 'error');
  setTimeout(() => showLogin(), 600);
}

/* =========================================================================
 * 3. 공통 UI (토스트 / 확인창 / 로딩 / 뷰어)
 * ========================================================================= */

function toast(message, kind, ms) {
  const wrap = $('#toastWrap');
  const el = h('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: message });
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s ease, transform .25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
  }, ms || 2600);
}

function showLoading(text) {
  $('#loadingText').textContent = text || '불러오는 중…';
  $('#loadingOverlay').classList.remove('hidden');
}
function hideLoading() { $('#loadingOverlay').classList.add('hidden'); }

function confirmBox(title, text, okLabel) {
  return new Promise(resolve => {
    const back = $('#confirmBackdrop');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text || '';
    $('#confirmOk').textContent = okLabel || '확인';
    back.classList.remove('hidden');
    function done(v) {
      back.classList.add('hidden');
      $('#confirmOk').removeEventListener('click', okFn);
      $('#confirmCancel').removeEventListener('click', noFn);
      back.removeEventListener('click', bgFn);
      resolve(v);
    }
    function okFn() { done(true); }
    function noFn() { done(false); }
    function bgFn(e) { if (e.target === back) done(false); }
    $('#confirmOk').addEventListener('click', okFn);
    $('#confirmCancel').addEventListener('click', noFn);
    back.addEventListener('click', bgFn);
  });
}

function openViewer(url, isPdf) {
  const inner = $('#viewerInner');
  clear(inner);
  if (isPdf) inner.appendChild(h('iframe', { src: url, title: '문서 보기' }));
  else inner.appendChild(h('img', { src: url, alt: '크게 보기' }));
  $('#viewer').classList.remove('hidden');
}
function openBigText(main, sub) {
  $('#bigTextMain').textContent = main || '';
  $('#bigTextSub').textContent = sub || '';
  $('#bigText').classList.remove('hidden');
}

async function copyText(value, label) {
  const text = String(value || '');
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    toast((label || '내용') + '을(를) 복사했습니다.', 'ok', 1800);
  } catch (e) {
    toast('복사에 실패했습니다. 길게 눌러 직접 복사해 주세요.', 'error');
  }
}

function speakJa(text) {
  if (!('speechSynthesis' in window)) {
    toast('이 브라우저는 음성 재생을 지원하지 않습니다.', 'error');
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text || ''));
    u.lang = CO.speechLang || 'ja-JP';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch (e) {
    toast('음성 재생에 실패했습니다.', 'error');
  }
}

function openExternal(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}
function mapsSearchUrl(query) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(query || ''));
}

/* 빈 화면 / 스켈레톤 */
function emptyBox(title, desc, icon) {
  return h('div', { class: 'empty' }, [
    h('div', { class: 'e-art' }, mi(icon || 'bedtime')),
    h('div', { class: 'e-title', text: title }),
    h('div', { class: 'e-desc', text: desc || '' })
  ]);
}
function skeletonList(n) {
  const wrap = h('div');
  for (let i = 0; i < (n || 3); i++) {
    wrap.appendChild(h('div', { class: 'skeleton' }, [
      h('div', { class: 'sk-line w40' }),
      h('div', { class: 'sk-line w90' }),
      h('div', { class: 'sk-line w70' })
    ]));
  }
  return wrap;
}

/* =========================================================================
 * 4. 로그인 화면
 * ========================================================================= */

function showLogin() {
  $('#app').classList.add('hidden');
  $('#loginScreen').classList.remove('hidden');
  $('#loginMsg').textContent = '';
  $('#loginHelp').classList.add('hidden');
  const btn = $('#loginBtn');
  btn.disabled = false;
  $('.btn-text', btn).textContent = '여행 시작하기';
}
function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

function buildUserPicker() {
  const wrap = $('#userPick');
  clear(wrap);
  const saved = lsGet('lastUser', '');
  CFG.USER_PRESETS.forEach(u => {
    const chip = h('button', {
      type: 'button',
      class: 'user-chip' + (saved === u.nickname ? ' selected' : ''),
      'aria-pressed': saved === u.nickname ? 'true' : 'false',
      dataset: { nick: u.nickname },
      onclick: () => {
        $$('.user-chip', wrap).forEach(c => {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        $('#loginNickname').value = '';
      }
    }, [
      h('span', { class: 'u-emoji', 'aria-hidden': 'true', text: u.emoji }),
      h('span', { class: 'u-name', text: u.label }),
      h('span', { class: 'u-nick', text: u.nickname })
    ]);
    wrap.appendChild(chip);
  });
}

function selectedNickname() {
  const typed = $('#loginNickname').value.trim();
  if (typed) return typed;
  const chip = $('.user-chip.selected');
  return chip ? chip.dataset.nick : '';
}

/**
 * 로그인 실패 원인별 해결 방법을 화면에 직접 보여줍니다.
 *
 * CORS 오류("No 'Access-Control-Allow-Origin' header")는 거의 항상
 * Apps Script 웹 앱의 "액세스 권한이 있는 사용자"가 "모든 사용자"가 아니어서
 * 구글 로그인 페이지로 리디렉션되기 때문에 생깁니다.
 * 리디렉션된 로그인 페이지에는 CORS 헤더가 없어 브라우저가 응답을 막습니다.
 */
function renderLoginHelp(err) {
  const box = $('#loginHelp');
  clear(box);
  const code = err && err.code;

  if (code !== 'NETWORK' && code !== 'BAD_RESPONSE' && code !== 'NO_API_URL') {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');

  if (code === 'NO_API_URL') {
    box.appendChild(h('h3', { text: 'config.js 설정이 필요합니다' }));
    box.appendChild(h('p', { text: 'config.js 파일의 API_URL 에 Apps Script 웹 앱 주소(.../exec)를 넣고 GitHub 에 다시 올려주세요.' }));
    return;
  }

  box.appendChild(h('h3', { text: '이렇게 해결하세요' }));
  const ol = h('ol');
  [
    'Apps Script 편집기에서 오른쪽 위 [배포] → [배포 관리] 를 엽니다.',
    '연필(✏️) 아이콘을 누릅니다.',
    '"액세스 권한이 있는 사용자" 를 반드시 [모든 사용자] 로 바꿉니다.',
    '"버전" 을 [새 버전] 으로 바꾼 뒤 [배포] 를 누릅니다.',
    '아래 버튼으로 주소를 열어 JSON 이 보이는지 확인한 뒤 다시 로그인하세요.'
  ].forEach(t => ol.appendChild(h('li', { text: t })));
  box.appendChild(ol);

  box.appendChild(h('button', {
    type: 'button', class: 'btn btn-sm btn-block',
    text: '웹 앱 주소 새 탭에서 열어보기',
    onclick: () => openExternal(API.API_URL)
  }));
  box.appendChild(h('p', { class: 'tiny', style: 'margin-top:8px;color:var(--text-faint)' },
    '열었을 때 {"success":true...} 같은 JSON 이 보이면 배포는 정상입니다. ' +
    '구글 로그인 화면이나 "액세스 권한이 없습니다" 가 보이면 3번 설정이 잘못된 것입니다.'));
}

async function doLogin(e) {
  if (e) e.preventDefault();
  const msg = $('#loginMsg');
  const btn = $('#loginBtn');
  const password = $('#loginPassword').value;
  const nickname = selectedNickname();
  const tripCode = $('#loginTripCode').value.trim();

  msg.className = 'login-msg';
  $('#loginHelp').classList.add('hidden');
  if (!password) { msg.textContent = '비밀번호를 입력해 주세요.'; return; }
  if (!nickname) { msg.textContent = '사용자를 선택하거나 닉네임을 입력해 주세요.'; return; }

  btn.disabled = true;
  $('.btn-text', btn).textContent = '확인 중…';
  msg.textContent = '';

  try {
    const data = await api('login', {
      tripCode: tripCode,
      password: password,
      nickname: nickname,
      device: navigator.userAgent.substring(0, 100)
    }, { retry: 1 });

    S.token = data.token;
    S.me = data.nickname;
    lsSet('token', data.token);
    lsSet('me', data.nickname);
    lsSet('lastUser', nickname);
    lsSet('tripCode', tripCode);
    $('#loginPassword').value = '';

    msg.className = 'login-msg ok';
    msg.textContent = '환영합니다!';
    showApp();
    await bootstrap(true);
  } catch (err) {
    msg.className = 'login-msg';
    msg.textContent = describeError(err);
    renderLoginHelp(err);
  } finally {
    btn.disabled = false;
    $('.btn-text', btn).textContent = '여행 시작하기';
  }
}

async function doLogout() {
  const yes = await confirmBox('로그아웃', '로그아웃하면 이 기기에서 다시 로그인해야 합니다.\n계속할까요?', '로그아웃');
  if (!yes) return;
  try { await api('logout', {}, { retry: 0 }); } catch (e) { /* 무시 */ }
  lsDel('token');
  S.token = null;
  toast('로그아웃되었습니다.', 'ok');
  showLogin();
}

/* =========================================================================
 * BestOne in Japan - script.js  (Part 2/3: 데이터 · 폼 · 업로드)
 * ========================================================================= */

/* =========================================================================
 * 5. 데이터 불러오기 / 캐시
 * ========================================================================= */

const CACHE_KEY = 'bootstrapCache';

function applyBootstrap(data) {
  S.trip             = data.trip || {};
  S.members          = data.members || [];
  S.flights          = data.flights || [];
  S.accommodations   = data.accommodations || [];
  S.reservations     = data.reservations || [];
  S.schedules        = data.schedules || [];
  S.scheduleComments = data.scheduleComments || [];
  S.dailyRecords     = data.dailyRecords || [];
  S.sharedRecords    = data.sharedRecords || [];
  S.japanesePhrases  = data.japanesePhrases || [];
  S.japaneseWords    = data.japaneseWords || [];
  S.stations         = data.stations || [];
  S.buses            = data.buses || [];
  S.routes           = data.routes || [];
  S.expenses         = data.expenses || [];
  S.photos           = data.photos || [];
  if (data.me) S.me = data.me;
}

async function bootstrap(showSpinner) {
  if (showSpinner) showLoading('여행 정보를 불러오는 중…');
  S.loading = true;
  renderCurrentTab();
  try {
    const data = await api('getBootstrapData', {}, { retry: 1 });
    applyBootstrap(data);
    S.lastSync = new Date().toISOString();
    S.booted = true;
    lsSet(CACHE_KEY, { data: data, at: S.lastSync });
    updateHeader();
    ensureDefaultDates();
    renderCurrentTab();
    updateSyncBar('마지막 동기화 ' + fmtSyncTime(S.lastSync));
  } catch (err) {
    const cache = lsGet(CACHE_KEY, null);
    if (cache && cache.data) {
      applyBootstrap(cache.data);
      S.booted = true;
      updateHeader();
      ensureDefaultDates();
      renderCurrentTab();
      updateSyncBar('오프라인 - 저장된 자료 (' + fmtSyncTime(cache.at) + ')');
      toast('서버에 연결하지 못해 저장된 자료를 보여줍니다.', 'error', 3200);
    } else {
      updateSyncBar('불러오기 실패');
      renderLoadError(err);
    }
  } finally {
    S.loading = false;
    hideLoading();
  }
}

/** 저장 후 조용히 다시 불러오기 */
async function silentRefresh() {
  try {
    const data = await api('getBootstrapData', {}, { retry: 0 });
    applyBootstrap(data);
    S.lastSync = new Date().toISOString();
    lsSet(CACHE_KEY, { data: data, at: S.lastSync });
    updateSyncBar('마지막 동기화 ' + fmtSyncTime(S.lastSync));
    renderCurrentTab();
  } catch (e) { /* 조용히 실패 */ }
}

function renderLoadError(err) {
  const view = $('#view-' + S.tab);
  mount(view, h('div', { class: 'card' }, [
    h('h2', { class: 'section-title', text: '자료를 불러오지 못했습니다' }),
    h('p', { class: 'muted mt8', style: 'white-space:pre-wrap;font-size:.9rem', text: describeError(err) }),
    h('div', { class: 'row mt16' }, [
      h('button', { class: 'btn btn-primary', text: '다시 시도', onclick: () => bootstrap(true) }),
      h('button', { class: 'btn btn-ghost', text: '로그아웃', onclick: doLogout })
    ])
  ]));
}

function ensureDefaultDates() {
  const today = todayStr();
  const dates = tripDates();
  if (!S.date || dates.indexOf(S.date) < 0) {
    S.date = dates.indexOf(today) >= 0 ? today : (dates[0] || today);
  }
}

/** 여행 기간의 날짜 목록 (여행 정보가 없으면 일정에 등장하는 날짜 사용) */
function tripDates() {
  const out = [];
  const s = S.trip.startDate, e = S.trip.endDate;
  if (s && e && diffDays(s, e) >= 0 && diffDays(s, e) < 120) {
    let cur = s;
    while (diffDays(cur, e) >= 0) { out.push(cur); cur = addDaysStr(cur, 1); }
    return out;
  }
  const set = {};
  S.schedules.forEach(x => { if (x.date) set[x.date] = 1; });
  S.flights.forEach(x => { if (x.date) set[x.date] = 1; });
  S.reservations.forEach(x => { if (x.date) set[x.date] = 1; });
  S.dailyRecords.forEach(x => { if (x.date) set[x.date] = 1; });
  const keys = Object.keys(set).sort();
  if (!keys.length) return [todayStr()];
  return keys;
}

function updateHeader() {
  const country = S.trip.country || CO.nameKo;
  $$('.header-country').forEach(el => { el.textContent = CO.nameEn; });
  $('#headerSub').textContent = S.trip.intro || CO.subtitle;
  $('#syncMe').textContent = S.me ? (memberInfo(S.me).emoji + ' ' + S.me) : '';
  document.title = CO.appName + (S.trip.tripName ? ' · ' + S.trip.tripName : '');
}

function updateSyncBar(text) {
  $('#syncText').textContent = text;
}

function updateNetDot() {
  const dot = $('#netDot');
  if (navigator.onLine) { dot.classList.remove('offline'); dot.title = '온라인'; }
  else { dot.classList.add('offline'); dot.title = '오프라인'; }
}

/* =========================================================================
 * 6. 엔티티 정의 (폼 필드)
 * ========================================================================= */

function opt(list) { return list.map(x => (typeof x === 'string' ? { value: x, label: x } : x)); }
const CAT_OPTIONS  = CFG.CATEGORIES.map(c => ({ value: c.key, label: c.emoji + ' ' + c.label }));
const RES_OPTIONS  = CFG.RESERVATION_TYPES.map(c => ({ value: c.key, label: c.label }));
const TRANS_OPTIONS = opt(CFG.TRANSPORT_OPTIONS);

const ENTITIES = {
  schedule: {
    list: 'schedules', title: '일정', action: 'Schedule',
    fields: [
      { k: 'date', l: '날짜', t: 'date', req: true },
      { k: 'startTime', l: '시작 시각', t: 'time', half: true },
      { k: 'endTime', l: '종료 시각', t: 'time', half: true },
      { k: 'category', l: '카테고리', t: 'select', options: CAT_OPTIONS, def: 'sightseeing' },
      { k: 'title', l: '제목', t: 'text', req: true, ph: '예: 오도리 공원 산책' },
      { k: 'place', l: '장소', t: 'text', ph: '예: 삿포로시 주오구' },
      { k: 'description', l: '상세 설명', t: 'textarea' },
      { g: '이동' },
      { k: 'transport', l: '이동 수단', t: 'select', options: [{ value: '', label: '선택 안 함' }].concat(TRANS_OPTIONS) },
      { k: 'travelMinutes', l: '예상 이동 시간(분)', t: 'number', half: true },
      { k: 'departBy', l: '출발 권장 시각', t: 'time', half: true, hint: '비워두면 시작 시각 - 이동 시간으로 자동 계산합니다.' },
      { k: 'mapUrl', l: '지도 링크', t: 'url', ph: 'https://...' },
      { g: '기타' },
      { k: 'prepare', l: '준비물', t: 'text', ph: '예: 티켓 QR, 우산' },
      { k: 'reservationId', l: '관련 예약', t: 'reservationPick' },
      { k: 'mustGo', l: '꼭 가기 표시', t: 'check' },
      { k: 'isDone', l: '완료함', t: 'check' }
    ]
  },

  flight: {
    list: 'flights', title: '항공', action: 'Flight',
    fields: [
      { k: 'date', l: '출발일', t: 'date', req: true },
      { k: 'airline', l: '항공사', t: 'text', half: true, ph: '예: 대한항공' },
      { k: 'flightNo', l: '편명', t: 'text', half: true, req: true, ph: '예: KE765' },
      { g: '출발' },
      { k: 'depAirport', l: '출발 공항', t: 'text', half: true, ph: '예: 인천(ICN)' },
      { k: 'depTerminal', l: '출발 터미널', t: 'text', half: true },
      { k: 'depTime', l: '출발 시각', t: 'time' },
      { g: '도착' },
      { k: 'arrAirport', l: '도착 공항', t: 'text', half: true, ph: '예: 신치토세(CTS)' },
      { k: 'arrTerminal', l: '도착 터미널', t: 'text', half: true },
      { k: 'arrTime', l: '도착 시각', t: 'time' },
      { g: '예약' },
      { k: 'seat', l: '좌석', t: 'text', half: true, ph: '예: 32A / 32B' },
      { k: 'baggage', l: '수하물', t: 'text', half: true, ph: '예: 23kg x 1' },
      { k: 'bookingNumber', l: '예약 번호', t: 'text', copy: true },
      { k: 'bookingSite', l: '예약 사이트', t: 'url' },
      { k: 'ticketUrl', l: '탑승권 / 예약 확인서', t: 'image', hint: '사진 또는 PDF 를 올리거나 주소를 직접 넣을 수 있습니다.' },
      { k: 'memo', l: '메모', t: 'textarea' }
    ]
  },

  accommodation: {
    list: 'accommodations', title: '숙소', action: 'Accommodation',
    fields: [
      { k: 'name', l: '호텔명', t: 'text', req: true },
      { k: 'nameJa', l: '일본어 호텔명', t: 'text', ja: true },
      { k: 'checkInDate', l: '체크인 날짜', t: 'date', half: true },
      { k: 'checkInTime', l: '체크인 시각', t: 'time', half: true },
      { k: 'checkOutDate', l: '체크아웃 날짜', t: 'date', half: true },
      { k: 'checkOutTime', l: '체크아웃 시각', t: 'time', half: true },
      { g: '위치' },
      { k: 'address', l: '주소', t: 'textarea' },
      { k: 'addressJa', l: '일본어 주소', t: 'textarea', ja: true, hint: '택시 기사에게 보여줄 때 사용합니다.' },
      { k: 'nearestStation', l: '가까운 역', t: 'text', half: true },
      { k: 'recommendedExit', l: '추천 출구', t: 'text', half: true },
      { k: 'mapUrl', l: '지도 링크', t: 'url' },
      { g: '예약' },
      { k: 'roomType', l: '객실 유형', t: 'text' },
      { k: 'bookingNumber', l: '예약 번호', t: 'text', copy: true },
      { k: 'bookingSite', l: '예약 사이트', t: 'url' },
      { k: 'officialSite', l: '호텔 공식 사이트', t: 'url' },
      { k: 'phone', l: '전화번호', t: 'text', copy: true },
      { k: 'breakfast', l: '조식', t: 'text', half: true, ph: '예: 포함 / 불포함' },
      { k: 'nonSmoking', l: '금연 여부', t: 'text', half: true, ph: '예: 금연' },
      { k: 'luggageStorage', l: '짐 보관', t: 'text', ph: '예: 체크인 전 보관 가능' },
      { k: 'ticketUrl', l: '예약 확인서', t: 'image' },
      { k: 'memo', l: '메모', t: 'textarea' }
    ]
  },

  reservation: {
    list: 'reservations', title: '예약', action: 'Reservation',
    fields: [
      { k: 'type', l: '예약 유형', t: 'select', options: RES_OPTIONS, def: 'sightseeing', req: true },
      { k: 'title', l: '예약명', t: 'text', req: true },
      { k: 'date', l: '날짜', t: 'date' },
      { k: 'startTime', l: '시작 시각', t: 'time', half: true },
      { k: 'endTime', l: '종료 시각', t: 'time', half: true },
      { k: 'place', l: '장소', t: 'text' },
      { k: 'meetingPoint', l: '집합 장소', t: 'text' },
      { k: 'people', l: '인원', t: 'text', half: true, ph: '예: 2명' },
      { k: 'bookingNumber', l: '예약 번호', t: 'text', half: true, copy: true },
      { g: '티켓' },
      { k: 'qrImageUrl', l: 'QR 코드 이미지', t: 'image' },
      { k: 'ticketUrl', l: '티켓 이미지 / PDF', t: 'image' },
      { k: 'bookingSite', l: '예약 사이트', t: 'url' },
      { k: 'officialSite', l: '공식 사이트', t: 'url' },
      { k: 'mapUrl', l: '지도 링크', t: 'url' },
      { g: '기타' },
      { k: 'prepare', l: '준비물', t: 'text' },
      { k: 'cancelPolicy', l: '취소 규정', t: 'textarea' },
      { k: 'transport', l: '이동 방법', t: 'textarea' },
      { k: 'memo', l: '메모', t: 'textarea' }
    ]
  },

  dailyRecord: {
    list: 'dailyRecords', title: '하루 기록', action: 'DailyRecord',
    fields: [
      { k: 'date', l: '날짜', t: 'date', req: true },
      { k: 'photoUrl', l: '오늘의 대표 사진', t: 'image' },
      { k: 'places', l: '오늘 방문한 장소', t: 'textarea' },
      { k: 'bestMoment', l: '가장 기억에 남은 순간', t: 'textarea' },
      { k: 'foods', l: '오늘 먹은 음식', t: 'textarea' },
      { k: 'oneLine', l: '오늘의 한 문장', t: 'text', ph: '한 줄로 남겨보세요' },
      { k: 'color', l: '오늘의 색깔', t: 'select', options: [{ value: '', label: '선택 안 함' }].concat(opt(CFG.RECORD_COLORS)), half: true },
      { k: 'music', l: '오늘의 음악', t: 'text', half: true },
      { k: 'surprise', l: '예상과 달랐던 점', t: 'textarea' },
      { k: 'revisit', l: '다시 가고 싶은 장소', t: 'text' },
      { k: 'tomorrow', l: '내일 기대되는 것', t: 'text' },
      { k: 'rating', l: '만족도', t: 'rating' },
      { k: 'freeText', l: '자유 기록', t: 'textarea' }
    ]
  },

  sharedRecord: {
    list: 'sharedRecords', title: '공동 기록', action: 'SharedRecord',
    fields: [
      { k: 'date', l: '날짜', t: 'date', req: true },
      { k: 'title', l: '오늘의 여행 제목', t: 'text', ph: '예: 별이 잘 보이던 날' },
      { k: 'photoUrl', l: '공동 대표 사진', t: 'image' },
      { k: 'bestMoment', l: '오늘의 베스트 순간', t: 'textarea' },
      { k: 'words', l: '함께 기억하고 싶은 말', t: 'textarea' },
      { k: 'memo', l: '공동 메모', t: 'textarea' }
    ]
  },

  japanesePhrase: {
    list: 'japanesePhrases', title: '일본어 표현', action: 'JapanesePhrase',
    fields: [
      { k: 'category', l: '카테고리', t: 'select', options: CFG.PHRASE_CATEGORIES.map(c => ({ value: c.key, label: c.label })), def: 'greeting' },
      { k: 'ko', l: '한국어', t: 'text', req: true },
      { k: 'ja', l: '일본어', t: 'text', req: true, ja: true },
      { k: 'reading', l: '한국어식 읽는 법', t: 'text' },
      { k: 'memo', l: '메모', t: 'textarea' }
    ]
  },

  japaneseWord: {
    list: 'japaneseWords', title: '일본어 단어', action: 'JapaneseWord',
    fields: [
      { k: 'category', l: '카테고리', t: 'select', options: CFG.WORD_CATEGORIES.map(c => ({ value: c.key, label: c.label })), def: 'station' },
      { k: 'ja', l: '일본어', t: 'text', req: true, ja: true },
      { k: 'reading', l: '읽는 법', t: 'text' },
      { k: 'ko', l: '한국어 뜻', t: 'text', req: true },
      { k: 'memo', l: '메모', t: 'textarea' }
    ]
  },

  station: {
    list: 'stations', title: '역 정보', action: 'Station',
    fields: [
      { k: 'city', l: '도시', t: 'text', half: true, ph: '예: 삿포로' },
      { k: 'nameKo', l: '한글 역명', t: 'text', half: true, req: true },
      { k: 'nameJa', l: '일본어 역명', t: 'text', ja: true, half: true },
      { k: 'nameEn', l: '영문 역명', t: 'text', half: true },
      { k: 'lines', l: '노선명', t: 'text' },
      { k: 'lineColor', l: '노선 색상', t: 'text', half: true, ph: '#2f6f4f' },
      { k: 'stationNumber', l: '역 번호', t: 'text', half: true, ph: '예: N06' },
      { g: '출구 · 시설' },
      { k: 'exits', l: '주요 출구', t: 'textarea' },
      { k: 'recommendedExit', l: '추천 출구', t: 'text' },
      { k: 'transfers', l: '환승 노선', t: 'text' },
      { k: 'elevator', l: '엘리베이터', t: 'text', half: true },
      { k: 'coinLocker', l: '코인로커', t: 'text', half: true },
      { k: 'toilet', l: '화장실', t: 'text', half: true },
      { k: 'hotelRelation', l: '숙소와의 관계', t: 'text', half: true },
      { k: 'nearby', l: '주변 관광지', t: 'textarea' },
      { g: '링크' },
      { k: 'mapUrl', l: '지도 링크', t: 'url' },
      { k: 'officialSite', l: '공식 사이트', t: 'url' },
      { k: 'photoUrl', l: '역 사진', t: 'image' },
      { k: 'memo', l: '메모', t: 'textarea' }
    ]
  },

  bus: {
    list: 'buses', title: '버스 정보', action: 'Bus',
    fields: [
      { k: 'city', l: '도시', t: 'text', half: true },
      { k: 'company', l: '버스 회사', t: 'text', half: true },
      { k: 'lineName', l: '노선명 또는 번호', t: 'text', req: true },
      { k: 'fromStop', l: '출발 정류장', t: 'text', half: true },
      { k: 'toStop', l: '도착 정류장', t: 'text', half: true },
      { k: 'fromStopJa', l: '출발 정류장(일본어)', t: 'text', ja: true, half: true },
      { k: 'toStopJa', l: '도착 정류장(일본어)', t: 'text', ja: true, half: true },
      { g: '타는 방법' },
      { k: 'boardingPoint', l: '승차 위치', t: 'text' },
      { k: 'boardingDoor', l: '앞문 / 뒷문 승차', t: 'select', options: opt(['앞문 승차', '뒷문 승차', '확인 필요']) },
      { k: 'alightMethod', l: '하차 방식', t: 'text', ph: '예: 벨을 누르고 앞문으로 하차' },
      { k: 'icCard', l: '교통카드 사용', t: 'select', options: opt(['사용 가능', '사용 불가', '확인 필요']) },
      { k: 'needTicket', l: '정리권 필요 여부', t: 'select', options: opt(['필요', '불필요', '확인 필요']) },
      { k: 'paymentMethod', l: '요금 지불 방식', t: 'text', ph: '예: 하차 시 지불' },
      { g: '운행' },
      { k: 'fare', l: '예상 요금', t: 'text', half: true },
      { k: 'durationMinutes', l: '예상 소요(분)', t: 'number', half: true },
      { k: 'firstBus', l: '첫차', t: 'text', half: true },
      { k: 'lastBus', l: '막차', t: 'text', half: true },
      { k: 'officialSite', l: '공식 사이트', t: 'url' },
      { k: 'mapUrl', l: '지도 링크', t: 'url' },
      { k: 'photoUrl', l: '정류장 사진', t: 'image' },
      { k: 'memo', l: '메모', t: 'textarea' }
    ]
  },

  route: {
    list: 'routes', title: '이동 경로', action: 'Route',
    fields: [
      { k: 'name', l: '경로명', t: 'text', req: true, ph: '예: 삿포로역 → 에스콘필드' },
      { k: 'fromPlace', l: '출발지', t: 'text', half: true },
      { k: 'toPlace', l: '도착지', t: 'text', half: true },
      { k: 'steps', l: '이동 단계', t: 'steps' },
      { k: 'totalMinutes', l: '예상 시간(분)', t: 'number', half: true },
      { k: 'totalCost', l: '예상 비용', t: 'text', half: true },
      { k: 'lastTrain', l: '막차 정보', t: 'text' },
      { k: 'caution', l: '주의사항', t: 'textarea' },
      { k: 'mapUrl', l: '지도 링크', t: 'url' },
      { k: 'imageUrl', l: '스크린샷 / 이미지', t: 'image' },
      { k: 'memo', l: '메모', t: 'textarea' }
    ]
  },

  expense: {
    list: 'expenses', title: '지출', action: 'Expense',
    fields: [
      { k: 'date', l: '날짜', t: 'date', req: true },
      { k: 'title', l: '내용', t: 'text', req: true },
      { k: 'amount', l: '금액', t: 'number', half: true },
      { k: 'currency', l: '통화', t: 'select', half: true, options: opt([CO.currency, 'KRW', 'USD']) },
      { k: 'category', l: '분류', t: 'select', options: opt(['식비', '교통', '입장료', '쇼핑', '숙박', '기타']) },
      { k: 'payer', l: '결제한 사람', t: 'text' },
      { k: 'memo', l: '메모', t: 'textarea' }
    ]
  },

  trip: {
    list: null, title: '여행 기본 정보', action: 'Trip',
    fields: [
      { k: 'tripName', l: '여행명', t: 'text' },
      { k: 'country', l: '국가', t: 'text', half: true },
      { k: 'city', l: '도시', t: 'text', half: true },
      { k: 'startDate', l: '시작일', t: 'date', half: true },
      { k: 'endDate', l: '종료일', t: 'date', half: true },
      { k: 'traveler1', l: '여행자 1 이름', t: 'text', half: true },
      { k: 'traveler2', l: '여행자 2 이름', t: 'text', half: true },
      { k: 'intro', l: '여행 소개', t: 'textarea' },
      { k: 'coverImage', l: '대표 이미지', t: 'image' },
      { k: 'currency', l: '통화', t: 'text', half: true },
      { k: 'timezone', l: '시간대', t: 'text', half: true },
      { k: 'emergencyContact', l: '긴급 연락처', t: 'textarea' }
    ]
  }
};

/* =========================================================================
 * 7. 폼 (바텀시트)
 * ========================================================================= */

let sheetState = { dirty: false, onClose: null, open: false };

function openSheet(title, bodyNodes, footNodes, opts) {
  opts = opts || {};
  $('#sheetTitle').textContent = title;
  mount($('#sheetBody'), bodyNodes);
  mount($('#sheetFoot'), footNodes || []);
  $('#sheetBackdrop').classList.remove('hidden');
  $('#sheetBody').scrollTop = 0;
  sheetState.dirty = false;
  sheetState.open = true;
  sheetState.confirmClose = !!opts.confirmClose;
  document.body.style.overflow = 'hidden';
  document.body.classList.add('sheet-open');
}

async function closeSheet(force) {
  if (!sheetState.open) return;
  if (!force && sheetState.confirmClose && sheetState.dirty) {
    const yes = await confirmBox('작성 중인 내용이 있습니다', '지금 닫으면 입력한 내용이 사라집니다.\n정말 닫을까요?', '닫기');
    if (!yes) return;
  }
  $('#sheetBackdrop').classList.add('hidden');
  sheetState.open = false;
  sheetState.dirty = false;
  document.body.style.overflow = '';
  document.body.classList.remove('sheet-open');
}

/** 필드 하나를 그립니다. values 객체에 값이 즉시 반영됩니다. */
function buildField(f, values, ctx) {
  const markDirty = () => { sheetState.dirty = true; };
  const id = 'f_' + f.k + '_' + Math.random().toString(36).slice(2, 7);
  const row = h('div', { class: 'form-row' + (f.half ? ' half' : '') });

  if (f.t !== 'check') {
    row.appendChild(h('label', { for: id, text: f.l + (f.req ? ' *' : '') }));
  }

  let input;
  const v = values[f.k] !== undefined && values[f.k] !== '' ? values[f.k] : (f.def || '');

  switch (f.t) {
    case 'textarea':
      input = h('textarea', { id: id, rows: 3, placeholder: f.ph || '' });
      input.value = v;
      if (f.ja) input.style.fontFamily = "'Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif";
      input.addEventListener('input', () => { values[f.k] = input.value; markDirty(); });
      row.appendChild(input);
      break;

    case 'select':
      input = h('select', { id: id });
      (f.options || []).forEach(o => {
        input.appendChild(h('option', { value: o.value, text: o.label }));
      });
      input.value = v;
      input.addEventListener('change', () => { values[f.k] = input.value; markDirty(); });
      values[f.k] = input.value;
      row.appendChild(input);
      break;

    case 'check': {
      const cb = h('input', { type: 'checkbox', id: id });
      cb.checked = truthy(values[f.k]);
      cb.addEventListener('change', () => { values[f.k] = cb.checked; markDirty(); });
      row.className = 'form-row';
      row.appendChild(h('div', { class: 'check-row' }, [cb, h('label', { for: id, text: f.l })]));
      break;
    }

    case 'rating': {
      const wrap = h('div', { class: 'seg' });
      const cur = String(values[f.k] || '');
      [1, 2, 3, 4, 5].forEach(n => {
        const b = h('button', {
          type: 'button',
          class: 'seg-btn' + (cur === String(n) ? ' on' : ''),
          text: '★'.repeat(n),
          onclick: () => {
            values[f.k] = String(n);
            $$('.seg-btn', wrap).forEach(x => x.classList.remove('on'));
            b.classList.add('on');
            markDirty();
          }
        });
        wrap.appendChild(b);
      });
      row.appendChild(wrap);
      break;
    }

    case 'image':
      row.appendChild(buildImageField(f, values, markDirty));
      break;

    case 'steps':
      row.appendChild(buildStepsField(f, values, markDirty));
      break;

    case 'reservationPick': {
      input = h('select', { id: id });
      input.appendChild(h('option', { value: '', text: '연결 안 함' }));
      S.reservations.forEach(r => {
        input.appendChild(h('option', { value: r.id, text: (r.date || '') + ' ' + (r.title || '') }));
      });
      input.value = v || '';
      input.addEventListener('change', () => { values[f.k] = input.value; markDirty(); });
      row.appendChild(input);
      break;
    }

    default: {
      const type = f.t === 'url' ? 'url' : (f.t === 'number' ? 'number' : f.t);
      input = h('input', { type: type, id: id, placeholder: f.ph || '' });
      if (f.t === 'number') input.setAttribute('inputmode', 'numeric');
      if (f.ja) input.style.fontFamily = "'Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif";
      input.value = v;
      input.addEventListener('input', () => { values[f.k] = input.value; markDirty(); });
      row.appendChild(input);
    }
  }

  if (f.hint) row.appendChild(h('div', { class: 'hint', text: f.hint }));
  return row;
}

/* ---------- 첨부 여러 장 다루기 ----------
 * 사진·파일 필드는 URL 을 줄바꿈으로 구분해 여러 개 저장합니다.
 * (시트 구조를 바꾸지 않고 한 칸에 여러 장을 담기 위한 방식이며,
 *  기존에 저장된 단일 URL 도 그대로 읽힙니다)
 */
function parseUrls(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v).split(/[\r\n]+/).map(x => x.trim()).filter(Boolean);
}
function joinUrls(list) { return (list || []).filter(Boolean).join('\n'); }
function firstUrl(v) { return parseUrls(v)[0] || ''; }
function isPdfUrl(url) { return /\.pdf(\?|$)/i.test(url) || String(url).indexOf('/preview') > 0; }

/** 사진 필드: 여러 장 업로드 / 직접 입력 / 개별 삭제 */
function buildImageField(f, values, markDirty) {
  const wrap = h('div');
  const gallery = h('div', { class: 'attach-grid' });
  const progress = h('div', { class: 'upload-progress hidden' }, h('i'));
  const progressText = h('div', { class: 'hint hidden' });

  const urlInput = h('input', { type: 'url', placeholder: '주소를 직접 붙여넣고 Enter (https://...)' });
  const fileInput = h('input', {
    type: 'file', accept: 'image/*,application/pdf', multiple: true, style: 'display:none'
  });

  const list = () => parseUrls(values[f.k]);
  const setList = arr => { values[f.k] = joinUrls(arr); markDirty(); draw(); };

  function draw() {
    clear(gallery);
    const urls = list();
    if (!urls.length) {
      gallery.appendChild(h('div', { class: 'photo-box', text: '아직 첨부한 파일이 없습니다. 여러 장을 한 번에 선택할 수 있습니다.' }));
      return;
    }
    urls.forEach((url, i) => {
      const cell = h('div', { class: 'attach-cell' });
      if (isPdfUrl(url)) {
        cell.appendChild(h('button', {
          type: 'button', class: 'attach-file', title: 'PDF 열기',
          onclick: () => openExternal(url)
        }, [mi('picture_as_pdf'), h('span', { class: 'tiny', text: 'PDF' })]));
      } else {
        cell.appendChild(h('img', {
          src: url, alt: f.l + ' ' + (i + 1), loading: 'lazy',
          onclick: () => openViewer(url, false),
          onerror: function () {
            this.replaceWith(h('div', { class: 'attach-file', title: '불러오기 실패' },
              [mi('broken_image'), h('span', { class: 'tiny', text: '실패' })]));
          }
        }));
      }
      cell.appendChild(h('button', {
        type: 'button', class: 'attach-del', 'aria-label': (i + 1) + '번째 첨부 삭제',
        onclick: () => { const a = list(); a.splice(i, 1); setList(a); }
      }, mi('close', 'mi-sm')));
      if (urls.length > 1) cell.appendChild(h('span', { class: 'attach-no', text: String(i + 1) }));
      gallery.appendChild(cell);
    });
  }

  /** 고른 파일들을 하나씩 올리고, 성공한 것부터 갤러리에 추가합니다 */
  fileInput.addEventListener('change', async () => {
    const files = Array.prototype.slice.call(fileInput.files || []);
    if (!files.length) return;
    progress.classList.remove('hidden');
    progressText.classList.remove('hidden');
    const bar = $('i', progress);
    let ok = 0, fail = 0;

    for (let i = 0; i < files.length; i++) {
      progressText.textContent = '올리는 중… (' + (i + 1) + ' / ' + files.length + ')';
      const base = i / files.length;
      try {
        const payload = await prepareUpload(files[i], pr => {
          bar.style.width = Math.round((base + pr * 0.7 / files.length) * 100) + '%';
        });
        payload.refType = f.k;
        payload.date = values.date || '';
        const data = await api('uploadImage', payload, { timeout: 60000, retry: 0 });
        S.photos.push(data.photo);
        setList(list().concat([data.photo.url]));
        ok++;
      } catch (err) {
        fail++;
        toast((files[i].name || '파일') + ' 업로드 실패: ' + describeError(err), 'error', 4200);
      }
      bar.style.width = Math.round(((i + 1) / files.length) * 100) + '%';
    }

    if (ok) toast(ok + '개를 올렸습니다.' + (fail ? ' (' + fail + '개 실패)' : ''), fail ? 'error' : 'ok');
    setTimeout(() => {
      progress.classList.add('hidden');
      progressText.classList.add('hidden');
      bar.style.width = '0';
    }, 600);
    fileInput.value = '';
  });

  urlInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = urlInput.value.trim();
    if (!/^https?:\/\//i.test(v)) { toast('http 로 시작하는 주소를 넣어주세요.', 'error'); return; }
    setList(list().concat([v]));
    urlInput.value = '';
  });

  wrap.appendChild(h('div', { class: 'row-wrap' }, [
    iconBtn('add_photo_alternate', '파일 선택 (여러 장)', 'btn btn-sm', () => fileInput.click()),
    iconBtn('collections', '올린 사진에서', 'btn btn-sm btn-ghost',
      () => pickExistingPhoto(url => setList(list().concat([url])), true))
  ]));
  wrap.appendChild(fileInput);
  wrap.appendChild(progress);
  wrap.appendChild(progressText);
  wrap.appendChild(h('div', { class: 'mt8' }, urlInput));
  wrap.appendChild(h('div', { class: 'mt8' }, gallery));
  draw();
  return wrap;
}

/**
 * 이미 올린 사진 중에서 고르기.
 * 작성 중인 폼(바텀시트)을 덮어쓰지 않도록 별도의 겹침창으로 띄웁니다.
 */
function pickExistingPhoto(onPick, keepOpen) {
  const photos = S.photos.slice().reverse();
  if (!photos.length) { toast('저장된 사진이 없습니다.', 'error'); return; }

  const grid = h('div', { class: 'photo-grid' });
  const box = h('div', {
    class: 'confirm-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': '사진 고르기',
    style: 'max-width:520px;max-height:80vh;overflow:auto'
  }, [
    h('h3', { text: '사진 고르기' }),
    grid,
    h('div', { class: 'confirm-actions' }, [
      h('button', { class: 'btn btn-ghost', text: '닫기', onclick: () => close() })
    ])
  ]);
  const back = h('div', { class: 'confirm-backdrop', style: 'z-index:92' }, box);

  function close() { if (back.parentNode) back.parentNode.removeChild(back); }
  back.addEventListener('click', e => { if (e.target === back) close(); });

  photos.forEach(p => {
    grid.appendChild(h('img', {
      src: p.url, alt: p.name || '사진', loading: 'lazy',
      // keepOpen 이면 창을 닫지 않아 여러 장을 이어서 고를 수 있습니다
      onclick: e => {
        onPick(p.url);
        if (keepOpen) { e.currentTarget.classList.add('picked'); toast('추가했습니다.', 'ok', 1000); }
        else close();
      }
    }));
  });
  document.body.appendChild(back);
}

/** 이동 단계 편집 (여러 개 추가 가능) */
function buildStepsField(f, values, markDirty) {
  let steps = [];
  try {
    const raw = values[f.k];
    steps = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    if (!Array.isArray(steps)) steps = [];
  } catch (e) { steps = []; }

  const list = h('div');
  function sync() {
    values[f.k] = JSON.stringify(steps);
    markDirty();
  }
  function draw() {
    clear(list);
    steps.forEach((st, i) => {
      const item = h('div', { class: 'step-item' });
      item.appendChild(h('div', { class: 'step-head' }, [
        h('span', { class: 'step-no', text: (i + 1) + '단계' }),
        h('span', { class: 'spacer' }),
        h('button', {
          type: 'button', class: 'btn btn-sm btn-ghost', text: '삭제',
          onclick: () => { steps.splice(i, 1); sync(); draw(); }
        })
      ]));
      const fields = [
        { k: 'line', l: '노선 / 수단', ph: '예: JR 지토세선(쾌속)' },
        { k: 'from', l: '승차역 / 출발', ph: '예: 삿포로역' },
        { k: 'to', l: '하차역 / 도착', ph: '예: 기타히로시마역' },
        { k: 'platform', l: '플랫폼', ph: '예: 5번' },
        { k: 'minutes', l: '소요(분)', ph: '20' },
        { k: 'cost', l: '비용', ph: '460엔' },
        { k: 'note', l: '환승 · 주의', ph: '' }
      ];
      const grid = h('div', { class: 'form-2col' });
      fields.forEach(sf => {
        const inp = h('input', { type: 'text', placeholder: sf.ph, 'aria-label': sf.l });
        inp.value = st[sf.k] || '';
        inp.addEventListener('input', () => { st[sf.k] = inp.value; sync(); });
        grid.appendChild(h('div', {}, [
          h('div', { class: 'hint', text: sf.l }), inp
        ]));
      });
      item.appendChild(grid);
      list.appendChild(item);
    });
    if (!steps.length) {
      list.appendChild(h('div', { class: 'photo-box', text: '아직 이동 단계가 없습니다. 아래 버튼으로 추가해 주세요.' }));
    }
  }
  draw();

  const wrap = h('div');
  wrap.appendChild(list);
  wrap.appendChild(h('button', {
    type: 'button', class: 'btn btn-sm mt8', text: '단계 추가',
    onclick: () => { steps.push({ type: 'train', line: '', from: '', to: '', platform: '', minutes: '', cost: '', note: '' }); sync(); draw(); }
  }));
  return wrap;
}

/**
 * 엔티티 편집 폼 열기
 * @param {string} entityKey ENTITIES 의 키
 * @param {object} record    수정할 데이터 (없으면 신규)
 * @param {object} preset    신규일 때 미리 채울 값
 */
function openEntityForm(entityKey, record, preset) {
  const def = ENTITIES[entityKey];
  if (!def) return;
  const isNew = !record || !record.id;
  const values = {};
  def.fields.forEach(f => {
    if (f.g) return;
    values[f.k] = record && record[f.k] !== undefined ? record[f.k] : '';
  });
  if (preset) Object.keys(preset).forEach(k => { values[k] = preset[k]; });
  if (record && record.id) values.id = record.id;

  const body = h('div');
  let pendingHalf = null;
  def.fields.forEach(f => {
    if (f.g) {
      if (pendingHalf) { body.appendChild(pendingHalf); pendingHalf = null; }
      body.appendChild(h('div', { class: 'form-group-title', text: f.g }));
      return;
    }
    const node = buildField(f, values, { entityKey: entityKey });
    if (f.half) {
      if (!pendingHalf) pendingHalf = h('div', { class: 'form-2col' });
      pendingHalf.appendChild(node);
      if (pendingHalf.childNodes.length === 2) { body.appendChild(pendingHalf); pendingHalf = null; }
    } else {
      if (pendingHalf) { body.appendChild(pendingHalf); pendingHalf = null; }
      body.appendChild(node);
    }
  });
  if (pendingHalf) body.appendChild(pendingHalf);

  if (record && record.updatedAt) {
    body.appendChild(h('p', { class: 'faint mt12', text: '마지막 수정: ' + (record.updatedBy || '') + ' · ' + fmtSyncTime(record.updatedAt) }));
  }

  const saveBtn = h('button', { class: 'btn btn-primary', text: isNew ? '저장' : '수정 저장' });
  const foot = [
    h('button', { class: 'btn btn-ghost', text: '취소', onclick: () => closeSheet(false) }),
    saveBtn
  ];
  if (!isNew && def.list) {
    foot.unshift(h('button', {
      class: 'btn btn-danger', style: 'flex:0 0 auto;padding-left:16px;padding-right:16px',
      text: '삭제', onclick: () => removeEntity(entityKey, record)
    }));
  }

  saveBtn.addEventListener('click', async () => {
    // 필수값 검사
    for (let i = 0; i < def.fields.length; i++) {
      const f = def.fields[i];
      if (f.req && !String(values[f.k] || '').trim()) {
        toast(f.l + '을(를) 입력해 주세요.', 'error');
        return;
      }
    }
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';
    try {
      await saveEntity(entityKey, values, record);
      await closeSheet(true);
    } catch (e) {
      // saveEntity 내부에서 안내 처리
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = isNew ? '저장' : '수정 저장';
    }
  });

  openSheet((isNew ? '새 ' : '') + def.title + (isNew ? ' 추가' : ' 수정'), body, foot, { confirmClose: true });
}

/** 저장 처리 (충돌 확인 · 임시 저장 포함) */
async function saveEntity(entityKey, values, original, force) {
  const def = ENTITIES[entityKey];

  // 일정: 출발 권장 시각 자동 계산
  if (entityKey === 'schedule' && !values.departBy && values.startTime && values.travelMinutes) {
    values.departBy = minusMinutes(values.startTime, values.travelMinutes);
  }
  if (entityKey === 'dailyRecord' && !values.author) values.author = S.me;

  if (entityKey === 'trip') {
    try {
      const data = await api('saveTrip', { trip: values });
      S.trip = data.trip || values;
      toast('여행 정보가 저장되었습니다.', 'ok');
      updateHeader();
      renderCurrentTab();
      return data.trip;
    } catch (err) {
      toast(describeError(err), 'error', 4000);
      throw err;
    }
  }

  const payload = {
    record: values,
    baseUpdatedAt: original && original.updatedAt ? original.updatedAt : '',
    force: !!force
  };

  try {
    const data = await api('save' + def.action, payload);
    upsertLocal(def.list, data.record);
    clearDraft(entityKey, values.id);
    toast('저장되었습니다.', 'ok');
    renderCurrentTab();
    silentRefresh();
    return data.record;
  } catch (err) {
    if (err.code === 'CONFLICT') {
      const serverRec = err.data && err.data.server;
      const who = serverRec && serverRec.updatedBy ? serverRec.updatedBy : '상대방';
      const yes = await confirmBox(
        '수정 충돌',
        who + '님이 먼저 이 항목을 수정했습니다.\n\n내 내용으로 덮어쓸까요?\n(취소하면 상대방이 저장한 최신 내용이 유지됩니다.)',
        '내 내용으로 저장'
      );
      if (yes) return saveEntity(entityKey, values, serverRec, true);
      if (serverRec) upsertLocal(def.list, serverRec);
      renderCurrentTab();
      throw err;
    }
    // 저장 실패 → 작성 내용을 잃지 않도록 임시 저장
    saveDraft(entityKey, values);
    toast(describeError(err) + '\n작성 내용은 이 기기에 임시 저장했습니다.', 'error', 5200);
    throw err;
  }
}

function upsertLocal(listName, record) {
  if (!listName || !record) return;
  const list = S[listName];
  if (!list) return;
  const idx = list.findIndex(x => String(x.id) === String(record.id));
  if (idx >= 0) list[idx] = record; else list.push(record);
}

async function removeEntity(entityKey, record) {
  const def = ENTITIES[entityKey];
  const yes = await confirmBox('삭제할까요?', '"' + (record.title || record.name || record.nameKo || record.ko || record.ja || def.title) + '"을(를) 삭제합니다.\n되돌릴 수 없습니다.', '삭제');
  if (!yes) return;
  try {
    await api('delete' + def.action, { id: record.id });
    S[def.list] = S[def.list].filter(x => String(x.id) !== String(record.id));
    toast('삭제되었습니다.', 'ok');
    await closeSheet(true);
    renderCurrentTab();
    silentRefresh();
  } catch (err) {
    toast(describeError(err), 'error', 4000);
  }
}

/* ---------- 오프라인 임시 저장 ---------- */
function draftKey() { return 'drafts'; }
function saveDraft(entityKey, values) {
  const drafts = lsGet(draftKey(), []);
  const key = entityKey + '|' + (values.id || 'new');
  const idx = drafts.findIndex(d => d.key === key);
  const item = { key: key, entityKey: entityKey, values: values, at: new Date().toISOString() };
  if (idx >= 0) drafts[idx] = item; else drafts.push(item);
  lsSet(draftKey(), drafts);
}
function clearDraft(entityKey, id) {
  const drafts = lsGet(draftKey(), []);
  const key = entityKey + '|' + (id || 'new');
  lsSet(draftKey(), drafts.filter(d => d.key !== key));
}
function draftCount() { return lsGet(draftKey(), []).length; }

function openDrafts() {
  const drafts = lsGet(draftKey(), []);
  const body = h('div');
  if (!drafts.length) {
    body.appendChild(emptyBox('임시 저장된 내용이 없습니다', '저장에 실패한 내용이 있으면 여기에 보관됩니다.', 'edit_note'));
  } else {
    body.appendChild(h('p', { class: 'faint mb8', text: '인터넷이 연결되면 [다시 저장]을 눌러 주세요.' }));
    drafts.forEach(d => {
      const def = ENTITIES[d.entityKey];
      const title = d.values.title || d.values.name || d.values.nameKo || d.values.oneLine || (def ? def.title : d.entityKey);
      body.appendChild(h('div', { class: 'list-item' }, [
        h('div', { class: 'li-title', text: title }),
        h('div', { class: 'li-sub', text: (def ? def.title : '') + ' · ' + fmtSyncTime(d.at) }),
        h('div', { class: 'li-actions' }, [
          h('button', {
            class: 'btn btn-sm btn-primary', text: '다시 저장',
            onclick: async () => {
              try {
                await saveEntity(d.entityKey, d.values, null, true);
                clearDraft(d.entityKey, d.values.id);
                openDrafts();
              } catch (e) { /* 안내는 saveEntity 에서 */ }
            }
          }),
          h('button', {
            class: 'btn btn-sm btn-ghost', text: '이어서 편집',
            onclick: () => { closeSheet(true); openEntityForm(d.entityKey, d.values.id ? d.values : null, d.values); }
          }),
          h('button', {
            class: 'btn btn-sm btn-ghost', text: '버리기',
            onclick: async () => {
              const yes = await confirmBox('임시 저장 삭제', '이 임시 내용을 버릴까요?', '버리기');
              if (!yes) return;
              clearDraft(d.entityKey, d.values.id);
              openDrafts();
            }
          })
        ])
      ]));
    });
  }
  openSheet('임시 저장 (' + drafts.length + ')', body,
    [h('button', { class: 'btn btn-ghost', text: '닫기', onclick: () => closeSheet(true) })]);
}

/* =========================================================================
 * 8. 사진 압축 · 업로드 준비
 * ========================================================================= */

/**
 * 파일을 읽어 캔버스로 압축하고 base64 로 만듭니다.
 * - 긴 변 최대 1600px
 * - 1MB 이하가 되도록 품질을 낮춰가며 재시도
 * - PDF 는 압축 없이 그대로 전송
 */
function prepareUpload(file, onProgress) {
  const U = CFG.UPLOAD_CONFIG;
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('파일이 없습니다.'));
    if (file.size > 20 * 1024 * 1024) return reject(new Error('파일이 너무 큽니다(20MB 초과).'));

    const isPdf = file.type === 'application/pdf';
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.onprogress = e => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total * 0.4); };

    reader.onload = () => {
      if (isPdf) {
        if (onProgress) onProgress(1);
        return resolve({
          base64: String(reader.result),
          mimeType: 'application/pdf',
          name: file.name || 'document.pdf'
        });
      }
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 열지 못했습니다.'));
      img.onload = () => {
        try {
          let w = img.naturalWidth, hgt = img.naturalHeight;
          const maxEdge = U.MAX_EDGE;
          if (Math.max(w, hgt) > maxEdge) {
            const r = maxEdge / Math.max(w, hgt);
            w = Math.round(w * r); hgt = Math.round(hgt * r);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = hgt;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, hgt);
          ctx.drawImage(img, 0, 0, w, hgt);

          // WebP 지원 여부 확인
          let mime = U.MIME;
          const webpTest = canvas.toDataURL('image/webp');
          if (webpTest.indexOf('data:image/webp') === 0) mime = 'image/webp';

          let q = U.QUALITY_START;
          let dataUrl = canvas.toDataURL(mime, q);
          while (dataUrl.length * 0.75 > U.TARGET_BYTES && q > U.QUALITY_MIN) {
            q -= 0.08;
            dataUrl = canvas.toDataURL(mime, q);
          }
          if (onProgress) onProgress(1);
          const ext = mime === 'image/webp' ? '.webp' : '.jpg';
          const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
          resolve({
            base64: dataUrl,
            mimeType: mime,
            name: base.substring(0, 60) + '_' + Date.now() + ext
          });
        } catch (e) { reject(new Error('이미지 압축에 실패했습니다.')); }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/* =========================================================================
 * BestOne in Japan - script.js  (Part 3/4: 오늘 · 일정 화면)
 * ========================================================================= */

/* ---------- 공통 렌더 도구 ---------- */

function kv(label, value, opts) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  opts = opts || {};
  const vNode = h('div', { class: 'kv-v' });
  if (opts.link) {
    vNode.appendChild(h('a', { href: opts.link, target: '_blank', rel: 'noopener noreferrer', text: String(value) }));
  } else {
    vNode.appendChild(document.createTextNode(String(value)));
  }
  if (opts.copy) {
    vNode.appendChild(h('button', {
      class: 'btn btn-sm btn-ghost', style: 'margin-left:8px;min-height:28px;padding:2px 10px',
      text: '복사', 'aria-label': label + ' 복사', onclick: () => copyText(value, label)
    }));
  }
  return h('div', { class: 'kv' }, [h('div', { class: 'kv-k', text: label }), vNode]);
}

function authorBadge(rec) {
  if (!rec || (!rec.createdBy && !rec.author)) return null;
  const who = rec.author || rec.createdBy;
  const mine = who === S.me;
  const m = memberInfo(who);
  return h('span', {
    class: 'badge ' + (mine ? 'badge-mine' : 'badge-partner'),
    text: m.emoji + ' ' + (mine ? '내가 작성' : who)
  });
}

function catBadge(key) {
  const c = catInfo(key);
  return h('span', { class: 'badge badge-cat', style: 'background:' + c.color },
    [mi(c.icon, 'mi-sm'), h('span', { text: c.label })]);
}

function sampleBadge(rec) {
  return truthy(rec.isSample) ? h('span', { class: 'badge badge-sample', text: '샘플' }) : null;
}

function linkBtn(label, url) {
  if (!url) return null;
  return h('button', { class: 'btn btn-sm btn-ghost', text: label, onclick: () => openExternal(url) });
}
function copyBtn(label, value) {
  if (!value) return null;
  return h('button', { class: 'btn btn-sm btn-ghost', text: label, onclick: () => copyText(value, label) });
}
function mapBtn(rec, queryFields) {
  const url = rec.mapUrl || (queryFields ? mapsSearchUrl(queryFields) : '');
  if (!url) return null;
  return iconBtn('map', '지도', 'btn btn-sm', () => openExternal(url));
}
function imgBtn(label, value) {
  const urls = parseUrls(value);
  if (!urls.length) return null;
  const text = urls.length > 1 ? label + ' ' + urls.length + '장' : label;
  return iconBtn(isPdfUrl(urls[0]) ? 'description' : 'image', text, 'btn btn-sm btn-star',
    () => (urls.length > 1 ? openGallery(urls, label) : (isPdfUrl(urls[0]) ? openExternal(urls[0]) : openViewer(urls[0], false))));
}

/**
 * 첨부 여러 장을 격자로 보여줍니다. (없으면 null)
 */
function attachGallery(value, alt) {
  const urls = parseUrls(value);
  if (!urls.length) return null;
  const grid = h('div', { class: 'attach-grid view-only' });
  urls.forEach((url, i) => {
    if (isPdfUrl(url)) {
      grid.appendChild(h('button', {
        type: 'button', class: 'attach-cell attach-file', onclick: () => openExternal(url)
      }, [mi('picture_as_pdf'), h('span', { class: 'tiny', text: 'PDF' })]));
    } else {
      grid.appendChild(h('div', { class: 'attach-cell' },
        h('img', {
          src: url, alt: (alt || '첨부') + ' ' + (i + 1), loading: 'lazy',
          onclick: () => openGallery(urls, alt, i),
          onerror: function () {
            // Drive 공유 설정 등으로 불러오지 못하면 링크 버튼으로 바꿉니다
            this.replaceWith(h('button', {
              type: 'button', class: 'attach-file', title: '새 탭에서 열기',
              onclick: () => openExternal(url)
            }, [mi('broken_image'), h('span', { class: 'tiny', text: '열기' })]));
          }
        })
      ));
    }
  });
  return grid;
}

/** 여러 장을 좌우로 넘겨보는 전체 화면 뷰어 */
function openGallery(urls, label, startIndex) {
  const list = parseUrls(urls);
  if (!list.length) return;
  let idx = Math.min(Math.max(startIndex || 0, 0), list.length - 1);
  const inner = $('#viewerInner');

  function draw() {
    clear(inner);
    const url = list[idx];
    if (isPdfUrl(url)) inner.appendChild(h('iframe', { src: url, title: (label || '문서') }));
    else inner.appendChild(h('img', { src: url, alt: (label || '사진') + ' ' + (idx + 1) }));

    if (list.length > 1) {
      inner.appendChild(h('div', { class: 'viewer-nav' }, [
        h('button', { class: 'icon-btn', 'aria-label': '이전', onclick: e => { e.stopPropagation(); idx = (idx - 1 + list.length) % list.length; draw(); } }, mi('chevron_left')),
        h('span', { class: 'viewer-count', text: (idx + 1) + ' / ' + list.length }),
        h('button', { class: 'icon-btn', 'aria-label': '다음', onclick: e => { e.stopPropagation(); idx = (idx + 1) % list.length; draw(); } }, mi('chevron_right'))
      ]));
    }
  }
  draw();
  $('#viewer').classList.remove('hidden');
}

/* =========================================================================
 * 9. 오늘 화면
 * ========================================================================= */

function todaySchedules(date) {
  const list = S.schedules.filter(s => s.date === date).slice().sort(sortByTime);
  const flightItems = S.flights.filter(f => f.date === date).map(f => ({
    id: 'flight-' + f.id, date: f.date, startTime: f.depTime, endTime: f.arrTime,
    category: 'flight', title: f.flightNo + ' ' + (f.depAirport || '') + ' → ' + (f.arrAirport || ''),
    place: (f.depAirport || '') + (f.depTerminal ? ' ' + f.depTerminal : ''),
    description: f.memo || '', _flight: f, _virtual: true
  }));
  // 이미 같은 편명의 일정이 있으면 중복 표시하지 않습니다.
  const titles = {};
  list.forEach(s => { titles[String(s.title || '').replace(/\s/g, '')] = 1; });
  const merged = list.concat(flightItems.filter(f => !titles[String(f.title).replace(/\s/g, '')]));
  return merged.sort(sortByTime);
}

function findNextSchedule() {
  const now = nowEpoch();
  const all = S.schedules.slice().concat(
    S.flights.map(f => ({
      date: f.date, startTime: f.depTime, title: f.flightNo + ' ' + (f.depAirport || '') + ' → ' + (f.arrAirport || ''),
      place: f.depAirport, category: 'flight', travelMinutes: '', departBy: '', _flight: f
    }))
  ).filter(s => s.date && !truthy(s.isDone));
  let best = null, bestT = Infinity;
  all.forEach(s => {
    const t = tokyoEpoch(s.date, s.startTime || '00:00');
    if (isNaN(t) || t < now) return;
    if (t < bestT) { bestT = t; best = s; }
  });
  return best ? { item: best, at: bestT } : null;
}

function quoteOfDay(date) {
  const q = CFG.DAILY_QUOTES;
  const p = String(date || todayStr()).split('-');
  const n = (Number(p[2]) || 1) + (Number(p[1]) || 1);
  return q[n % q.length];
}

function renderToday() {
  const view = $('#view-today');
  if (S.loading && !S.booted) { mount(view, skeletonList(4)); return; }

  const date = todayStr();
  const nodes = [];

  if (!navigator.onLine) {
    nodes.push(h('div', { class: 'offline-note', text: '오프라인 상태입니다. 마지막으로 불러온 자료를 보여줍니다.' }));
  }
  if (draftCount() > 0) {
    nodes.push(h('div', { class: 'draft-note' }, [
      document.createTextNode('저장하지 못한 내용이 ' + draftCount() + '건 있습니다. '),
      h('button', { class: 'btn btn-sm', style: 'margin-left:6px', text: '확인하기', onclick: openDrafts })
    ]));
  }

  /* ---- 히어로 ---- */
  const dates = tripDates();
  const dayIdx = dates.indexOf(date);
  let dday = '';
  if (S.trip.startDate) {
    const d = diffDays(date, S.trip.startDate);
    if (d > 0) dday = '여행 시작까지 D-' + d;
    else if (dayIdx >= 0) dday = '여행 ' + (dayIdx + 1) + '일차 / ' + dates.length + '일';
    else if (S.trip.endDate && diffDays(S.trip.endDate, date) > 0) dday = '여행이 끝났습니다. 기록을 정리해 보세요.';
  }
  nodes.push(h('div', { class: 'today-hero' }, [
    h('div', { class: 't-date', text: fmtDateFull(date) + ' · ' + CO.nameKo + ' 시간 ' + nowTimeStr() }),
    h('div', { class: 't-city', text: S.trip.city || S.trip.tripName || CO.nameKo }),
    h('div', { class: 't-quote', text: quoteOfDay(date) }),
    dday ? h('div', { class: 't-dday', text: dday }) : null
  ]));

  /* ---- 다음 일정 ---- */
  const next = findNextSchedule();
  if (next) {
    const it = next.item;
    const remain = next.at - nowEpoch();
    const departBy = it.departBy || (it.startTime && it.travelMinutes ? minusMinutes(it.startTime, it.travelMinutes) : '');
    nodes.push(h('div', { class: 'card next-card' }, [
      h('div', { class: 'row' }, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { class: 'next-label', text: '다음 일정' }),
          h('div', { class: 'next-title', text: it.title || '' }),
          h('div', { class: 'next-time', text: (it.date === date ? '오늘' : fmtDateKo(it.date, true)) + ' ' + (it.startTime || '') + (it.place ? ' · ' + it.place : '') })
        ]),
        h('div', { class: 'countdown', text: fmtRelative(remain) })
      ]),
      departBy ? h('div', { class: 'depart-hint', text: '출발 권장 시각 ' + departBy + (it.transport ? ' · ' + it.transport : '') + (it.travelMinutes ? ' (' + it.travelMinutes + '분 소요)' : '') }) : null,
      it.prepare ? h('div', { class: 'depart-hint', text: '준비물 ' + it.prepare }) : null
    ]));
  }

  /* ---- 오늘의 일정 ---- */
  const todays = todaySchedules(date);
  nodes.push(h('div', { class: 'section-head' }, [
    h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '오늘의 일정']),
    iconBtn('add', '추가', 'btn btn-sm', () => openEntityForm('schedule', null, { date: date }))
  ]));
  if (todays.length) {
    nodes.push(renderTimeline(todays));
  } else {
    nodes.push(emptyBox('오늘 등록된 일정이 없습니다', '자유롭게 걷는 날도 좋아요. 필요하면 일정을 추가해 보세요.', 'wb_sunny'));
  }

  /* ---- 오늘 사용할 예약 / 티켓 ---- */
  const todayRes = S.reservations.filter(r => r.date === date);
  if (todayRes.length) {
    nodes.push(h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '오늘 사용할 예약 · 티켓'])));
    todayRes.forEach(r => nodes.push(reservationCard(r, true)));
  }

  /* ---- 숙소 ---- */
  const stay = S.accommodations.filter(a => a.checkInDate <= date && date <= (a.checkOutDate || a.checkInDate));
  if (stay.length) {
    nodes.push(h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '오늘의 숙소'])));
    stay.forEach(a => nodes.push(accommodationCard(a, true)));
  }

  /* ---- 오늘의 이동 경로 ---- */
  if (S.routes.length) {
    const favs = S.routes.filter(r => truthy(r.favorite));
    const show = (favs.length ? favs : S.routes).slice(0, 3);
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '오늘의 이동 경로']),
      h('button', { class: 'btn btn-sm btn-ghost', text: '전체 보기', onclick: () => { switchTab('local'); S.localTab = 'route'; renderLocal(); } })
    ]));
    show.forEach(r => nodes.push(routeCard(r)));
  }

  /* ---- 오늘 자주 쓸 일본어 ---- */
  const favPhrases = S.japanesePhrases.filter(p => truthy(p.favorite));
  const showPhrases = (favPhrases.length ? favPhrases : S.japanesePhrases.filter(p => p.category === 'greeting')).slice(0, 5);
  if (showPhrases.length) {
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), favPhrases.length ? '즐겨찾는 일본어' : '오늘 자주 쓸 일본어']),
      h('button', { class: 'btn btn-sm btn-ghost', text: '더 보기', onclick: () => { switchTab('local'); S.localTab = 'phrase'; renderLocal(); } })
    ]));
    showPhrases.forEach(p => nodes.push(phraseCard(p)));
  }

  /* ---- 오늘의 기록 (두 사람 기록을 한 줄기로) ---- */
  const todayRecords = dayRecords(date);
  const myRec = todayRecords.filter(r => r._kind === 'daily' && r._author === S.me)[0];
  nodes.push(h('div', { class: 'section-head' }, [
    h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '오늘의 기록']),
    todayRecords.length
      ? h('button', { class: 'btn btn-sm btn-ghost', text: '모두 보기', onclick: () => { S.date = date; switchTab('record'); } })
      : null
  ].filter(Boolean)));

  nodes.push(h('div', { class: 'card' },
    h('button', {
      class: 'btn btn-primary btn-block',
      text: myRec ? '오늘의 기록 이어 쓰기' : '오늘의 기록 작성하기',
      onclick: () => { S.date = date; switchTab('record'); openRecordForm(date, myRec); }
    })
  ));

  if (todayRecords.length) {
    const feed = h('div', { class: 'record-feed' });
    todayRecords.forEach(r => feed.appendChild(recordCard(r)));
    nodes.push(feed);
  } else {
    nodes.push(h('p', { class: 'faint', style: 'text-align:center;padding:6px 0 2px', text: '아직 오늘의 기록이 없습니다. 먼저 한 줄 남겨보세요.' }));
  }

  /* ---- 긴급 연락처 ---- */
  nodes.push(h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '긴급 연락처'])));
  const emg = h('div', { class: 'card card-tight' });
  CO.emergency.forEach(e => {
    emg.appendChild(h('div', { class: 'kv' }, [
      h('div', { class: 'kv-k', text: e.label }),
      h('div', { class: 'kv-v' }, [
        document.createTextNode(e.value),
        h('button', {
          class: 'btn btn-sm btn-ghost', style: 'margin-left:8px;min-height:28px;padding:2px 10px',
          text: '복사', onclick: () => copyText(e.value, e.label)
        })
      ])
    ]));
  });
  if (S.trip.emergencyContact) {
    emg.appendChild(h('div', { class: 'kv' }, [
      h('div', { class: 'kv-k', text: '메모' }),
      h('div', { class: 'kv-v', text: S.trip.emergencyContact })
    ]));
  }
  nodes.push(emg);

  mount(view, nodes.filter(Boolean));
}

/* =========================================================================
 * 10. 일정 화면 (타임라인)
 * ========================================================================= */

function renderTimeline(items) {
  const tl = h('div', { class: 'timeline' });
  items.forEach(it => tl.appendChild(scheduleItem(it)));
  return tl;
}

function scheduleItem(it) {
  const done = truthy(it.isDone);
  const must = truthy(it.mustGo);
  const wrap = h('div', { class: 'tl-item' + (done ? ' done' : '') + (must ? ' must' : '') });
  wrap.appendChild(h('div', { class: 'tl-dot' }));

  const timeText = (it.startTime || '') + (it.endTime ? ' – ' + it.endTime : '');
  const card = h('div', { class: 'tl-card' });

  card.appendChild(h('div', { class: 'row' }, [
    h('div', { style: 'flex:1;min-width:0' }, [
      h('div', { class: 'tl-time', text: timeText || '시간 미정' }),
      h('div', { class: 'tl-title' }, [must ? mi('star', 'filled mi-sm') : null, h('span', { text: it.title || '' })].filter(Boolean)),
      it.place ? h('div', { class: 'tl-place', text: it.place }) : null
    ])
  ]));

  if (it.description) card.appendChild(h('div', { class: 'tl-desc', text: it.description }));

  const meta = h('div', { class: 'tl-meta' }, [
    catBadge(it.category),
    it.transport ? h('span', { class: 'badge', text: it.transport + (it.travelMinutes ? ' ' + it.travelMinutes + '분' : '') }) : null,
    it.departBy ? h('span', { class: 'badge', text: '출발 ' + it.departBy }) : null,
    it.prepare ? h('span', { class: 'badge', text: it.prepare }) : null,
    sampleBadge(it),
    it._virtual ? h('span', { class: 'badge', text: '항공 정보에서 자동 표시' }) : authorBadge(it)
  ].filter(Boolean));
  card.appendChild(meta);

  const actions = h('div', { class: 'tl-actions' });
  if (it._virtual) {
    actions.appendChild(h('button', {
      class: 'btn btn-sm btn-ghost', text: '항공 정보 보기',
      onclick: () => { switchTab('booking'); S.bookingTab = 'flight'; renderBooking(); }
    }));
  } else {
    actions.appendChild(h('button', {
      class: 'btn btn-sm' + (done ? ' btn-ghost' : ''),
      text: done ? '완료 취소' : '완료',
      onclick: () => toggleScheduleField(it, 'isDone')
    }));
    actions.appendChild(h('button', {
      class: 'btn btn-sm btn-ghost',
      text: must ? '꼭 가기 해제' : '꼭 가기',
      onclick: () => toggleScheduleField(it, 'mustGo')
    }));
    const mb = mapBtn(it, it.place || it.title);
    if (mb) actions.appendChild(mb);
    if (it.reservationId) {
      const res = byId(S.reservations, it.reservationId);
      if (res) actions.appendChild(iconBtn('confirmation_number', '예약 보기', 'btn btn-sm btn-ghost',
        () => openReservationDetail(res)));
    }
    actions.appendChild(h('button', {
      class: 'btn btn-sm btn-ghost', text: '수정',
      onclick: () => openEntityForm('schedule', it)
    }));
  }
  card.appendChild(actions);

  if (!it._virtual) card.appendChild(commentSection(it));

  wrap.appendChild(card);
  return wrap;
}

async function toggleScheduleField(item, field) {
  const values = Object.assign({}, item);
  values[field] = !truthy(item[field]);
  try {
    await saveEntity('schedule', values, item);
  } catch (e) { /* 안내는 saveEntity 에서 */ }
}

function commentSection(schedule) {
  const wrap = h('div', { class: 'comment-list' });
  const list = S.scheduleComments
    .filter(c => String(c.scheduleId) === String(schedule.id))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  if (!list.length) wrap.appendChild(h('div', { class: 'faint tiny', text: '아직 메모가 없습니다.' }));
  list.forEach(c => {
    const m = memberInfo(c.createdBy);
    wrap.appendChild(h('div', { class: 'comment' }, [
      h('span', { class: 'c-who', text: m.emoji + ' ' + (c.createdBy || '') }),
      h('span', { style: 'flex:1', text: c.text }),
      c.createdBy === S.me ? h('button', {
        class: 'c-del', text: '삭제', 'aria-label': '메모 삭제',
        onclick: async () => {
          const yes = await confirmBox('메모 삭제', '이 메모를 삭제할까요?', '삭제');
          if (!yes) return;
          try {
            await api('deleteScheduleComment', { id: c.id });
            S.scheduleComments = S.scheduleComments.filter(x => x.id !== c.id);
            renderCurrentTab();
            toast('삭제되었습니다.', 'ok');
          } catch (err) { toast(describeError(err), 'error'); }
        }
      }) : null
    ].filter(Boolean)));
  });

  const input = h('input', { type: 'text', placeholder: '짧은 메모 남기기', 'aria-label': '일정 메모 입력' });
  const btn = h('button', { class: 'btn btn-sm btn-primary', text: '등록' });
  btn.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      const data = await api('saveScheduleComment', { record: { scheduleId: schedule.id, text: text } });
      S.scheduleComments.push(data.record);
      input.value = '';
      renderCurrentTab();
    } catch (err) {
      toast(describeError(err), 'error', 4000);
    } finally { btn.disabled = false; }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
  wrap.appendChild(h('div', { class: 'comment-form' }, [input, btn]));
  return wrap;
}

function renderDateStrip(current, onPick) {
  const strip = h('div', { class: 'date-strip' });
  const dates = tripDates();
  const today = todayStr();
  dates.forEach(d => {
    const p = d.split('-');
    const dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    const cnt = S.schedules.filter(s => s.date === d).length + S.flights.filter(f => f.date === d).length;
    const chip = h('button', {
      type: 'button',
      class: 'date-chip' + (d === current ? ' active' : '') + (d === today ? ' today-mark' : ''),
      'aria-label': fmtDateFull(d),
      onclick: () => onPick(d)
    }, [
      h('div', { class: 'd-dow', text: DOW_KO[dt.getUTCDay()] }),
      h('div', { class: 'd-day', text: String(Number(p[2])) }),
      h('div', { class: 'd-mon', text: Number(p[1]) + '월' }),
      cnt ? h('div', { class: 'd-cnt', text: String(cnt) }) : null
    ].filter(Boolean));
    strip.appendChild(chip);
  });
  return strip;
}

function renderSchedule() {
  const view = $('#view-schedule');
  if (S.loading && !S.booted) { mount(view, skeletonList(4)); return; }
  ensureDefaultDates();
  const date = S.date;
  const nodes = [];

  nodes.push(searchBox('일정 검색 (제목 · 장소 · 설명)', S.filters.scheduleQ, v => { S.filters.scheduleQ = v; renderSchedule(); }));

  const sq = normQ(S.filters.scheduleQ);
  if (sq) {
    // 검색 중에는 날짜와 상관없이 전체 일정에서 찾습니다.
    const found = S.schedules
      .filter(x => matchQ(sq, [x.title, x.place, x.description, x.prepare, x.transport, catInfo(x.category).label]))
      .sort(sortByDateTime);
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '검색 결과 ' + found.length + '건']),
      h('button', { class: 'btn btn-sm btn-ghost', text: '검색 지우기', onclick: () => { S.filters.scheduleQ = ''; renderSchedule(); } })
    ]));
    if (found.length) {
      let lastDate = '';
      const wrap = h('div');
      found.forEach(x => {
        if (x.date !== lastDate) {
          lastDate = x.date;
          wrap.appendChild(h('div', { class: 'faint tiny', style: 'margin:12px 2px 4px;font-weight:700', text: fmtDateFull(x.date) }));
        }
        wrap.appendChild(renderTimeline([x]));
      });
      nodes.push(wrap);
    } else {
      nodes.push(emptyBox('검색 결과가 없습니다', '다른 낱말로 찾아보세요.', 'search'));
    }
    mount(view, nodes.filter(Boolean));
    view.appendChild(h('button', { class: 'fab', 'aria-label': '일정 추가', onclick: () => openEntityForm('schedule', null, { date: date }) }, mi('add', 'mi-lg')));
    return;
  }

  nodes.push(renderDateStrip(date, d => { S.date = d; renderSchedule(); }));

  nodes.push(h('div', { class: 'section-head' }, [
    h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), fmtDateFull(date)]),
    iconBtn('add', '일정 추가', 'btn btn-sm', () => openEntityForm('schedule', null, { date: date }))
  ]));

  const items = todaySchedules(date);
  if (items.length) nodes.push(renderTimeline(items));
  else nodes.push(emptyBox('이 날의 일정이 없습니다', '아래 + 버튼으로 첫 일정을 추가해 보세요.', 'calendar_month'));

  /* 숙소 안내 */
  const stay = S.accommodations.filter(a => a.checkInDate <= date && date <= (a.checkOutDate || a.checkInDate));
  if (stay.length) {
    nodes.push(h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '이 날의 숙소'])));
    stay.forEach(a => nodes.push(accommodationCard(a, true)));
  }

  /* 예약에서 일정으로 추가 */
  const resToday = S.reservations.filter(r => r.date === date);
  if (resToday.length) {
    nodes.push(h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '이 날의 예약'])));
    resToday.forEach(r => {
      const linked = S.schedules.some(s => String(s.reservationId) === String(r.id));
      nodes.push(h('div', { class: 'list-item' }, [
        h('div', { class: 'li-head' }, [
          h('div', { class: 'li-title', text: r.title || '' }),
          h('span', { class: 'badge', text: (CFG.RESERVATION_TYPES.filter(t => t.key === r.type)[0] || { label: '기타' }).label })
        ]),
        h('div', { class: 'li-sub', text: (r.startTime || '') + (r.place ? ' · ' + r.place : '') }),
        h('div', { class: 'li-actions' }, [
          h('button', { class: 'btn btn-sm btn-ghost', text: '자세히', onclick: () => openReservationDetail(r) }),
          linked
            ? h('span', { class: 'badge', text: '일정에 추가됨' })
            : iconBtn('add', '일정에 추가', 'btn btn-sm btn-primary', () => addReservationToSchedule(r))
        ])
      ]));
    });
  }

  mount(view, nodes.filter(Boolean));

  const fab = h('button', { class: 'fab', 'aria-label': '일정 추가', onclick: () => openEntityForm('schedule', null, { date: date }) }, mi('add', 'mi-lg'));
  view.appendChild(fab);
}

async function addReservationToSchedule(res) {
  try {
    showLoading('일정에 추가하는 중…');
    const data = await api('addReservationToSchedule', { reservationId: res.id });
    upsertLocal('schedules', data.record);
    toast('일정에 추가되었습니다.', 'ok');
    renderCurrentTab();
    silentRefresh();
  } catch (err) {
    toast(describeError(err), 'error', 4000);
  } finally { hideLoading(); }
}

/* =========================================================================
 * BestOne in Japan - script.js  (Part 4/4: 예약 · 현지 · 기록 · 시작)
 * ========================================================================= */

/* =========================================================================
 * 11. 예약 화면
 * ========================================================================= */

function flightCard(f) {
  return h('div', { class: 'list-item' }, [
    h('div', { class: 'li-head' }, [
      h('div', { class: 'li-title', text: (f.airline || '') + ' ' + (f.flightNo || '') }),
      sampleBadge(f)
    ].filter(Boolean)),
    h('div', { class: 'li-sub', text: fmtDateKo(f.date, true) }),
    h('div', { class: 'mt8' }, [
      kv('출발', (f.depAirport || '') + (f.depTerminal ? ' / ' + f.depTerminal : '') + (f.depTime ? ' · ' + f.depTime : '')),
      kv('도착', (f.arrAirport || '') + (f.arrTerminal ? ' / ' + f.arrTerminal : '') + (f.arrTime ? ' · ' + f.arrTime : '')),
      kv('좌석', f.seat),
      kv('수하물', f.baggage),
      kv('예약 번호', f.bookingNumber, { copy: true }),
      kv('메모', f.memo)
    ].filter(Boolean)),
    h('div', { class: 'li-actions' }, [
      imgBtn('탑승권 보기', f.ticketUrl),
      linkBtn('예약 사이트', f.bookingSite),
      h('button', { class: 'btn btn-sm btn-ghost', text: '수정', onclick: () => openEntityForm('flight', f) })
    ].filter(Boolean)),
    h('div', { class: 'row-wrap mt8' }, [authorBadge(f)].filter(Boolean))
  ]);
}

function accommodationCard(a, compact) {
  const nodes = [
    h('div', { class: 'li-head' }, [
      h('div', { class: 'li-title', text: (a.name || '') }),
      sampleBadge(a)
    ].filter(Boolean)),
    h('div', { class: 'li-sub', text: (a.checkInDate ? fmtDateKo(a.checkInDate) + ' ' + (a.checkInTime || '') : '') + ' → ' + (a.checkOutDate ? fmtDateKo(a.checkOutDate) + ' ' + (a.checkOutTime || '') : '') })
  ];
  if (!compact) {
    nodes.push(h('div', { class: 'mt8' }, [
      kv('일본어명', a.nameJa),
      kv('주소', a.address),
      kv('일본어 주소', a.addressJa),
      kv('가까운 역', a.nearestStation),
      kv('추천 출구', a.recommendedExit),
      kv('객실', a.roomType),
      kv('예약 번호', a.bookingNumber, { copy: true }),
      kv('조식', a.breakfast),
      kv('금연', a.nonSmoking),
      kv('짐 보관', a.luggageStorage),
      kv('전화', a.phone, { copy: true }),
      kv('메모', a.memo)
    ].filter(Boolean)));
  } else {
    nodes.push(h('div', { class: 'mt8' }, [
      kv('주소', a.address),
      kv('가까운 역', a.nearestStation ? a.nearestStation + (a.recommendedExit ? ' · ' + a.recommendedExit : '') : '')
    ].filter(Boolean)));
  }

  nodes.push(h('div', { class: 'li-actions' }, [
    mapBtn(a, a.nameJa || a.addressJa || a.name),
    a.addressJa ? iconBtn('local_taxi', '택시 기사에게 보여주기', 'btn btn-sm btn-star',
      () => openBigText(a.addressJa, (a.nameJa || a.name || '') + '\nまで お願いします')) : null,
    a.addressJa ? h('button', {
      class: 'btn btn-sm btn-ghost', text: '일본어 주소 크게 보기',
      onclick: () => openBigText(a.addressJa, a.nameJa || a.name || '')
    }) : null,
    copyBtn('예약 번호 복사', a.bookingNumber),
    imgBtn('예약 확인서', a.ticketUrl),
    linkBtn('공식 사이트', a.officialSite),
    linkBtn('예약 사이트', a.bookingSite),
    h('button', { class: 'btn btn-sm btn-ghost', text: '수정', onclick: () => openEntityForm('accommodation', a) })
  ].filter(Boolean)));

  return h('div', { class: 'list-item' }, nodes.filter(Boolean));
}

function reservationCard(r, compact) {
  const typeLabel = (CFG.RESERVATION_TYPES.filter(t => t.key === r.type)[0] || { label: '기타' }).label;
  return h('div', { class: 'list-item' }, [
    h('div', { class: 'li-head' }, [
      h('div', { class: 'li-title', text: (r.title || '') }),
      h('span', { class: 'badge', text: typeLabel }),
      sampleBadge(r)
    ].filter(Boolean)),
    h('div', { class: 'li-sub', text: (r.date ? fmtDateKo(r.date, true) : '') + (r.startTime ? ' ' + r.startTime : '') + (r.endTime ? '–' + r.endTime : '') + (r.place ? ' · ' + r.place : '') }),
    compact ? null : h('div', { class: 'mt8' }, [
      kv('집합 장소', r.meetingPoint),
      kv('인원', r.people),
      kv('예약 번호', r.bookingNumber, { copy: true }),
      kv('준비물', r.prepare)
    ].filter(Boolean)),
    h('div', { class: 'li-actions' }, [
      parseUrls(r.qrImageUrl).length ? iconBtn('qr_code_2', 'QR 크게 보기', 'btn btn-sm btn-star', () => openGallery(r.qrImageUrl, 'QR 코드')) : null,
      imgBtn('티켓', r.ticketUrl),
      mapBtn(r, r.place || r.title),
      h('button', { class: 'btn btn-sm btn-ghost', text: '자세히', onclick: () => openReservationDetail(r) })
    ].filter(Boolean))
  ].filter(Boolean));
}

function openReservationDetail(r) {
  const typeLabel = (CFG.RESERVATION_TYPES.filter(t => t.key === r.type)[0] || { label: '기타' }).label;
  const body = h('div');
  body.appendChild(h('div', { class: 'row-wrap mb8' }, [
    h('span', { class: 'badge', text: typeLabel }), sampleBadge(r), authorBadge(r)
  ].filter(Boolean)));

  { const g = attachGallery(r.qrImageUrl, 'QR 코드'); if (g) body.appendChild(g); }
  [
    ['날짜', r.date ? fmtDateFull(r.date) : ''],
    ['시간', (r.startTime || '') + (r.endTime ? ' – ' + r.endTime : '')],
    ['장소', r.place], ['집합 장소', r.meetingPoint], ['인원', r.people]
  ].forEach(p => { const n = kv(p[0], p[1]); if (n) body.appendChild(n); });
  const bn = kv('예약 번호', r.bookingNumber, { copy: true }); if (bn) body.appendChild(bn);
  [['준비물', r.prepare], ['취소 규정', r.cancelPolicy], ['이동 방법', r.transport], ['메모', r.memo]]
    .forEach(p => { const n = kv(p[0], p[1]); if (n) body.appendChild(n); });

  body.appendChild(h('div', { class: 'li-actions mt12' }, [
    imgBtn('티켓 크게 보기', r.ticketUrl),
    mapBtn(r, r.place || r.title),
    linkBtn('예약 사이트', r.bookingSite),
    linkBtn('공식 사이트', r.officialSite)
  ].filter(Boolean)));

  const alreadyLinked = S.schedules.some(s => String(s.reservationId) === String(r.id));
  openSheet(r.title || '예약', body, [
    h('button', { class: 'btn btn-ghost', text: '닫기', onclick: () => closeSheet(true) }),
    alreadyLinked ? null : h('button', {
      class: 'btn btn-star', text: '일정에 추가',
      onclick: async () => { await closeSheet(true); addReservationToSchedule(r); }
    }),
    h('button', { class: 'btn btn-primary', text: '수정', onclick: async () => { await closeSheet(true); openEntityForm('reservation', r); } })
  ].filter(Boolean));
}

function renderBooking() {
  const view = $('#view-booking');
  if (S.loading && !S.booted) { mount(view, skeletonList(3)); return; }
  const nodes = [];

  const tabs = [
    { k: 'flight', l: '항공' },
    { k: 'hotel', l: '숙소' },
    { k: 'ticket', l: '관광 · 티켓' }
  ];
  const bar = h('div', { class: 'subtabs' });
  tabs.forEach(t => {
    bar.appendChild(h('button', {
      class: 'subtab' + (S.bookingTab === t.k ? ' active' : ''),
      text: t.l, onclick: () => { S.bookingTab = t.k; renderBooking(); }
    }));
  });
  nodes.push(bar);
  nodes.push(searchBox('예약 검색 (이름 · 장소 · 예약 번호)', S.filters.bookingQ, v => { S.filters.bookingQ = v; renderBooking(); }));
  const bq = normQ(S.filters.bookingQ);

  if (S.bookingTab === 'flight') {
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '항공 정보']),
      iconBtn('add', '추가', 'btn btn-sm', () => openEntityForm('flight'))
    ]));
    const list = S.flights.slice()
      .filter(f => matchQ(bq, [f.flightNo, f.airline, f.depAirport, f.arrAirport, f.bookingNumber, f.seat, f.memo]))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (list.length) list.forEach(f => nodes.push(flightCard(f)));
    else nodes.push(emptyBox('등록된 항공편이 없습니다', '추가 버튼으로 항공 정보를 등록해 주세요.\n등록하면 날짜별 일정에도 자동으로 표시됩니다.', 'flight'));

  } else if (S.bookingTab === 'hotel') {
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '숙소 정보']),
      iconBtn('add', '추가', 'btn btn-sm', () => openEntityForm('accommodation'))
    ]));
    const list = S.accommodations.slice()
      .filter(a => matchQ(bq, [a.name, a.nameJa, a.address, a.addressJa, a.nearestStation, a.bookingNumber, a.memo]))
      .sort((a, b) => String(a.checkInDate).localeCompare(String(b.checkInDate)));
    if (list.length) list.forEach(a => nodes.push(accommodationCard(a, false)));
    else nodes.push(emptyBox('등록된 숙소가 없습니다', '체크인·체크아웃 시각과 일본어 주소를 넣어 두면 현지에서 편합니다.', 'hotel'));

  } else {
    const chips = h('div', { class: 'chips' });
    const all = [{ key: 'all', label: '전체' }].concat(CFG.RESERVATION_TYPES);
    all.forEach(t => {
      chips.appendChild(h('button', {
        class: 'chip' + (S.filters.bookingType === t.key ? ' active' : ''),
        text: t.label, onclick: () => { S.filters.bookingType = t.key; renderBooking(); }
      }));
    });
    nodes.push(chips);
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '예약 · 티켓']),
      iconBtn('add', '추가', 'btn btn-sm', () => openEntityForm('reservation'))
    ]));
    let list = S.reservations.slice()
      .filter(r => matchQ(bq, [r.title, r.place, r.meetingPoint, r.bookingNumber, r.memo, r.prepare]))
      .sort(sortByDateTime);
    if (S.filters.bookingType !== 'all') list = list.filter(r => r.type === S.filters.bookingType);
    if (list.length) list.forEach(r => nodes.push(reservationCard(r, false)));
    else nodes.push(emptyBox('등록된 예약이 없습니다', '관광·투어·공연·경기·열차·음식점 예약을 모아 둘 수 있습니다.', 'confirmation_number'));
  }

  mount(view, nodes.filter(Boolean));

  const addFn = S.bookingTab === 'flight' ? () => openEntityForm('flight')
    : S.bookingTab === 'hotel' ? () => openEntityForm('accommodation')
      : () => openEntityForm('reservation');
  view.appendChild(h('button', { class: 'fab', 'aria-label': '추가', onclick: addFn }, mi('add', 'mi-lg')));
}

/* =========================================================================
 * 12. 현지 화면
 * ========================================================================= */

function phraseCard(p) {
  const fav = truthy(p.favorite);
  return h('div', { class: 'ja-card' }, [
    h('div', { class: 'row' }, [
      h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { class: 'ja-ko', text: p.ko || '' }),
        h('div', { class: 'ja-ja', text: p.ja || '' }),
        p.reading ? h('div', { class: 'ja-read', text: p.reading }) : null
      ].filter(Boolean)),
      h('button', {
        class: 'star-btn' + (fav ? ' on' : ''), 'aria-label': fav ? '즐겨찾기 해제' : '즐겨찾기 추가',
        onclick: () => toggleFavorite('japanesePhrase', p)
      }, mi(fav ? 'star' : 'star_border', fav ? 'filled' : ''))
    ]),
    p.memo ? h('div', { class: 'faint mt8', text: p.memo }) : null,
    h('div', { class: 'ja-actions' }, [
      iconBtn('volume_up', '듣기', 'btn btn-sm', () => speakJa(p.ja)),
      h('button', { class: 'btn btn-sm btn-ghost', text: '복사', onclick: () => copyText(p.ja, '일본어 표현') }),
      h('button', { class: 'btn btn-sm btn-ghost', text: '크게 보기', onclick: () => openBigText(p.ja, p.ko + (p.reading ? '\n' + p.reading : '')) }),
      h('button', { class: 'btn btn-sm btn-ghost', text: '수정', onclick: () => openEntityForm('japanesePhrase', p) })
    ])
  ].filter(Boolean));
}

function wordCard(w) {
  const fav = truthy(w.favorite);
  return h('div', { class: 'word-card', onclick: e => { if (e.target.classList.contains('star-btn')) return; openBigText(w.ja, (w.reading || '') + '\n' + (w.ko || '')); } }, [
    h('button', {
      class: 'star-btn' + (fav ? ' on' : ''), 'aria-label': fav ? '즐겨찾기 해제' : '즐겨찾기 추가',
      onclick: e => { e.stopPropagation(); toggleFavorite('japaneseWord', w); }
    }, mi(fav ? 'star' : 'star_border', fav ? 'filled' : '')),
    h('div', { class: 'word-ja', text: w.ja || '' }),
    w.reading ? h('div', { class: 'word-read', text: w.reading }) : null,
    h('div', { class: 'word-ko', text: w.ko || '' })
  ].filter(Boolean));
}

async function toggleFavorite(entityKey, rec) {
  const values = Object.assign({}, rec, { favorite: !truthy(rec.favorite) });
  try { await saveEntity(entityKey, values, rec); }
  catch (e) { /* 안내는 saveEntity 에서 */ }
}

function stationCard(st) {
  const fav = truthy(st.favorite);
  return h('div', { class: 'list-item' }, [
    h('div', { class: 'li-head' }, [
      h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { class: 'li-title', text: (st.nameKo || '') + (st.stationNumber ? ' (' + st.stationNumber + ')' : '') }),
        h('div', { class: 'li-sub', style: "font-family:'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif", text: (st.nameJa || '') + (st.nameEn ? ' · ' + st.nameEn : '') }),
        st.lines ? h('div', { class: 'li-sub', text: st.lines }) : null
      ].filter(Boolean)),
      h('button', { class: 'star-btn' + (fav ? ' on' : ''), 'aria-label': '즐겨찾기', onclick: () => toggleFavorite('station', st) },
        mi(fav ? 'star' : 'star_border', fav ? 'filled' : ''))
    ]),
    h('div', { class: 'mt8' }, [
      kv('추천 출구', st.recommendedExit),
      kv('주요 출구', st.exits),
      kv('환승', st.transfers),
      kv('엘리베이터', st.elevator),
      kv('코인로커', st.coinLocker),
      kv('화장실', st.toilet),
      kv('숙소 관계', st.hotelRelation),
      kv('주변', st.nearby),
      kv('메모', st.memo)
    ].filter(Boolean)),
    attachGallery(st.photoUrl, st.nameKo + ' 사진'),
    h('div', { class: 'li-actions' }, [
      mapBtn(st, st.nameJa || st.nameKo),
      st.nameJa ? h('button', { class: 'btn btn-sm btn-star', text: '역명 크게 보기', onclick: () => openBigText(st.nameJa, st.nameKo) }) : null,
      copyBtn('역명 복사', st.nameJa || st.nameKo),
      linkBtn('공식 사이트', st.officialSite),
      h('button', { class: 'btn btn-sm btn-ghost', text: '수정', onclick: () => openEntityForm('station', st) })
    ].filter(Boolean)),
    h('div', { class: 'row-wrap mt8' }, [sampleBadge(st), authorBadge(st)].filter(Boolean))
  ].filter(Boolean));
}

function busCard(b) {
  return h('div', { class: 'list-item' }, [
    h('div', { class: 'li-head' }, [
      h('div', { class: 'li-title', text: (b.lineName || '') }),
      sampleBadge(b)
    ].filter(Boolean)),
    h('div', { class: 'li-sub', text: (b.city ? b.city + ' · ' : '') + (b.company || '') }),
    h('div', { class: 'li-sub mt8', text: (b.fromStop || '') + ' → ' + (b.toStop || '') }),
    (b.fromStopJa || b.toStopJa) ? h('div', {
      class: 'li-sub', style: "font-family:'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif",
      text: (b.fromStopJa || '') + ' → ' + (b.toStopJa || '')
    }) : null,
    h('div', { class: 'mt8' }, [
      kv('승차 위치', b.boardingPoint),
      kv('승차 방식', b.boardingDoor),
      kv('하차 방식', b.alightMethod),
      kv('교통카드', b.icCard),
      kv('정리권', b.needTicket),
      kv('요금 지불', b.paymentMethod),
      kv('예상 요금', b.fare),
      kv('소요 시간', b.durationMinutes ? b.durationMinutes + '분' : ''),
      kv('첫차 / 막차', (b.firstBus || '') + (b.lastBus ? ' / ' + b.lastBus : '')),
      kv('메모', b.memo)
    ].filter(Boolean)),
    attachGallery(b.photoUrl, '정류장 사진'),
    h('div', { class: 'li-actions' }, [
      mapBtn(b, b.fromStopJa || b.fromStop),
      b.toStopJa ? h('button', { class: 'btn btn-sm btn-star', text: '정류장 크게 보기', onclick: () => openBigText(b.toStopJa, b.toStop || '') }) : null,
      linkBtn('공식 사이트', b.officialSite),
      h('button', { class: 'btn btn-sm btn-ghost', text: '수정', onclick: () => openEntityForm('bus', b) })
    ].filter(Boolean))
  ].filter(Boolean));
}

function routeCard(r) {
  let steps = [];
  try { steps = r.steps ? JSON.parse(r.steps) : []; } catch (e) { steps = []; }
  const stepWrap = h('div', { class: 'timeline mt8' });
  steps.forEach((st, i) => {
    stepWrap.appendChild(h('div', { class: 'tl-item' }, [
      h('div', { class: 'tl-dot' }),
      h('div', { class: 'tl-card' }, [
        h('div', { class: 'tl-time', text: (i + 1) + '단계' + (st.minutes ? ' · ' + st.minutes + '분' : '') + (st.cost ? ' · ' + st.cost : '') }),
        h('div', { class: 'tl-title', style: 'font-size:.96rem', text: st.line || '' }),
        h('div', { class: 'tl-place', text: (st.from || '') + (st.to ? ' → ' + st.to : '') + (st.platform ? ' (' + st.platform + ')' : '') }),
        st.note ? h('div', { class: 'tl-desc', text: st.note }) : null
      ].filter(Boolean))
    ]));
  });

  return h('div', { class: 'list-item' }, [
    h('div', { class: 'li-head' }, [
      h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { class: 'li-title', text: (r.name || '') }),
        h('div', { class: 'li-sub', text: (r.totalMinutes ? '약 ' + r.totalMinutes + '분' : '') + (r.totalCost ? ' · ' + r.totalCost : '') })
      ]),
      h('button', { class: 'star-btn' + (truthy(r.favorite) ? ' on' : ''), 'aria-label': '즐겨찾기', onclick: () => toggleFavorite('route', r) },
        mi(truthy(r.favorite) ? 'star' : 'star_border', truthy(r.favorite) ? 'filled' : ''))
    ]),
    steps.length ? stepWrap : null,
    r.lastTrain ? h('div', { class: 'depart-hint', text: '막차 ' + r.lastTrain }) : null,
    r.caution ? h('div', { class: 'depart-hint', text: r.caution }) : null,
    attachGallery(r.imageUrl, '경로 이미지'),
    h('div', { class: 'li-actions' }, [
      mapBtn(r, (r.fromPlace || '') + ' ' + (r.toPlace || '')),
      h('button', { class: 'btn btn-sm btn-ghost', text: '수정', onclick: () => openEntityForm('route', r) })
    ].filter(Boolean))
  ].filter(Boolean));
}

function searchBox(placeholder, value, onInput) {
  const input = h('input', { type: 'search', placeholder: placeholder, 'aria-label': placeholder });
  input.value = value || '';
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => onInput(input.value), 220);
  });
  return h('div', { class: 'mb8' }, input);
}

function renderLocal() {
  const view = $('#view-local');
  if (S.loading && !S.booted) { mount(view, skeletonList(3)); return; }
  const nodes = [];

  const tabs = [
    { k: 'transit', l: '노선 · 길찾기' },
    { k: 'phrase', l: CO.localLabels.phrases },
    { k: 'word', l: CO.localLabels.words },
    { k: 'station', l: CO.localLabels.stations },
    { k: 'bus', l: CO.localLabels.buses },
    { k: 'route', l: CO.localLabels.routes }
  ];
  const bar = h('div', { class: 'subtabs' });
  tabs.forEach(t => {
    bar.appendChild(h('button', {
      class: 'subtab' + (S.localTab === t.k ? ' active' : ''),
      text: t.l, onclick: () => { S.localTab = t.k; renderLocal(); }
    }));
  });
  nodes.push(bar);

  if (S.localTab === 'transit') {
    renderTransit().forEach(n => nodes.push(n));

  } else if (S.localTab === 'phrase') {
    nodes.push(searchBox('표현 검색 (한국어 · 일본어 · 읽는 법)', S.filters.phraseQ, v => { S.filters.phraseQ = v; renderLocal(); }));
    const chips = h('div', { class: 'chips' });
    chips.appendChild(h('button', {
      class: 'chip' + (S.filters.phraseFav ? ' active' : ''), text: '즐겨찾기만',
      onclick: () => { S.filters.phraseFav = !S.filters.phraseFav; renderLocal(); }
    }));
    [{ key: 'all', label: '전체' }].concat(CFG.PHRASE_CATEGORIES).forEach(c => {
      chips.appendChild(h('button', {
        class: 'chip' + (S.filters.phraseCat === c.key ? ' active' : ''), text: c.label,
        onclick: () => { S.filters.phraseCat = c.key; renderLocal(); }
      }));
    });
    nodes.push(chips);

    const q = S.filters.phraseQ.trim().toLowerCase();
    let list = S.japanesePhrases.slice();
    if (S.filters.phraseCat !== 'all') list = list.filter(p => p.category === S.filters.phraseCat);
    if (S.filters.phraseFav) list = list.filter(p => truthy(p.favorite));
    if (q) list = list.filter(p => matchQ(normQ(q), [p.ko, p.ja, p.reading, p.memo]));
    list.sort((a, b) => (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999));

    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '표현 ' + list.length + '개']),
      iconBtn('add', '표현 추가', 'btn btn-sm', () => openEntityForm('japanesePhrase'))
    ]));
    if (list.length) list.forEach(p => nodes.push(phraseCard(p)));
    else nodes.push(emptyBox('표현이 없습니다', '검색어나 필터를 바꿔 보세요. Apps Script 에서 seedJapanData() 를 실행하면 기본 표현이 채워집니다.', 'chat_bubble'));

  } else if (S.localTab === 'word') {
    nodes.push(searchBox('단어 검색', S.filters.wordQ, v => { S.filters.wordQ = v; renderLocal(); }));
    const chips = h('div', { class: 'chips' });
    chips.appendChild(h('button', {
      class: 'chip' + (S.filters.wordFav ? ' active' : ''), text: '즐겨찾기만',
      onclick: () => { S.filters.wordFav = !S.filters.wordFav; renderLocal(); }
    }));
    [{ key: 'all', label: '전체' }].concat(CFG.WORD_CATEGORIES).forEach(c => {
      chips.appendChild(h('button', {
        class: 'chip' + (S.filters.wordCat === c.key ? ' active' : ''), text: c.label,
        onclick: () => { S.filters.wordCat = c.key; renderLocal(); }
      }));
    });
    nodes.push(chips);

    const q = S.filters.wordQ.trim().toLowerCase();
    let list = S.japaneseWords.slice();
    if (S.filters.wordCat !== 'all') list = list.filter(w => w.category === S.filters.wordCat);
    if (S.filters.wordFav) list = list.filter(w => truthy(w.favorite));
    if (q) list = list.filter(w => matchQ(normQ(q), [w.ko, w.ja, w.reading, w.memo]));
    list.sort((a, b) => (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999));

    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '단어 ' + list.length + '개']),
      iconBtn('add', '단어 추가', 'btn btn-sm', () => openEntityForm('japaneseWord'))
    ]));
    if (list.length) {
      const grid = h('div', { class: 'word-grid' });
      list.forEach(w => grid.appendChild(wordCard(w)));
      nodes.push(grid);
      nodes.push(h('p', { class: 'faint tiny mt8', text: '카드를 누르면 큰 글씨로 볼 수 있습니다.' }));
    } else {
      nodes.push(emptyBox('단어가 없습니다', 'seedJapanData() 를 실행하면 기본 단어가 채워집니다.', 'menu_book'));
    }

  } else if (S.localTab === 'station') {
    nodes.push(searchBox('역 검색 (한글 · 일본어 · 노선 · 도시)', S.filters.stationQ, v => { S.filters.stationQ = v; renderLocal(); }));
    const stq = normQ(S.filters.stationQ);
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '저장한 역']),
      iconBtn('add', '역 추가', 'btn btn-sm', () => openEntityForm('station'))
    ]));
    const list = S.stations.slice()
      .filter(st => matchQ(stq, [st.nameKo, st.nameJa, st.nameEn, st.lines, st.city, st.nearby, st.recommendedExit, st.memo]))
      .sort((a, b) => (truthy(b.favorite) ? 1 : 0) - (truthy(a.favorite) ? 1 : 0));
    if (list.length) list.forEach(st => nodes.push(stationCard(st)));
    else nodes.push(emptyBox('저장된 역이 없습니다', '여행에 필요한 역만 골라 저장해 두면 현지에서 빠르게 확인할 수 있습니다.', 'train'));
    nodes.push(externalLinkCard());

  } else if (S.localTab === 'bus') {
    nodes.push(searchBox('버스 검색 (노선 · 정류장 · 회사)', S.filters.busQ, v => { S.filters.busQ = v; renderLocal(); }));
    const bsq = normQ(S.filters.busQ);
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '버스 정보']),
      iconBtn('add', '버스 추가', 'btn btn-sm', () => openEntityForm('bus'))
    ]));
    const buses = S.buses.filter(b => matchQ(bsq, [b.lineName, b.company, b.city, b.fromStop, b.toStop, b.fromStopJa, b.toStopJa, b.memo]));
    if (buses.length) buses.forEach(b => nodes.push(busCard(b)));
    else nodes.push(emptyBox('저장된 버스 정보가 없습니다', '지역마다 타는 방법이 다릅니다. 미리 적어 두면 든든합니다.', 'directions_bus'));
    nodes.push(busGuideCard());

  } else {
    nodes.push(searchBox('경로 검색 (경로명 · 출발지 · 도착지)', S.filters.routeQ, v => { S.filters.routeQ = v; renderLocal(); }));
    const rq = normQ(S.filters.routeQ);
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '이동 경로']),
      iconBtn('add', '경로 추가', 'btn btn-sm', () => openEntityForm('route'))
    ]));
    const list = S.routes.slice()
      .filter(r => matchQ(rq, [r.name, r.fromPlace, r.toPlace, r.caution, r.memo, r.steps]))
      .sort((a, b) => (truthy(b.favorite) ? 1 : 0) - (truthy(a.favorite) ? 1 : 0));
    if (list.length) list.forEach(r => nodes.push(routeCard(r)));
    else nodes.push(emptyBox('저장된 경로가 없습니다', '예: 삿포로역 → 기타히로시마역 → 에스콘필드', 'explore'));
  }

  mount(view, nodes.filter(Boolean));

  const addMap = {
    phrase: 'japanesePhrase', word: 'japaneseWord', station: 'station', bus: 'bus', route: 'route'
  };
  if (addMap[S.localTab]) {
    view.appendChild(h('button', {
      class: 'fab', 'aria-label': '추가',
      onclick: () => openEntityForm(addMap[S.localTab])
    }, mi('add', 'mi-lg')));
  }
}

/**
 * 지역별 버스 타는 방법 안내.
 * 시각표·요금은 자주 바뀌므로 담지 않고, 이용 방식과 공식 사이트만 정리합니다.
 */
const BUS_GUIDE = [
  {
    city: '도쿄', color: '#4a6fa5',
    rows: [
      ['승차', '앞문으로 타고 바로 요금을 냅니다 (선불)'],
      ['요금', '도영·민영버스 대부분 구간 상관없이 균일 요금'],
      ['교통카드', 'Suica · PASMO 등 IC카드를 단말기에 터치'],
      ['정리권', '필요 없습니다 (균일 요금 구간)'],
      ['하차', '내릴 정류장 전에 벨을 누르고 뒷문으로 내립니다']
    ],
    links: [
      { label: '도영버스 공식', url: 'https://www.kotsu.metro.tokyo.jp/bus/' },
      { label: '도쿄 도영 노선 안내', url: 'https://tobus.jp/' }
    ]
  },
  {
    city: '삿포로 · 홋카이도', color: '#2f6f4f',
    rows: [
      ['승차', '뒷문(중간문)으로 타면서 정리권을 뽑습니다'],
      ['요금', '탄 거리에 따라 올라갑니다 (거리 비례)'],
      ['교통카드', 'Kitaca · Suica 등 사용 가능 (탈 때와 내릴 때 각각 터치)'],
      ['정리권', '현금으로 낼 때 반드시 필요합니다'],
      ['하차', '앞쪽 요금함에 정리권과 요금을 함께 넣고 앞문으로 내립니다'],
      ['잔돈', '차내 요금함의 환전기에서 미리 바꿔 두세요 (1만엔권 불가)']
    ],
    links: [
      { label: '홋카이도 중앙버스', url: 'https://www.chuo-bus.co.jp/' },
      { label: '조테츠버스', url: 'https://www.jotetsu.co.jp/bus/' },
      { label: '삿포로 시영교통(지하철·시전)', url: 'https://www.city.sapporo.jp/st/' }
    ]
  }
];

function busGuideCard() {
  const wrap = h('div');
  wrap.appendChild(h('div', { class: 'section-head' },
    h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '버스 타는 법'])));

  BUS_GUIDE.forEach(g => {
    const card = h('div', { class: 'card card-tight' });
    card.appendChild(h('div', { class: 'row mb8' }, [
      h('span', { class: 'line-chip', style: 'background:' + g.color, text: g.city })
    ]));
    g.rows.forEach(r => { const n = kv(r[0], r[1]); if (n) card.appendChild(n); });
    const links = h('div', { class: 'row-wrap mt8' });
    g.links.forEach(l => links.appendChild(
      iconBtn('open_in_new', l.label, 'btn btn-sm btn-ghost', () => openExternal(l.url))));
    card.appendChild(links);
    wrap.appendChild(card);
  });

  wrap.appendChild(h('p', { class: 'faint tiny mt8' },
    '노선별 시각표와 요금은 자주 바뀌므로 앱에 담지 않았습니다. ' +
    '위 공식 사이트나 구글 지도에서 확인한 내용을 아래에 직접 저장해 두세요.'));
  return wrap;
}

function externalLinkCard() {
  const card = h('div', { class: 'card card-tight' }, [
    h('div', { class: 'faint mb8', text: '실시간 운행 정보는 공식 사이트에서 확인해 주세요.' })
  ]);
  const row = h('div', { class: 'row-wrap' });
  CO.externalLinks.forEach(l => {
    row.appendChild(h('button', { class: 'btn btn-sm btn-ghost', text: l.label, onclick: () => openExternal(l.url) }));
  });
  card.appendChild(row);
  return card;
}

/* =========================================================================
 * 12-2. 노선도 · 길찾기 (오픈 데이터 기반)
 * -------------------------------------------------------------------------
 * data/transit.js 의 노선·역 자료로 환승 경로를 계산합니다.
 * 실시간 운행/요금은 담고 있지 않으므로, 결과 화면에서 구글 지도와
 * 공식 사이트로 이어지는 버튼을 함께 제공합니다.
 * ========================================================================= */

const RIDE_MIN = 2;       // 역과 역 사이 평균 소요(분) - 추정치
const TRANSFER_MIN = 5;   // 환승 1회 평균 소요(분) - 추정치

/** 도시별 그래프 캐시 */
const TRANSIT = { graphs: {} };

function transitCities() {
  return (window.TRANSIT_DATA && window.TRANSIT_DATA.cities) || [];
}
function transitCity(key) {
  return transitCities().filter(c => c.key === key)[0] || transitCities()[0] || null;
}

/** 같은 역으로 볼 이름 정리 (전각 숫자·공백·기호 차이 흡수) */
function stationKey(name) {
  return String(name || '')
    .replace(/[\s・･·、,]/g, '')
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}

/**
 * 이름은 같지만 실제로는 떨어져 있어 환승역이 아닌 곳.
 * (사업자가 다를 때만 걸어서 이동하는 시간으로 계산합니다)
 * 예) 삿포로의 지하철 白石역과 JR 白石역은 1km 넘게 떨어져 있습니다.
 */
const WALK_ONLY_STATIONS = { '白石': 15, '琴似': 12, '菊水': 14 };

/** 이름이 달라도 환승으로 이어지는 역들 */
const EXTRA_TRANSFERS = [
  ['大手町', '東京'], ['国会議事堂前', '溜池山王'], ['有楽町', '日比谷'], ['有楽町', '銀座'],
  ['日比谷', '銀座'], ['三越前', '新日本橋'], ['馬喰横山', '東日本橋'], ['馬喰横山', '馬喰町'],
  ['東日本橋', '馬喰町'], ['秋葉原', '岩本町'], ['春日', '後楽園'], ['淡路町', '小川町'],
  ['淡路町', '新御茶ノ水'], ['小川町', '新御茶ノ水'], ['築地', '新富町'], ['八丁堀', '京橋'],
  ['新宿', '新宿西口'], ['新宿', '新宿三丁目'], ['上野広小路', '上野御徒町'],
  ['上野広小路', '御徒町'], ['仲御徒町', '御徒町'], ['湯島', '上野広小路'],
  ['原宿', '明治神宮前'],
  // 삿포로 : 지하철은 히라가나, JR 은 한자로 적혀 이름이 다릅니다
  ['さっぽろ', '札幌'], ['新さっぽろ', '新札幌'], ['すすきの', '豊水すすきの']
];

/**
 * 도시의 노선 자료로 환승 그래프를 만듭니다.
 * 노드 = (노선, 역 순번). 간선 = 이웃 역(승차) + 같은 역(환승).
 */
function buildTransitGraph(cityKey) {
  if (TRANSIT.graphs[cityKey]) return TRANSIT.graphs[cityKey];
  const city = transitCity(cityKey);
  if (!city) return null;

  const nodes = [];                 // { line, li, si, name, ko }
  const adj = [];                   // [{ to, w, type }]
  const byStation = {};             // 역이름키 -> [노드번호]

  city.lines.forEach((line, li) => {
    const base = nodes.length;
    line.stations.forEach((s, si) => {
      const id = nodes.length;
      nodes.push({ li: li, si: si, ko: s.ko, ja: s.ja, code: s.c || '', g: s.g || null });
      adj.push([]);
      const k = stationKey(s.ja || s.ko);
      (byStation[k] = byStation[k] || []).push(id);
    });
    // 승차 간선 (양방향)
    for (let i = 0; i + 1 < line.stations.length; i++) {
      const a = base + i, b = base + i + 1;
      adj[a].push({ to: b, w: RIDE_MIN, type: 'ride' });
      adj[b].push({ to: a, w: RIDE_MIN, type: 'ride' });
    }
    // 순환선은 끝과 처음을 이어줍니다
    if (line.loop && line.stations.length > 2) {
      const a = base + line.stations.length - 1, b = base;
      adj[a].push({ to: b, w: RIDE_MIN, type: 'ride' });
      adj[b].push({ to: a, w: RIDE_MIN, type: 'ride' });
    }
  });

  // 환승 간선 : 같은 이름의 역끼리
  function linkGroup(ids) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = nodes[ids[i]], b = nodes[ids[j]];
        if (a.li === b.li) continue;
        const la = city.lines[a.li], lb = city.lines[b.li];
        // 이름만 같고 실제로는 떨어져 있는 역이면 도보 이동 시간으로 계산
        const walk = WALK_ONLY_STATIONS[a.ja];
        const w = (walk && la.op !== lb.op) ? walk : TRANSFER_MIN;
        adj[ids[i]].push({ to: ids[j], w: w, type: 'transfer' });
        adj[ids[j]].push({ to: ids[i], w: w, type: 'transfer' });
      }
    }
  }
  Object.keys(byStation).forEach(k => linkGroup(byStation[k]));

  // 이름이 다른 도보 환승
  EXTRA_TRANSFERS.forEach(pair => {
    const a = byStation[stationKey(pair[0])] || [];
    const b = byStation[stationKey(pair[1])] || [];
    a.forEach(x => b.forEach(y => {
      if (nodes[x].li === nodes[y].li) return;
      adj[x].push({ to: y, w: TRANSFER_MIN + 3, type: 'transfer' });
      adj[y].push({ to: x, w: TRANSFER_MIN + 3, type: 'transfer' });
    }));
  });

  const g = { city: city, nodes: nodes, adj: adj, byStation: byStation };
  TRANSIT.graphs[cityKey] = g;
  return g;
}

/** 역 이름으로 검색 (한국어 · 일본어 · 역번호) */
function searchStations(cityKey, query, limit) {
  const g = buildTransitGraph(cityKey);
  if (!g) return [];
  const q = normQ(query);
  if (!q) return [];
  const seen = {};
  const out = [];
  for (let i = 0; i < g.nodes.length; i++) {
    const n = g.nodes[i];
    const k = stationKey(n.ja || n.ko);
    if (seen[k]) continue;
    if (!matchQ(q, [n.ko, n.ja, n.code])) continue;
    seen[k] = 1;
    // 완전히 같은 이름 > 앞부분 일치 > 그 밖의 순서로 보여줍니다
    const ko = normQ(n.ko), ja = normQ(n.ja);
    const rank = (ko === q || ja === q) ? 0 : (ko.indexOf(q) === 0 || ja.indexOf(q) === 0) ? 1 : 2;
    const lines = (g.byStation[k] || []).map(id => g.city.lines[g.nodes[id].li]);
    out.push({ key: k, ko: n.ko, ja: n.ja, lines: lines, nodeIds: g.byStation[k] || [], rank: rank });
  }
  out.sort((a, b) => a.rank - b.rank || a.ko.length - b.ko.length);
  return out.slice(0, limit || 12);
}

/**
 * 환승 경로 찾기 (다익스트라).
 * 같은 이름의 역은 어느 노선에서 출발/도착해도 되도록 모두 시작·도착점으로 둡니다.
 */
function findTransitRoute(cityKey, fromKey, toKey) {
  const g = buildTransitGraph(cityKey);
  if (!g) return null;
  const starts = g.byStation[fromKey] || [];
  const goals = {};
  (g.byStation[toKey] || []).forEach(id => { goals[id] = 1; });
  if (!starts.length || !Object.keys(goals).length) return null;

  const N = g.nodes.length;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const prevType = new Array(N).fill('');

  // 간단한 이진 힙
  const heap = [];
  function push(node, d) {
    heap.push([d, node]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
    }
  }
  function pop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
      }
    }
    return top;
  }

  starts.forEach(id => { dist[id] = 0; push(id, 0); });

  let goal = -1;
  while (heap.length) {
    const cur = pop();
    const d = cur[0], u = cur[1];
    if (d > dist[u]) continue;
    if (goals[u]) { goal = u; break; }
    const edges = g.adj[u];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const nd = d + e.w;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
        prevType[e.to] = e.type;
        push(e.to, nd);
      }
    }
  }
  if (goal < 0) return null;

  // 경로 되짚기
  const path = [];
  for (let v = goal; v >= 0; v = prev[v]) path.push(v);
  path.reverse();

  // 같은 노선 구간끼리 묶어 '구간(leg)' 으로 만듭니다
  const legs = [];
  let i = 0;
  while (i < path.length - 1) {
    if (prevType[path[i + 1]] === 'transfer') { i++; continue; }
    const li = g.nodes[path[i]].li;
    let j = i;
    while (j + 1 < path.length && prevType[path[j + 1]] === 'ride' && g.nodes[path[j + 1]].li === li) j++;
    if (j > i) {
      const line = g.city.lines[li];
      const fromN = g.nodes[path[i]], toN = g.nodes[path[j]];
      const stops = [];
      for (let k = i; k <= j; k++) stops.push(g.nodes[path[k]]);
      // 진행 방향 안내
      let heading;
      if (line.loop) {
        heading = g.nodes[path[i + 1]].ko + ' 방면';
      } else {
        const forward = toN.si > fromN.si;
        const term = forward ? line.stations[line.stations.length - 1] : line.stations[0];
        heading = term.ko + ' 방면';
      }
      legs.push({
        line: line, from: fromN, to: toN, stops: stops,
        count: j - i, minutes: (j - i) * RIDE_MIN, heading: heading
      });
    }
    i = j + 1 <= path.length - 1 ? j : j + 1;
    if (j === i) i++;
  }

  const transfers = Math.max(0, legs.length - 1);
  const rideMin = legs.reduce((a, l) => a + l.minutes, 0);
  return {
    legs: legs,
    transfers: transfers,
    minutes: rideMin + transfers * TRANSFER_MIN,
    rideMinutes: rideMin,
    from: g.byStation[fromKey] ? g.nodes[g.byStation[fromKey][0]] : null,
    to: g.byStation[toKey] ? g.nodes[g.byStation[toKey][0]] : null
  };
}

/* ---------- 화면 ---------- */

/** 역 선택 입력칸 (검색해서 고르기) */
function stationPicker(labelText, cityKey, current, onPick) {
  const box = h('div', { class: 'form-row' });
  box.appendChild(h('label', { text: labelText }));

  const input = h('input', { type: 'search', placeholder: '역 이름 (한국어 · 일본어)', 'aria-label': labelText });
  if (current) input.value = current.ko + ' ' + (current.ja || '');
  const results = h('div', { class: 'station-results hidden' });

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const list = searchStations(cityKey, input.value, 10);
      clear(results);
      if (!input.value.trim() || !list.length) { results.classList.add('hidden'); return; }
      results.classList.remove('hidden');
      list.forEach(s => {
        results.appendChild(h('button', {
          type: 'button', class: 'station-opt',
          onclick: () => {
            input.value = s.ko;
            results.classList.add('hidden');
            onPick(s);
          }
        }, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div', { class: 'station-opt-ko', text: s.ko }),
            h('div', { class: 'station-opt-ja', text: s.ja })
          ]),
          h('div', { class: 'line-dots' }, s.lines.slice(0, 5).map(l =>
            h('span', { class: 'line-dot', style: 'background:' + l.color, title: l.ko })))
        ]));
      });
    }, 160);
  });
  input.addEventListener('focus', () => { if (results.childNodes.length) results.classList.remove('hidden'); });

  box.appendChild(input);
  box.appendChild(results);
  return box;
}

/** 경로 결과 카드 */
function routeResultCard(cityKey, result, fromName, toName) {
  if (!result) {
    return emptyBox('경로를 찾지 못했습니다',
      '두 역이 서로 다른 도시이거나, 이 앱에 담긴 노선만으로는 이어지지 않을 수 있습니다.\n구글 지도에서 확인해 보세요.', 'wrong_location');
  }
  const card = h('div', { class: 'card' });

  card.appendChild(h('div', { class: 'row mb8' }, [
    h('div', { style: 'flex:1;min-width:0' }, [
      h('div', { class: 'next-label', text: '예상 소요' }),
      h('div', { style: 'font-size:1.4rem;font-weight:800', text: '약 ' + result.minutes + '분' }),
      h('div', { class: 'faint tiny', text: '환승 ' + result.transfers + '회 · 정차 ' + result.legs.reduce((a, l) => a + l.count, 0) + '개 역' })
    ]),
    mi('directions_transit', 'mi-lg')
  ]));

  const tl = h('div', { class: 'route-legs' });
  result.legs.forEach((leg, i) => {
    if (i > 0) {
      tl.appendChild(h('div', { class: 'route-transfer' }, [
        mi('transfer_within_a_station', 'mi-sm'),
        h('span', { text: leg.from.ko + '에서 환승 (약 ' + TRANSFER_MIN + '분)' })
      ]));
    }
    tl.appendChild(h('div', { class: 'route-leg' }, [
      h('span', { class: 'route-bar', style: 'background:' + leg.line.color }),
      h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { class: 'route-line-name' }, [
          h('span', { class: 'line-chip', style: 'background:' + leg.line.color, text: leg.line.ko }),
          h('span', { class: 'faint tiny', text: leg.heading })
        ]),
        h('div', { class: 'route-station', text: leg.from.ko + (leg.from.code ? ' (' + leg.from.code + ')' : '') }),
        h('div', { class: 'route-mid', text: leg.count + '개 역 · 약 ' + leg.minutes + '분' }),
        h('div', { class: 'route-station', text: leg.to.ko + (leg.to.code ? ' (' + leg.to.code + ')' : '') })
      ])
    ]));
  });
  card.appendChild(tl);

  card.appendChild(h('p', { class: 'faint tiny mt8' },
    '소요 시간은 역 1개당 ' + RIDE_MIN + '분, 환승 1회당 ' + TRANSFER_MIN + '분으로 계산한 추정치입니다. ' +
    '실제 시각표 · 요금 · 지연 정보는 구글 지도나 공식 사이트에서 확인해 주세요.'));

  card.appendChild(h('div', { class: 'li-actions' }, [
    iconBtn('map', '구글 지도에서 보기', 'btn btn-sm btn-primary', () => {
      const url = 'https://www.google.com/maps/dir/?api=1' +
        '&origin=' + encodeURIComponent((result.from ? result.from.ja : fromName) + ' 駅') +
        '&destination=' + encodeURIComponent((result.to ? result.to.ja : toName) + ' 駅') +
        '&travelmode=transit';
      openExternal(url);
    }),
    iconBtn('bookmark_add', '이동 경로로 저장', 'btn btn-sm', () => saveTransitRoute(result, fromName, toName))
  ]));

  return card;
}

/** 계산한 경로를 기존 '이동 경로'로 저장 */
function saveTransitRoute(result, fromName, toName) {
  const steps = result.legs.map(leg => ({
    type: 'train',
    line: leg.line.ko,
    from: leg.from.ko,
    to: leg.to.ko,
    platform: '',
    minutes: String(leg.minutes),
    cost: '',
    note: leg.heading + ' · ' + leg.count + '개 역'
  }));
  openEntityForm('route', null, {
    name: fromName + ' → ' + toName,
    fromPlace: fromName,
    toPlace: toName,
    steps: JSON.stringify(steps),
    totalMinutes: String(result.minutes),
    caution: '환승 ' + result.transfers + '회. 소요 시간은 추정치입니다.'
  });
}

/** 노선도 (역 순서대로) */
function lineDiagram(line) {
  const wrap = h('div', { class: 'line-diagram' });
  line.stations.forEach((s, i) => {
    wrap.appendChild(h('button', {
      type: 'button', class: 'ld-row',
      onclick: () => openBigText(s.ja, s.ko + (s.c ? '\n' + s.c : ''))
    }, [
      h('span', { class: 'ld-rail', style: '--c:' + line.color }, [
        h('span', { class: 'ld-dot', style: 'border-color:' + line.color })
      ]),
      h('span', { class: 'ld-code', text: s.c || String(i + 1) }),
      h('span', { style: 'flex:1;min-width:0' }, [
        h('span', { class: 'ld-ko', text: s.ko }),
        h('span', { class: 'ld-ja', text: s.ja })
      ]),
      s.g ? h('span', { class: 'ld-map', 'aria-label': '지도' }, mi('place', 'mi-sm')) : null
    ].filter(Boolean)));
  });
  return wrap;
}

function renderTransit() {
  const nodes = [];
  if (!window.TRANSIT_DATA) {
    return [emptyBox('노선 자료를 불러오지 못했습니다', 'data/transit.js 파일이 올라가 있는지 확인해 주세요.', 'wrong_location')];
  }
  const cityKey = S.transit.city;

  // 도시 선택
  const chips = h('div', { class: 'chips' });
  transitCities().forEach(c => {
    chips.appendChild(h('button', {
      class: 'chip' + (cityKey === c.key ? ' active' : ''), text: c.ko,
      onclick: () => {
        S.transit.city = c.key; S.transit.result = null; S.transit.searched = false;
        S.transit.from = null; S.transit.to = null; S.transit.line = 0;
        renderLocal();
      }
    }));
  });
  nodes.push(chips);

  // 길찾기 / 노선도 전환
  const modes = h('div', { class: 'subtabs', style: 'margin-top:6px' });
  [{ k: 'route', l: '길찾기' }, { k: 'map', l: '노선도' }].forEach(m => {
    modes.appendChild(h('button', {
      class: 'subtab' + (S.transit.mode === m.k ? ' active' : ''), text: m.l,
      onclick: () => { S.transit.mode = m.k; renderLocal(); }
    }));
  });
  nodes.push(modes);

  if (S.transit.mode === 'route') {
    const form = h('div', { class: 'card' });
    form.appendChild(stationPicker('출발역', cityKey, S.transit.from, s => { S.transit.from = s; }));
    form.appendChild(stationPicker('도착역', cityKey, S.transit.to, s => { S.transit.to = s; }));

    form.appendChild(h('div', { class: 'row-wrap' }, [
      iconBtn('search', '경로 찾기', 'btn btn-primary', () => {
        if (!S.transit.from || !S.transit.to) { toast('출발역과 도착역을 골라주세요.', 'error'); return; }
        if (S.transit.from.key === S.transit.to.key) { toast('출발역과 도착역이 같습니다.', 'error'); return; }
        S.transit.result = findTransitRoute(cityKey, S.transit.from.key, S.transit.to.key);
        S.transit.searched = true;
        renderLocal();
      }),
      iconBtn('swap_vert', '출발↔도착', 'btn btn-ghost', () => {
        const t = S.transit.from; S.transit.from = S.transit.to; S.transit.to = t;
        S.transit.result = null; S.transit.searched = false;
        renderLocal();
      })
    ]));
    nodes.push(form);

    if (S.transit.searched) {
      nodes.push(routeResultCard(cityKey, S.transit.result,
        S.transit.from ? S.transit.from.ko : '', S.transit.to ? S.transit.to.ko : ''));
    }

    // 내가 저장한 역을 빠르게 넣기
    if (S.stations.length) {
      nodes.push(h('p', { class: 'faint tiny mt8', text: '저장한 역을 눌러 출발역으로 넣을 수 있습니다.' }));
      const quick = h('div', { class: 'chips' });
      S.stations.slice(0, 10).forEach(st => {
        quick.appendChild(h('button', {
          class: 'chip', text: st.nameKo,
          onclick: () => {
            const found = searchStations(cityKey, st.nameJa || st.nameKo, 1)[0];
            if (!found) { toast('노선 자료에서 찾지 못했습니다.', 'error'); return; }
            S.transit.from = found;
            renderLocal();
          }
        }));
      });
      nodes.push(quick);
    }

  } else {
    const city = transitCity(cityKey);
    const sel = h('select', { 'aria-label': '노선 선택' });
    city.lines.forEach((l, i) => sel.appendChild(h('option', { value: String(i), text: l.ko })));
    sel.value = String(S.transit.line || 0);
    sel.addEventListener('change', () => { S.transit.line = Number(sel.value); renderLocal(); });
    nodes.push(h('div', { class: 'form-row' }, sel));

    const line = city.lines[S.transit.line || 0];
    if (line) {
      nodes.push(h('div', { class: 'card card-tight' }, [
        h('div', { class: 'row' }, [
          h('span', { class: 'line-chip', style: 'background:' + line.color, text: line.ko }),
          h('span', { class: 'spacer' }),
          h('span', { class: 'faint tiny', text: line.stations.length + '개 역' + (line.loop ? ' · 순환' : '') })
        ]),
        h('div', { class: 'faint tiny mt8', text: line.ja + (line.en ? ' · ' + line.en : '') })
      ]));
      nodes.push(lineDiagram(line));
    }
  }

  nodes.push(h('div', { class: 'card card-tight mt12' }, [
    h('div', { class: 'faint tiny', text: '노선 자료 출처 (오픈 소스)' }),
    h('div', { class: 'mt8' }, (window.TRANSIT_DATA.meta.sources || []).map(src =>
      h('div', { class: 'tiny', style: 'padding:2px 0' }, [
        h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', text: src.name }),
        h('span', { class: 'faint', text: ' (' + src.license + ') — ' + src.use })
      ])
    )),
    h('p', { class: 'faint tiny mt8', text: window.TRANSIT_DATA.meta.note })
  ]));

  return nodes;
}

/* =========================================================================
 * 13. 기록 화면 (내 기록 · 공동 기록을 하나의 피드로 통합)
 * ========================================================================= */

/**
 * 특정 날짜의 모든 데이터를 한 번에 모읍니다.
 * 일정 · 예약 · 항공 · 숙소 · 기록 · 사진 · 지출이 '날짜'를 축으로 연결됩니다.
 */
function dayBundle(date) {
  const inStay = a => a.checkInDate && a.checkInDate <= date && date <= (a.checkOutDate || a.checkInDate);
  return {
    date: date,
    schedules: S.schedules.filter(x => x.date === date).slice().sort(sortByTime),
    flights: S.flights.filter(x => x.date === date),
    accommodations: S.accommodations.filter(inStay),
    reservations: S.reservations.filter(x => x.date === date).slice().sort(sortByTime),
    records: dayRecords(date),
    photos: S.photos.filter(x => x.date === date),
    expenses: S.expenses.filter(x => x.date === date),
    routes: S.routes
  };
}

/**
 * 하루의 기록을 하나의 목록으로 만듭니다.
 * 개인 기록(DailyRecords)과 예전 공동 기록(SharedRecords)을 구분 없이 합치고,
 * 각 항목에 '누가 썼는지'를 담아 돌려줍니다.
 */
function dayRecords(date) {
  const mine = S.dailyRecords
    .filter(r => r.date === date)
    .map(r => Object.assign({}, r, { _kind: 'daily', _author: r.author || r.createdBy || '' }));

  const shared = S.sharedRecords
    .filter(r => r.date === date)
    .map(r => Object.assign({}, r, { _kind: 'shared', _author: r.createdBy || '' }));

  const all = mine.concat(shared);
  // 내 기록을 맨 앞에, 나머지는 작성 시각 순으로
  all.sort((a, b) => {
    const am = a._author === S.me ? 0 : 1;
    const bm = b._author === S.me ? 0 : 1;
    if (am !== bm) return am - bm;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
  return all;
}

/** 기록 카드 한 장 (작성자 표시 포함) */
function recordCard(rec) {
  const author = rec._author || rec.author || rec.createdBy || '';
  const mine = author === S.me;
  const m = memberInfo(author);
  const isShared = rec._kind === 'shared';

  const head = h('div', { class: 'record-head' }, [
    h('span', { class: 'record-avatar', style: 'background:' + (m.color || '#7d9db3'), text: (m.emoji || '') }),
    h('div', { style: 'flex:1;min-width:0' }, [
      h('div', { class: 'record-who', text: m.displayName || author || '이름 없음' }),
      h('div', { class: 'faint tiny', text: (isShared ? '함께 쓴 기록 · ' : '') + (rec.updatedAt ? fmtSyncTime(rec.updatedAt) + ' 수정' : '') })
    ]),
    mine ? h('span', { class: 'badge badge-mine', text: '나' }) : h('span', { class: 'badge badge-partner', text: '파트너' }),
    sampleBadge(rec)
  ].filter(Boolean));

  const nodes = [head];

  const oneLine = rec.oneLine || rec.title;
  if (oneLine) nodes.push(h('div', { class: 'record-oneline', text: '“' + oneLine + '”' }));

  const g = attachGallery(rec.photoUrl, '기록 사진');
  if (g) nodes.push(g);

  [
    ['방문한 장소', rec.places], ['기억에 남은 순간', rec.bestMoment], ['먹은 음식', rec.foods],
    ['함께 기억하고 싶은 말', rec.words], ['오늘의 색깔', rec.color], ['오늘의 음악', rec.music],
    ['예상과 달랐던 점', rec.surprise], ['다시 가고 싶은 곳', rec.revisit],
    ['내일 기대되는 것', rec.tomorrow], ['자유 기록', rec.freeText], ['메모', rec.memo]
  ].forEach(pair => { const n = kv(pair[0], pair[1]); if (n) nodes.push(n); });

  if (rec.rating) {
    nodes.push(h('div', { class: 'kv' }, [
      h('div', { class: 'kv-k', text: '만족도' }),
      h('div', { class: 'kv-v rating' },
        [1, 2, 3, 4, 5].map(n => mi(n <= Number(rec.rating) ? 'star' : 'star_border',
          'mi-sm' + (n <= Number(rec.rating) ? ' filled' : ''))))
    ]));
  }

  if (mine) {
    nodes.push(h('div', { class: 'li-actions' }, [
      iconBtn('edit', '수정', 'btn btn-sm btn-ghost',
        () => openEntityForm(isShared ? 'sharedRecord' : 'dailyRecord', rec))
    ]));
  }

  return h('div', { class: 'record-card' + (mine ? ' mine' : '') }, nodes.filter(Boolean));
}

/**
 * 기록 작성 폼을 열면서, 같은 날짜의 일정을 불러올 수 있게 합니다.
 */
function openRecordForm(date, rec) {
  const preset = { date: date, author: S.me };
  openEntityForm('dailyRecord', rec || null, preset);
  // 폼이 열린 뒤 맨 위에 "일정 불러오기" 버튼을 얹습니다
  const body = $('#sheetBody');
  if (!body || !body.firstChild) return;
  const bundle = dayBundle(date);
  if (!bundle.schedules.length && !bundle.reservations.length) return;

  const importBtn = h('div', { class: 'import-box' }, [
    h('div', { class: 'row' }, [
      mi('event_available', 'mi-sm'),
      h('span', { style: 'flex:1', class: 'tiny', text: fmtDateKo(date, true) + ' 일정 ' + bundle.schedules.length + '건이 있습니다.' })
    ]),
    h('button', {
      type: 'button', class: 'btn btn-sm btn-block mt8', text: '이 날 일정을 기록에 불러오기',
      onclick: e => {
        const placesInput = $$('#sheetBody textarea')[0];
        const titles = bundle.schedules.map(x =>
          (x.startTime ? x.startTime + ' ' : '') + x.title + (x.place ? ' (' + x.place + ')' : ''));
        bundle.reservations.forEach(r => { if (r.title) titles.push((r.startTime || '') + ' ' + r.title); });
        if (!titles.length) { toast('불러올 일정이 없습니다.', 'error'); return; }
        if (placesInput) {
          const cur = placesInput.value.trim();
          placesInput.value = (cur ? cur + '\n' : '') + titles.join('\n');
          placesInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        e.currentTarget.disabled = true;
        e.currentTarget.textContent = '불러왔습니다';
        toast('일정 ' + titles.length + '건을 기록에 넣었습니다.', 'ok');
      }
    })
  ]);
  body.insertBefore(importBtn, body.firstChild);
}

/** 그 날의 일정을 기록 화면에서 간단히 보여주는 카드 */
function dayLinkCard(bundle) {
  const b = bundle;
  const total = b.schedules.length + b.flights.length + b.reservations.length;
  if (!total && !b.expenses.length && !b.accommodations.length) return null;

  const card = h('div', { class: 'card card-tight day-link' });
  card.appendChild(h('div', { class: 'row mb8' }, [
    mi('link', 'mi-sm'),
    h('span', { class: 'section-title', style: 'font-size:.9rem', text: '이 날의 일정' }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn-sm btn-ghost', text: '일정 탭에서 보기', onclick: () => goSchedule(b.date) })
  ]));

  if (total) {
    const ul = h('div');
    b.schedules.slice(0, 6).forEach(x => {
      ul.appendChild(h('div', { class: 'day-link-row' }, [
        h('span', { class: 'day-link-time', text: x.startTime || '––:––' }),
        mi(catInfo(x.category).icon, 'mi-sm'),
        h('span', { style: 'flex:1;min-width:0', text: x.title })
      ]));
    });
    b.flights.forEach(f => {
      ul.appendChild(h('div', { class: 'day-link-row' }, [
        h('span', { class: 'day-link-time', text: f.depTime || '––:––' }),
        mi('flight', 'mi-sm'),
        h('span', { style: 'flex:1;min-width:0', text: (f.flightNo || '') + ' ' + (f.depAirport || '') + '→' + (f.arrAirport || '') })
      ]));
    });
    if (b.schedules.length > 6) {
      ul.appendChild(h('div', { class: 'faint tiny', style: 'padding:4px 2px', text: '외 ' + (b.schedules.length - 6) + '건' }));
    }
    card.appendChild(ul);
  } else {
    card.appendChild(h('div', { class: 'faint tiny', text: '등록된 일정이 없습니다.' }));
  }

  if (b.accommodations.length) {
    card.appendChild(h('div', { class: 'day-link-row' }, [
      h('span', { class: 'day-link-time', text: '숙소' }),
      mi('hotel', 'mi-sm'),
      h('span', { style: 'flex:1;min-width:0', text: b.accommodations.map(a => a.name).join(', ') })
    ]));
  }
  if (b.expenses.length) {
    const sum = {};
    b.expenses.forEach(e => {
      const c = e.currency || CO.currency;
      sum[c] = (sum[c] || 0) + (Number(e.amount) || 0);
    });
    card.appendChild(h('div', { class: 'day-link-row' }, [
      h('span', { class: 'day-link-time', text: '지출' }),
      mi('payments', 'mi-sm'),
      h('span', { style: 'flex:1;min-width:0', text: Object.keys(sum).map(c => c + ' ' + sum[c].toLocaleString()).join(' · ') })
    ]));
  }
  return card;
}

function renderRecord() {
  const view = $('#view-record');
  if (S.loading && !S.booted) { mount(view, skeletonList(3)); return; }
  ensureDefaultDates();
  const nodes = [];

  const tabs = [
    { k: 'day', l: '날짜별 기록' }, { k: 'photo', l: '사진' },
    { k: 'expense', l: '지출' }, { k: 'summary', l: '여행 요약' }
  ];
  const bar = h('div', { class: 'subtabs' });
  tabs.forEach(t => {
    bar.appendChild(h('button', {
      class: 'subtab' + (S.recordTab === t.k ? ' active' : ''),
      text: t.l, onclick: () => { S.recordTab = t.k; renderRecord(); }
    }));
  });
  nodes.push(bar);

  if (S.recordTab === 'day') {
    const date = S.date;
    const bundle = dayBundle(date);
    nodes.push(renderDateStrip(date, d => { S.date = d; renderRecord(); }));

    const myRecord = bundle.records.filter(r => r._kind === 'daily' && r._author === S.me)[0];
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), fmtDateFull(date)]),
      iconBtn(myRecord ? 'edit' : 'edit_note', myRecord ? '내 기록 수정' : '기록 쓰기', 'btn btn-sm btn-primary',
        () => openRecordForm(date, myRecord))
    ]));

    // 같은 날짜의 일정과 연결해서 보여줍니다
    const link = dayLinkCard(bundle);
    if (link) nodes.push(link);

    if (bundle.records.length) {
      const feed = h('div', { class: 'record-feed' });
      bundle.records.forEach(r => feed.appendChild(recordCard(r)));
      nodes.push(feed);
    } else {
      nodes.push(emptyBox('이 날의 기록이 아직 없습니다',
        '같은 하루를 서로 다른 시선으로 남겨보세요. 두 사람의 기록이 여기에 나란히 쌓입니다.', 'auto_stories'));
    }

    if (bundle.photos.length) {
      nodes.push(h('div', { class: 'section-head' }, [
        h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '이 날의 사진 ' + bundle.photos.length + '장']),
        iconBtn('add_photo_alternate', '추가', 'btn btn-sm', openPhotoUpload)
      ]));
      const grid = h('div', { class: 'photo-grid' });
      const urls = bundle.photos.map(p => p.url);
      bundle.photos.forEach((p, i) => grid.appendChild(h('img', {
        src: p.url, alt: p.name || '사진', loading: 'lazy', onclick: () => openGallery(urls, '사진', i)
      })));
      nodes.push(grid);
    }

  } else if (S.recordTab === 'photo') {
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '사진 ' + S.photos.length + '장']),
      iconBtn('add_photo_alternate', '업로드', 'btn btn-sm', openPhotoUpload)
    ]));
    if (S.photos.length) {
      const grid = h('div', { class: 'photo-grid' });
      S.photos.slice().reverse().forEach(p => {
        grid.appendChild(h('img', {
          src: p.url, alt: p.name || '사진', loading: 'lazy', onclick: () => openPhotoDetail(p)
        }));
      });
      nodes.push(grid);
      nodes.push(h('p', { class: 'faint tiny mt8', text: '사진은 Google Drive 에 저장되고, 시트에는 링크만 기록됩니다.' }));
    } else {
      nodes.push(emptyBox('업로드한 사진이 없습니다', '스마트폰에서 사진을 여러 장 골라 한 번에 올릴 수 있습니다.', 'photo_camera'));
    }

  } else if (S.recordTab === 'expense') {
    nodes.push(h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '지출']),
      iconBtn('add', '추가', 'btn btn-sm', () => openEntityForm('expense', null, { date: S.date, payer: S.me }))
    ]));
    const list = S.expenses.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (list.length) {
      const totals = {};
      list.forEach(e => {
        const c = e.currency || CO.currency;
        totals[c] = (totals[c] || 0) + (Number(e.amount) || 0);
      });
      const totalText = Object.keys(totals).map(c => c + ' ' + totals[c].toLocaleString()).join(' · ');
      nodes.push(h('div', { class: 'card card-tight' }, [
        h('div', { class: 'faint', text: '총 지출' }),
        h('div', { style: 'font-size:1.24rem;font-weight:800', text: totalText })
      ]));
      list.forEach(e => {
        nodes.push(h('div', { class: 'list-item' }, [
          h('div', { class: 'li-head' }, [
            h('div', { class: 'li-title', text: e.title || '' }),
            h('span', { class: 'badge', text: (e.currency || CO.currency) + ' ' + (Number(e.amount) || 0).toLocaleString() })
          ]),
          h('div', { class: 'li-sub', text: fmtDateKo(e.date, true) + (e.category ? ' · ' + e.category : '') + (e.payer ? ' · ' + e.payer : '') }),
          h('div', { class: 'li-actions' }, [
            iconBtn('edit', '수정', 'btn btn-sm btn-ghost', () => openEntityForm('expense', e))
          ])
        ]));
      });
    } else {
      nodes.push(emptyBox('기록된 지출이 없습니다', '간단히 적어 두면 여행 후 정산이 쉬워집니다.', 'payments'));
    }

  } else {
    nodes.push(renderSummary());
  }

  mount(view, nodes.filter(Boolean));

  if (S.recordTab === 'day') {
    view.appendChild(h('button', {
      class: 'fab', 'aria-label': '기록 쓰기',
      onclick: () => openRecordForm(S.date, dayRecords(S.date).filter(r => r._kind === 'daily' && r._author === S.me)[0])
    }, mi('edit', 'mi-lg')));
  }
}

function renderSummary() {
  const wrap = h('div');
  const dates = tripDates();
  const ratings = S.dailyRecords.map(r => Number(r.rating)).filter(n => n > 0);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
  const totals = {};
  S.expenses.forEach(e => {
    const c = e.currency || CO.currency;
    totals[c] = (totals[c] || 0) + (Number(e.amount) || 0);
  });

  wrap.appendChild(h('div', { class: 'today-hero' }, [
    h('div', { class: 't-date', text: (S.trip.startDate ? fmtDateKo(S.trip.startDate) : '') + (S.trip.endDate ? ' – ' + fmtDateKo(S.trip.endDate) : '') }),
    h('div', { class: 't-city', text: S.trip.tripName || CO.appName }),
    h('div', { class: 't-quote', text: S.trip.intro || CO.subtitle })
  ]));

  const stat = h('div', { class: 'card' });
  [
    ['여행 일수', dates.length + '일'],
    ['등록한 일정', S.schedules.length + '개'],
    ['작성한 기록', (S.dailyRecords.length + S.sharedRecords.length) + '개'],
    ['올린 사진', S.photos.length + '장'],
    ['평균 만족도', ratings.length ? avg.toFixed(1) + ' / 5' : '아직 없음'],
    ['총 지출', Object.keys(totals).length ? Object.keys(totals).map(c => c + ' ' + totals[c].toLocaleString()).join(' · ') : '기록 없음'],
    ['저장한 역', S.stations.length + '곳'],
    ['저장한 경로', S.routes.length + '개']
  ].forEach(p => { const n = kv(p[0], p[1]); if (n) stat.appendChild(n); });
  wrap.appendChild(stat);

  /* 하루 한 문장 모음 */
  const lines = S.dailyRecords.filter(r => r.oneLine).sort(sortByDateTime);
  if (lines.length) {
    wrap.appendChild(h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, [h('span', { class: 'dot' }), '오늘의 한 문장 모음'])));
    lines.forEach(r => {
      wrap.appendChild(h('div', { class: 'card card-tight' }, [
        h('div', { class: 'faint tiny', text: fmtDateKo(r.date, true) + ' · ' + memberInfo(r.author).emoji + ' ' + (r.author || '') }),
        h('div', { style: 'font-weight:600;margin-top:4px', text: '“' + r.oneLine + '”' })
      ]));
    });
  }
  return wrap;
}

function openPhotoUpload() {
  const values = { url: '', date: S.date || todayStr() };
  const body = h('div');
  const dateRow = buildField({ k: 'date', l: '어느 날짜의 사진인가요?', t: 'date' }, values, {});
  body.appendChild(dateRow);
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
  const progress = h('div', { class: 'upload-progress hidden' }, h('i'));
  const result = h('div', { class: 'photo-grid mt8' });

  fileInput.addEventListener('change', async () => {
    const files = Array.prototype.slice.call(fileInput.files || []);
    if (!files.length) return;
    progress.classList.remove('hidden');
    const bar = $('i', progress);
    for (let i = 0; i < files.length; i++) {
      bar.style.width = Math.round((i / files.length) * 100) + '%';
      try {
        const payload = await prepareUpload(files[i]);
        payload.date = values.date;
        payload.refType = 'gallery';
        const data = await api('uploadImage', payload, { timeout: 60000, retry: 0 });
        S.photos.push(data.photo);
        result.appendChild(h('img', { src: data.photo.url, alt: '업로드한 사진' }));
      } catch (err) {
        toast('업로드 실패: ' + describeError(err), 'error', 4000);
      }
    }
    bar.style.width = '100%';
    fileInput.value = '';
    setTimeout(() => { progress.classList.add('hidden'); bar.style.width = '0'; }, 500);
    toast('업로드가 끝났습니다.', 'ok');
    silentRefresh();
  });

  body.appendChild(h('button', { type: 'button', class: 'btn btn-primary btn-block', text: '사진 여러 장 선택', onclick: () => fileInput.click() }));
  body.appendChild(fileInput);
  body.appendChild(progress);
  body.appendChild(result);
  body.appendChild(h('p', { class: 'faint tiny mt12', text: '사진은 긴 변 1600px 이하로 자동 압축된 뒤 Google Drive 에 저장됩니다.' }));

  openSheet('사진 업로드', body, [
    h('button', { class: 'btn btn-ghost', text: '닫기', onclick: () => { closeSheet(true); renderRecord(); } })
  ]);
}

function openPhotoDetail(p) {
  const body = h('div');
  body.appendChild(h('img', { src: p.url, alt: p.name || '사진', style: 'border-radius:12px;width:100%' }));
  [['이름', p.name], ['날짜', p.date], ['올린 사람', p.createdBy]].forEach(x => {
    const n = kv(x[0], x[1]); if (n) body.appendChild(n);
  });
  openSheet('사진', body, [
    h('button', { class: 'btn btn-ghost', text: '닫기', onclick: () => closeSheet(true) }),
    h('button', { class: 'btn btn-sm btn-ghost', text: '원본 열기', onclick: () => openExternal(p.viewUrl || p.url) }),
    h('button', {
      class: 'btn btn-danger', text: '삭제',
      onclick: async () => {
        const yes = await confirmBox('사진 삭제', '이 사진을 삭제할까요?\nGoogle Drive 에서도 휴지통으로 이동합니다.', '삭제');
        if (!yes) return;
        try {
          await api('deleteImage', { id: p.id });
          S.photos = S.photos.filter(x => x.id !== p.id);
          toast('삭제되었습니다.', 'ok');
          await closeSheet(true);
          renderRecord();
        } catch (err) { toast(describeError(err), 'error'); }
      }
    })
  ]);
}

/* =========================================================================
 * 13-2. 전체 검색
 * ========================================================================= */

/** 검색 비교용으로 문자열을 정리합니다(소문자 + 공백 제거). */
function normQ(v) {
  return String(v === null || v === undefined ? '' : v).toLowerCase().replace(/\s+/g, '');
}
/** 여러 필드 중 하나라도 검색어를 포함하면 true */
function matchQ(q, fields) {
  if (!q) return true;
  const text = normQ(fields.filter(Boolean).join(' '));
  return text.indexOf(q) >= 0;
}

/** 탭 이동 도우미 (검색 결과에서 사용) */
function goSchedule(date) { if (date) S.date = date; switchTab('schedule'); }
function goBooking(tab) { S.bookingTab = tab || 'flight'; switchTab('booking'); }
function goLocal(tab, q) {
  S.localTab = tab;
  if (tab === 'phrase') S.filters.phraseQ = q || '';
  if (tab === 'word') S.filters.wordQ = q || '';
  if (tab === 'station') S.filters.stationQ = q || '';
  if (tab === 'bus') S.filters.busQ = q || '';
  if (tab === 'route') S.filters.routeQ = q || '';
  switchTab('local');
}
function goRecord(date) {
  if (date) S.date = date;
  S.recordTab = 'day';
  switchTab('record');
}

/**
 * 앱 안의 모든 데이터를 한 번에 검색합니다.
 * @returns {Array} [{ key, label, items: [{ title, sub, badge, open }] }]
 */
function searchAll(rawQuery) {
  const q = normQ(rawQuery);
  if (!q) return [];
  const groups = [];
  const LIMIT = 8;

  function add(key, label, items) {
    if (items.length) groups.push({ key: key, label: label, items: items.slice(0, LIMIT), total: items.length });
  }

  /* 일정 */
  add('schedule', '일정', S.schedules
    .filter(s => matchQ(q, [s.title, s.place, s.description, s.prepare, s.transport, catInfo(s.category).label]))
    .sort(sortByDateTime)
    .map(s => ({
      title: s.title,
      sub: fmtDateKo(s.date, true) + (s.startTime ? ' ' + s.startTime : '') + (s.place ? ' · ' + s.place : ''),
      badge: catInfo(s.category).label,
      open: () => goSchedule(s.date)
    })));

  /* 예약 */
  add('reservation', '예약 · 티켓', S.reservations
    .filter(r => matchQ(q, [r.title, r.place, r.meetingPoint, r.bookingNumber, r.memo, r.prepare]))
    .sort(sortByDateTime)
    .map(r => ({
      title: r.title,
      sub: (r.date ? fmtDateKo(r.date, true) : '') + (r.place ? ' · ' + r.place : ''),
      badge: (CFG.RESERVATION_TYPES.filter(t => t.key === r.type)[0] || { label: '기타' }).label,
      open: () => openReservationDetail(r)
    })));

  /* 항공 */
  add('flight', '항공', S.flights
    .filter(f => matchQ(q, [f.flightNo, f.airline, f.depAirport, f.arrAirport, f.bookingNumber, f.seat, f.memo]))
    .map(f => ({
      title: (f.airline || '') + ' ' + (f.flightNo || ''),
      sub: fmtDateKo(f.date, true) + ' · ' + (f.depAirport || '') + ' → ' + (f.arrAirport || ''),
      badge: '항공',
      open: () => goBooking('flight')
    })));

  /* 숙소 */
  add('hotel', '숙소', S.accommodations
    .filter(a => matchQ(q, [a.name, a.nameJa, a.address, a.addressJa, a.nearestStation, a.bookingNumber, a.memo]))
    .map(a => ({
      title: a.name,
      sub: (a.checkInDate ? fmtDateKo(a.checkInDate) + ' → ' + fmtDateKo(a.checkOutDate) : '') + (a.nearestStation ? ' · ' + a.nearestStation : ''),
      badge: '숙소',
      open: () => goBooking('hotel')
    })));

  /* 일본어 표현 */
  add('phrase', CO.localLabels.phrases, S.japanesePhrases
    .filter(p => matchQ(q, [p.ko, p.ja, p.reading, p.memo]))
    .map(p => ({
      title: p.ko,
      sub: p.ja + (p.reading ? ' · ' + p.reading : ''),
      badge: (CFG.PHRASE_CATEGORIES.filter(c => c.key === p.category)[0] || { label: '' }).label,
      open: () => goLocal('phrase', rawQuery)
    })));

  /* 일본어 단어 */
  add('word', CO.localLabels.words, S.japaneseWords
    .filter(w => matchQ(q, [w.ko, w.ja, w.reading, w.memo]))
    .map(w => ({
      title: w.ja + ' — ' + w.ko,
      sub: w.reading || '',
      badge: (CFG.WORD_CATEGORIES.filter(c => c.key === w.category)[0] || { label: '' }).label,
      open: () => goLocal('word', rawQuery)
    })));

  /* 역 */
  add('station', CO.localLabels.stations, S.stations
    .filter(st => matchQ(q, [st.nameKo, st.nameJa, st.nameEn, st.lines, st.city, st.nearby, st.recommendedExit, st.memo]))
    .map(st => ({
      title: st.nameKo,
      sub: (st.nameJa || '') + (st.lines ? ' · ' + st.lines : ''),
      badge: '역',
      open: () => goLocal('station', st.nameKo)
    })));

  /* 버스 */
  add('bus', CO.localLabels.buses, S.buses
    .filter(b => matchQ(q, [b.lineName, b.company, b.city, b.fromStop, b.toStop, b.fromStopJa, b.toStopJa, b.memo]))
    .map(b => ({
      title: b.lineName,
      sub: (b.fromStop || '') + ' → ' + (b.toStop || ''),
      badge: '버스',
      open: () => goLocal('bus', b.lineName)
    })));

  /* 이동 경로 */
  add('route', CO.localLabels.routes, S.routes
    .filter(r => matchQ(q, [r.name, r.fromPlace, r.toPlace, r.caution, r.memo, r.steps]))
    .map(r => ({
      title: r.name,
      sub: (r.totalMinutes ? '약 ' + r.totalMinutes + '분' : '') + (r.totalCost ? ' · ' + r.totalCost : ''),
      badge: '경로',
      open: () => goLocal('route', r.name)
    })));

  /* 기록 */
  add('record', '기록', S.dailyRecords
    .filter(r => matchQ(q, [r.oneLine, r.bestMoment, r.places, r.foods, r.freeText, r.revisit, r.tomorrow, r.surprise, r.music]))
    .sort(sortByDateTime)
    .map(r => ({
      title: r.oneLine || (r.bestMoment || '').substring(0, 40) || '하루 기록',
      sub: fmtDateKo(r.date, true) + ' · ' + memberInfo(r.author).emoji + ' ' + (r.author || ''),
      badge: '기록',
      open: () => goRecord(r.date)
    })));

  /* 공동 기록 */
  add('shared', '기록 (함께 쓴 기록)', S.sharedRecords
    .filter(r => matchQ(q, [r.title, r.bestMoment, r.words, r.memo]))
    .sort(sortByDateTime)
    .map(r => ({
      title: r.title || '공동 기록',
      sub: fmtDateKo(r.date, true),
      badge: '공동',
      open: () => goRecord(r.date)
    })));

  /* 지출 */
  add('expense', '지출', S.expenses
    .filter(e => matchQ(q, [e.title, e.category, e.payer, e.memo]))
    .map(e => ({
      title: e.title,
      sub: fmtDateKo(e.date, true) + ' · ' + (e.currency || CO.currency) + ' ' + (Number(e.amount) || 0).toLocaleString(),
      badge: '지출',
      open: () => { S.recordTab = 'expense'; switchTab('record'); }
    })));

  return groups;
}

/** 전체 검색 창 열기 (작성 중인 폼을 덮지 않도록 별도 겹침창) */
function openGlobalSearch(initial) {
  const input = h('input', {
    type: 'search', placeholder: '일정 · 예약 · 일본어 · 역 · 기록 검색',
    'aria-label': '전체 검색', autocomplete: 'off'
  });
  input.value = initial || '';
  const results = h('div', { style: 'margin-top:12px' });

  const box = h('div', {
    class: 'confirm-box',
    role: 'dialog', 'aria-modal': 'true', 'aria-label': '전체 검색',
    style: 'max-width:560px;width:100%;max-height:78vh;display:flex;flex-direction:column;padding-bottom:12px'
  }, [
    h('div', { class: 'row', style: 'gap:6px' }, [
      h('div', { style: 'flex:1' }, input),
      h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => close() }, mi('close'))
    ]),
    h('div', { style: 'flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch' }, results)
  ]);
  const back = h('div', { class: 'confirm-backdrop', style: 'z-index:92;align-items:flex-start;padding-top:8vh' }, box);

  function close() {
    if (back.parentNode) back.parentNode.removeChild(back);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back) close(); });

  function draw() {
    const q = input.value.trim();
    clear(results);
    if (!q) {
      results.appendChild(h('p', { class: 'faint tiny', style: 'padding:14px 2px;line-height:1.8' },
        '여행 안의 모든 내용을 한 번에 찾습니다.\n일정 · 예약 · 항공 · 숙소 · 일본어 표현 · 단어 · 역 · 버스 · 경로 · 기록 · 지출'));
      return;
    }
    const groups = searchAll(q);
    if (!groups.length) {
      results.appendChild(emptyBox('결과가 없습니다', '"' + q + '" 와(과) 일치하는 내용을 찾지 못했습니다.', 'search'));
      return;
    }
    let count = 0;
    groups.forEach(g => {
      count += g.total;
      results.appendChild(h('div', { class: 'section-head', style: 'margin:14px 2px 6px' }, [
        h('h3', { class: 'section-title', style: 'font-size:.88rem' }, [h('span', { class: 'dot' }), g.label]),
        h('span', { class: 'faint tiny', text: g.total + '건' })
      ]));
      g.items.forEach(it => {
        results.appendChild(h('button', {
          class: 'list-item',
          style: 'display:block;width:100%;text-align:left;border:1px solid var(--line-soft);cursor:pointer;margin-bottom:6px',
          onclick: () => { close(); it.open(); }
        }, [
          h('div', { class: 'row' }, [
            h('div', { class: 'li-title', style: 'font-size:.94rem', text: it.title || '' }),
            it.badge ? h('span', { class: 'badge', text: it.badge }) : null
          ].filter(Boolean)),
          it.sub ? h('div', { class: 'li-sub', text: it.sub }) : null
        ].filter(Boolean)));
      });
      if (g.total > g.items.length) {
        results.appendChild(h('p', { class: 'faint tiny', style: 'margin:2px 4px 8px', text: '외 ' + (g.total - g.items.length) + '건 더 있습니다.' }));
      }
    });
    results.insertBefore(
      h('p', { class: 'faint tiny', style: 'margin:4px 2px', text: '모두 ' + count + '건을 찾았습니다.' }),
      results.firstChild
    );
  }

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 180);
  });
  draw();
  document.body.appendChild(back);
  setTimeout(() => input.focus(), 60);
}

/* =========================================================================
 * 14. 탭 전환 · 설정 메뉴
 * ========================================================================= */

function renderCurrentTab() {
  if (S.tab === 'today') renderToday();
  else if (S.tab === 'schedule') renderSchedule();
  else if (S.tab === 'booking') renderBooking();
  else if (S.tab === 'local') renderLocal();
  else if (S.tab === 'record') renderRecord();
}

/** 모바일 하단 탭바 + PC 사이드바를 같은 정의로 만듭니다 */
function buildNav() {
  const bar = $('#tabbar');
  const side = $('#sideNav');
  clear(bar); clear(side);

  TABS.forEach(t => {
    bar.appendChild(h('button', {
      type: 'button', role: 'tab', class: 'tab-btn', 'aria-label': t.label,
      dataset: { tab: t.key }, onclick: () => switchTab(t.key)
    }, [mi(t.icon, 'tab-ico'), h('span', { class: 'tab-label', text: t.label })]));

    side.appendChild(h('button', {
      type: 'button', role: 'tab', class: 'nav-btn', 'aria-label': t.label,
      dataset: { tab: t.key }, onclick: () => switchTab(t.key)
    }, [mi(t.icon), h('span', { text: t.label })]));
  });
}

function switchTab(tab) {
  S.tab = tab;
  TABS.forEach(t => { $('#view-' + t.key).classList.toggle('hidden', t.key !== tab); });
  $$('.tab-btn, .nav-btn').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const cur = TABS.filter(t => t.key === tab)[0];
  if (cur) $('#headerPage').textContent = cur.label;
  window.scrollTo(0, 0);
  const main = $('#appMain');
  if (main) main.scrollTop = 0;
  renderCurrentTab();
}

function openMenu() {
  const body = h('div');

  body.appendChild(h('div', { class: 'card card-tight' }, [
    h('div', { class: 'record-who', text: memberInfo(S.me).emoji + ' ' + S.me }),
    h('div', { class: 'faint tiny', text: S.lastSync ? '마지막 동기화 ' + fmtSyncTime(S.lastSync) : '아직 동기화하지 않았습니다.' })
  ]));

  const items = [
    { icon: 'luggage', label: '여행 기본 정보 수정', fn: () => { closeSheet(true); openEntityForm('trip', S.trip); } },
    { icon: 'search', label: '전체 검색', fn: () => { closeSheet(true); openGlobalSearch(''); } },
    { icon: 'refresh', label: '지금 새로고침', fn: async () => { closeSheet(true); await bootstrap(true); toast('최신 자료를 불러왔습니다.', 'ok'); } },
    { icon: 'edit_note', label: '임시 저장 (' + draftCount() + ')', fn: () => openDrafts() },
    { icon: 'dark_mode', label: '밝기 테마 바꾸기', fn: () => { toggleTheme(); } },
    { icon: 'delete_sweep', label: '저장된 오프라인 자료 지우기', fn: async () => {
        const yes = await confirmBox('오프라인 자료 삭제', '이 기기에 저장된 자료를 지웁니다.\n(서버 데이터는 지워지지 않습니다.)', '지우기');
        if (!yes) return;
        lsDel(CACHE_KEY);
        toast('삭제했습니다.', 'ok');
      } },
    { icon: 'logout', label: '로그아웃', fn: async () => { await closeSheet(true); doLogout(); } }
  ];
  items.forEach(it => {
    body.appendChild(h('button', {
      class: 'btn btn-block mt8', style: 'justify-content:flex-start', onclick: it.fn
    }, [mi(it.icon, 'mi-sm'), h('span', { text: it.label })]));
  });

  body.appendChild(h('div', { class: 'section-head' }, h('h2', { class: 'section-title', text: '앱 정보' })));
  body.appendChild(h('div', { class: 'card card-tight' }, [
    kv('앱', CO.appName),
    kv('국가', CO.nameKo + ' (' + CO.code + ')'),
    kv('시간대', CO.timezone),
    kv('통화', CO.currency),
    kv('여행 ID', S.trip.tripId || '')
  ].filter(Boolean)));

  openSheet('설정', body, [h('button', { class: 'btn btn-ghost', text: '닫기', onclick: () => closeSheet(true) })]);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : (cur === 'light' ? '' : 'dark');
  if (next) document.documentElement.setAttribute('data-theme', next);
  else document.documentElement.removeAttribute('data-theme');
  lsSet('theme', next);
  toast(next === 'dark' ? '어두운 테마' : next === 'light' ? '밝은 테마' : '기기 설정에 맞춤', 'ok', 1500);
}

/* =========================================================================
 * 15. 시작
 * ========================================================================= */

function bindGlobalEvents() {
  $('#loginForm').addEventListener('submit', doLogin);
  const doRefresh = async () => {
    await bootstrap(true);
    toast('최신 자료를 불러왔습니다.', 'ok', 1600);
  };
  // 모바일 헤더 · PC 사이드바 양쪽 버튼을 같은 동작에 연결합니다
  $('#refreshBtn').addEventListener('click', doRefresh);
  $('#sideRefreshBtn').addEventListener('click', doRefresh);
  $('#menuBtn').addEventListener('click', openMenu);
  $('#sideMenuBtn').addEventListener('click', openMenu);
  $('#searchBtn').addEventListener('click', () => openGlobalSearch(''));
  $('#sideSearchBtn').addEventListener('click', () => openGlobalSearch(''));
  $('#sheetClose').addEventListener('click', () => closeSheet(false));
  $('#sheetBackdrop').addEventListener('click', e => { if (e.target === $('#sheetBackdrop')) closeSheet(false); });
  $('#viewerClose').addEventListener('click', () => $('#viewer').classList.add('hidden'));
  $('#viewer').addEventListener('click', e => { if (e.target === $('#viewer')) $('#viewer').classList.add('hidden'); });
  $('#bigTextClose').addEventListener('click', () => $('#bigText').classList.add('hidden'));
  $('#bigText').addEventListener('click', e => { if (e.target === $('#bigText')) $('#bigText').classList.add('hidden'); });

  // Ctrl/Cmd + K 로 전체 검색 열기
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (S.token && S.booted) openGlobalSearch('');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#viewer').classList.contains('hidden')) { $('#viewer').classList.add('hidden'); return; }
    if (!$('#bigText').classList.contains('hidden')) { $('#bigText').classList.add('hidden'); return; }
    if (sheetState.open) closeSheet(false);
  });

  window.addEventListener('online', () => {
    updateNetDot();
    toast('인터넷에 다시 연결되었습니다.', 'ok');
    if (S.token) silentRefresh();
  });
  window.addEventListener('offline', () => {
    updateNetDot();
    toast('오프라인 상태입니다. 저장된 자료를 보여줍니다.', 'error', 3000);
  });

  // 앱으로 돌아왔을 때 자동 재조회
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.token && S.booted) silentRefresh();
  });

  // 1분마다 '오늘' 화면의 남은 시간 갱신
  setInterval(() => { if (S.tab === 'today' && S.booted) renderToday(); }, 60000);
}

/**
 * Material Symbols 폰트가 준비되면 아이콘을 보여줍니다.
 * 폰트를 못 받아도(오프라인 등) 3초 뒤에는 화면을 그대로 보여줍니다.
 */
function waitForIconFont() {
  const root = document.documentElement;
  const FONT = '24px "Material Symbols Rounded"';
  let done = false;
  // 성공하면 아이콘을 보여주고, 실패하면 아예 숨깁니다.
  // (숨기지 않으면 'search' 같은 ligature 원문이 글자로 보입니다)
  const finish = ok => {
    if (done) return;
    done = true;
    root.classList.add(ok ? 'mi-ready' : 'mi-off');
  };

  if (!document.fonts || !document.fonts.load) { finish(true); return; }
  setTimeout(() => finish(document.fonts.check(FONT)), 3500);
  document.fonts.load(FONT, 'search')
    .then(list => finish(!!(list && list.length)))
    .catch(() => finish(false));
}

async function init() {
  // 테마
  const theme = lsGet('theme', '');
  if (theme) document.documentElement.setAttribute('data-theme', theme);

  // 국가 설정 반영
  $('#brandCountry').textContent = CO.nameEn;
  $('#brandSubtitle').textContent = CO.subtitle;
  $$('.header-country').forEach(el => { el.textContent = CO.nameEn; });
  document.title = CO.appName;

  $('#loginTripCode').value = lsGet('tripCode', CFG.DEFAULT_TRIP_CODE || '');
  buildUserPicker();
  buildNav();
  bindGlobalEvents();
  updateNetDot();
  waitForIconFont();

  // 서비스 워커 등록 (PWA)
  if ('serviceWorker' in navigator) {
    try {
      const base = location.pathname.replace(/[^/]*$/, '');
      await navigator.serviceWorker.register(base + 'service-worker.js');
    } catch (e) { /* 등록 실패해도 앱은 동작합니다 */ }
  }

  // 저장된 세션이 있으면 자동 로그인
  const token = lsGet('token', null);
  const me = lsGet('me', '');
  if (token) {
    S.token = token;
    S.me = me;
    showApp();
    try {
      const data = await api('validateSession', {}, { retry: 1, timeout: 15000 });
      S.me = data.nickname || me;
      lsSet('me', S.me);
      await bootstrap(true);
    } catch (err) {
      if (err.code === 'INVALID_SESSION') {
        // handleSessionExpired 가 로그인 화면으로 보냅니다.
      } else {
        // 오프라인이면 캐시로 계속 사용
        const cache = lsGet(CACHE_KEY, null);
        if (cache && cache.data) {
          applyBootstrap(cache.data);
          S.booted = true;
          updateHeader();
          ensureDefaultDates();
          switchTab('today');
          updateSyncBar('오프라인 - 저장된 자료 (' + fmtSyncTime(cache.at) + ')');
          toast('오프라인 상태입니다. 저장된 자료를 보여줍니다.', 'error', 3200);
        } else {
          renderLoadError(err);
        }
      }
    }
  } else {
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', init);
