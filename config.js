/* =========================================================================
 * config.js  -  BestOne in Japan
 * -------------------------------------------------------------------------
 * ★★★ 여기 딱 한 줄만 바꾸면 앱이 동작합니다 ★★★
 *
 *   API_URL  :  Google Apps Script 웹 앱 배포 주소
 *               (README.md 7단계에서 복사한 주소를 붙여 넣으세요)
 *               예) https://script.google.com/macros/s/AKfycb.....다른문자들...../exec
 *
 * 나라를 바꾸고 싶으면 COUNTRY_CONFIG 만 수정하면 됩니다.
 * (BestOne in France / England / Thailand ... 로 확장 가능)
 * ========================================================================= */

/* ------------------------------------------------------------------
 * 1) 서버 연결 설정
 * ---------------------------------------------------------------- */
const API_CONFIG = {
  /** ↓↓↓ 이 값을 본인의 Apps Script 웹 앱 URL 로 바꿔주세요 ↓↓↓ */
  API_URL: 'https://script.google.com/macros/s/AKfycbxB0ILgr4HzA6-DiclU9OzYduYbMPCQudzgK93p6JRdDSVB1h7hU9YsDAzDLActGLvb/exec',

  /** 요청 제한 시간 (밀리초). 모바일 네트워크가 느릴 수 있어 넉넉히 둡니다. */
  TIMEOUT_MS: 30000,

  /** 네트워크 오류일 때 자동 재시도 횟수 */
  RETRY: 1,

  /** localStorage 키 접두사 (다른 나라 버전과 데이터가 섞이지 않도록) */
  STORAGE_PREFIX: 'bestone_jp_'
};

/* ------------------------------------------------------------------
 * 2) 국가 설정  ← 다른 나라 버전은 이 객체만 바꾸면 됩니다
 * ---------------------------------------------------------------- */
const COUNTRY_CONFIG = {
  code: 'JP',
  nameKo: '일본',
  nameEn: 'Japan',
  currency: 'JPY',
  currencySymbol: '¥',
  timezone: 'Asia/Tokyo',
  language: 'ja',           // 음성 재생(SpeechSynthesis)에 사용
  speechLang: 'ja-JP',
  appName: 'BestOne in Japan',
  subtitle: '«어린왕자와 코끼리의 일본 여행»',

  /** 현지 탭에서 사용할 이름들 (나라별로 자연스럽게 바꿀 수 있습니다) */
  localLabels: {
    phrases: '회화',
    words: '주요 어휘',
    transit: '노선 · 길찾기',
    routes: '이동 경로'
  },

  /** 긴급 연락처 (오프라인에서도 보이도록 앱에 내장) */
  emergency: [
    { label: '경찰', value: '110' },
    { label: '구급 · 소방', value: '119' },
    { label: '주일본 대한민국 대사관', value: '+81-3-3452-7611' },
    { label: '영사 콜센터(24시간)', value: '+82-2-3210-0404' },
    { label: 'Japan Visitor Hotline', value: '+81-50-3816-2787' }
  ],

  /** 외부 링크 (실시간 정보는 앱에서 직접 제공하지 않고 새 창으로 엽니다) */
  externalLinks: [
    { label: 'Google 지도', url: 'https://www.google.com/maps' },
    { label: 'Japan Transit Planner', url: 'https://world.jorudan.co.jp/mln/ko/' },
    { label: 'JR 동일본', url: 'https://www.jreast.co.jp/kr/' },
    { label: 'JR 홋카이도', url: 'https://www.jrhokkaido.co.jp/global/korean/index.html' },
    { label: '일본 기상청 날씨', url: 'https://www.jma.go.jp/bosai/map.html' }
  ]
};

/* ------------------------------------------------------------------
 * 3) 로그인 화면에 표시할 사용자 (닉네임 직접 입력도 가능합니다)
 *    ※ 비밀번호는 절대 여기에 적지 마세요. 서버(Script Properties)에만 있습니다.
 * ---------------------------------------------------------------- */
const USER_PRESETS = [
  { nickname: 'chichiboo', label: '어린왕자', emoji: '⭐' },
  { nickname: 'neederes', label: '코끼리', emoji: '🐘' }
];

/** 여행 코드 입력칸의 기본값 (서버 TRIP_CODE 와 같아야 로그인됩니다) */
const DEFAULT_TRIP_CODE = 'bestone';

/* ------------------------------------------------------------------
 * 4) 일정 / 예약 카테고리
 * ---------------------------------------------------------------- */
/* icon 값은 Google Material Symbols 의 아이콘 이름입니다 */
const CATEGORIES = [
  { key: 'flight',      label: '항공',      icon: 'flight',              color: '#7d9db3' },
  { key: 'hotel',       label: '숙소',      icon: 'hotel',               color: '#c9a227' },
  { key: 'sightseeing', label: '관광',      icon: 'photo_camera',        color: '#5b8c5a' },
  { key: 'tour',        label: '투어',      icon: 'tour',                color: '#b5763c' },
  { key: 'food',        label: '음식점',    icon: 'restaurant',          color: '#c96f4a' },
  { key: 'show',        label: '공연',      icon: 'theater_comedy',      color: '#8a6fb0' },
  { key: 'sports',      label: '경기',      icon: 'sports_baseball',     color: '#3f7f6f' },
  { key: 'shopping',    label: '쇼핑',      icon: 'shopping_bag',        color: '#c2708f' },
  { key: 'train',       label: '열차',      icon: 'train',               color: '#4a6fa5' },
  { key: 'move',        label: '이동',      icon: 'directions_bus',      color: '#6b7f99' },
  { key: 'free',        label: '자유 시간', icon: 'wb_sunny',            color: '#9aa6b2' },
  { key: 'etc',         label: '기타',      icon: 'push_pin',            color: '#8b8377' }
];

/** 예약 유형 (예약 탭) */
const RESERVATION_TYPES = [
  { key: 'sightseeing', label: '관광' },
  { key: 'tour',        label: '투어' },
  { key: 'show',        label: '공연' },
  { key: 'sports',      label: '경기' },
  { key: 'train',       label: '열차' },
  { key: 'food',        label: '음식점' },
  { key: 'etc',         label: '기타' }
];

/** 일본어 표현 카테고리 */
const PHRASE_CATEGORIES = [
  { key: 'greeting',    label: '기본 인사' },
  { key: 'airport',     label: '공항' },
  { key: 'train',       label: '철도 · 지하철' },
  { key: 'bus',         label: '버스' },
  { key: 'taxi',        label: '택시' },
  { key: 'hotel',       label: '숙소' },
  { key: 'restaurant',  label: '식당' },
  { key: 'shopping',    label: '쇼핑' },
  { key: 'sightseeing', label: '관광' },
  { key: 'venue',       label: '공연장 · 경기장' },
  { key: 'emergency',   label: '긴급 상황' }
];

/** 일본어 단어 카테고리 */
const WORD_CATEGORIES = [
  { key: 'station',    label: '역' },
  { key: 'subway',     label: '지하철' },
  { key: 'railway',    label: '철도' },
  { key: 'bus',        label: '버스' },
  { key: 'hotel',      label: '숙소' },
  { key: 'restaurant', label: '식당' },
  { key: 'shopping',   label: '쇼핑' },
  { key: 'toilet',     label: '화장실' },
  { key: 'payment',    label: '결제' },
  { key: 'direction',  label: '길찾기' },
  { key: 'emergency',  label: '긴급 상황' }
];

/** 이동 수단 선택지 */
const TRANSPORT_OPTIONS = ['도보', '지하철', '전철', '신칸센', '버스', '택시', '렌터카', '자전거', '페리', '비행기', '기타'];

/** 하루 기록의 '오늘의 색깔' 선택지 */
const RECORD_COLORS = [
  '하늘색', '노을색', '별빛 노랑', '사막 모래', '남색 밤', '연둣빛', '눈처럼 흰색', '코끼리 회청색', '벚꽃 분홍', '깊은 초록'
];

/** 사진 업로드 설정 */
const UPLOAD_CONFIG = {
  MAX_EDGE: 1600,        // 긴 변 최대 픽셀
  TARGET_BYTES: 1024000, // 권장 1MB
  MIME: 'image/jpeg',    // 브라우저가 지원하면 image/webp 로 자동 전환
  QUALITY_START: 0.86,
  QUALITY_MIN: 0.5
};

/** 오늘 화면에 보여줄 대표 문구 (날짜에 따라 순환) */
const DAILY_QUOTES = [
  '가장 중요한 것은 눈에 보이지 않아.',
  '네가 오후 네 시에 온다면, 나는 세 시부터 행복해지기 시작할 거야.',
  '사막이 아름다운 건 어딘가에 샘을 숨기고 있기 때문이야.',
  '길들인다는 건 관계를 맺는 거야.',
  '별들이 아름다운 건 보이지 않는 꽃 한 송이 때문이야.',
  '어른들은 누구나 처음엔 어린이였다. 그것을 기억하는 어른은 별로 없지만.',
  '내 비밀은 이거야. 마음으로 보아야 잘 보인다는 거.',
  '오늘 하루도 우리만의 별에 이야기를 하나 더 얹는 날.'
];

/* 다른 파일에서 쓸 수 있도록 전역으로 노출 */
window.BESTONE_CONFIG = {
  API_CONFIG,
  COUNTRY_CONFIG,
  USER_PRESETS,
  DEFAULT_TRIP_CODE,
  CATEGORIES,
  RESERVATION_TYPES,
  PHRASE_CATEGORIES,
  WORD_CATEGORIES,
  TRANSPORT_OPTIONS,
  RECORD_COLORS,
  UPLOAD_CONFIG,
  DAILY_QUOTES
};
