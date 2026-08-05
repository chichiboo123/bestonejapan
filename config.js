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
 * 1-2) AI 도우미 (Groq) 설정
 * ------------------------------------------------------------------
 * ★★★ API 키는 절대 이 파일에 적지 마세요! ★★★
 *
 * 이 저장소는 GitHub 에 공개되어 있어서, 여기에 키를 적으면
 * 누구나 키를 가져다 쓸 수 있고 요금이 청구될 수 있습니다.
 * (GitHub Actions 의 Secret 도 마찬가지입니다. GitHub Pages 는 정적 사이트라
 *  빌드할 때 넣은 값이 그대로 배포되어 누구나 볼 수 있게 됩니다.)
 *
 * ▶ 키를 넣는 곳은 Apps Script 의 스크립트 속성입니다.
 *     Apps Script 편집기 → ⚙ 프로젝트 설정 → 스크립트 속성 → 속성 추가
 *       속성: GROQ_API_KEY
 *       값  : console.groq.com/keys 에서 만든 키 (gsk_ 로 시작)
 *     넣은 뒤 [배포 관리 > 새 버전]으로 다시 배포하면 끝입니다.
 *     앱은 Apps Script 를 거쳐 AI 를 부르므로 키가 브라우저로 내려오지 않습니다.
 *
 * ▶ 예비 수단
 *     서버에 키를 넣기 전이라면, 앱의 ✨ 버튼 → ⚙ [설정] → [이 기기에만 저장]
 *     에 키를 넣어 임시로 쓸 수 있습니다. (기기마다 따로 넣어야 합니다)
 *
 * (자세한 방법은 README.md 의 "AI 도우미 사용하기" 를 읽어주세요)
 * ---------------------------------------------------------------- */
const AI_CONFIG = {
  /** 어떤 회사의 AI 를 쓰는지 (안내 문구에만 사용) */
  PROVIDER: 'groq',
  PROVIDER_LABEL: 'Groq',

  /** Groq API 주소 (OpenAI 와 같은 형식입니다) */
  API_BASE: 'https://api.groq.com/openai/v1',

  /** 키를 만드는 곳 (설정 화면에서 안내용으로 씁니다) */
  KEY_PAGE: 'https://console.groq.com/keys',

  /**
   * 사용할 모델을 "먼저 쓸 것부터" 적어주세요.
   *
   * 앱은 먼저 "지금 이 키로 실제 쓸 수 있는 모델 목록"을 확인한 뒤,
   * 아래 목록 중 존재하는 것만 순서대로 시도합니다.
   * 없는 이름은 두드려 보지도 않으므로 미리 적어두어도 손해가 없습니다.
   *
   * 우선순위: 앱에서 고른 순서 > 스크립트 속성 GROQ_MODELS > 아래 기본값
   *
   * ── 왜 이 순서인가요? (2026년 8월 기준) ──────────────────────────
   *  openai/gpt-oss-120b : Groq 무료 등급에서 하루 토큰 한도가 가장 넉넉하고
   *                        (분당 30회 · 하루 20만 토큰) 답 품질도 가장 좋습니다.
   *  openai/gpt-oss-20b  : 더 가볍고 빨라서, 120b 가 한도에 걸리면 이어받습니다.
   *  qwen/qwen3.6-27b    : 위 둘이 모두 막혔을 때를 위한 예비.
   *
   *  ※ 모델마다 한도가 "따로" 계산되므로, 여러 개를 적어두면
   *    하나가 막혀도 앱이 자동으로 다음 모델로 넘어가 계속 쓸 수 있습니다.
   *  ※ Groq 도 모델을 갈아치웁니다. 앱의 [AI 설정] → [사용 가능한 모델 불러오기]
   *    를 누르면 지금 실제로 쓸 수 있는 목록을 확인하고 바로 고를 수 있습니다.
   */
  MODELS: [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.6-27b',
    // 계정에 따라 위 세 개 중 일부가 없을 수 있어 마지막 보루를 하나 더 둡니다.
    'llama-3.3-70b-versatile'
  ],

  /**
   * 웹 검색(browser_search)으로 최신 정보를 찾아 답하도록 할지.
   *
   * ★ 기본값을 false 로 둔 이유 (2026-08)
   *   이 도구는 Groq 서버가 실제로 웹사이트를 하나씩 돌아다니며 읽는 방식이라
   *   답이 나오기까지 아주 오래 걸립니다. 그런데 이 앱은 Apps Script 를 거쳐
   *   AI 를 부르는데, Apps Script 는 실행이 길어지면 중간에 끊기고
   *   응답이 통째로 사라집니다. 그러면 앱에는 "HTTP 404" 만 뜨고
   *   답이 아예 안 나옵니다. ("맛집 검색해줘" 같은 질문에서 자주 났습니다)
   *
   *   그래서 지금은 모델이 알고 있는 지식으로 답하고, 확실하지 않으면
   *   "확실하지 않다" 고 말하도록 했습니다. (system 프롬프트에 지시되어 있습니다)
   *   검색이 꼭 필요하면 true 로 바꾸면 되지만, 답이 늦거나 실패할 수 있습니다.
   */
  USE_SEARCH: false,

  /** 생각을 얼마나 길게 할지: low / medium / high (낮을수록 빠르고 토큰을 덜 씁니다) */
  REASONING_EFFORT: 'low',

  /**
   * 한 번에 받을 최대 길이.
   * gpt-oss 계열은 "생각"에도 이 길이를 쓰기 때문에, 너무 작으면
   * 생각만 하다가 끝나서 답이 비어버립니다. 넉넉하게 둡니다.
   */
  MAX_OUTPUT_TOKENS: 2048,
  TIMEOUT_MS: 45000,

  /**
   * 대화에 함께 보낼 최근 주고받은 횟수.
   * Groq 무료 등급은 "분당 토큰" 한도가 넉넉하지 않아 조금 줄였습니다.
   */
  HISTORY_TURNS: 6
};

/* ------------------------------------------------------------------
 * 1-3) 날씨 설정
 * ------------------------------------------------------------------
 * Open-Meteo 를 사용합니다. API 키가 필요 없고 무료입니다.
 * (https://open-meteo.com - 비상업적 사용 무료)
 * ---------------------------------------------------------------- */
const WEATHER_CONFIG = {
  API_BASE: 'https://api.open-meteo.com/v1/forecast',

  /** 몇 분마다 새로 받아올지 */
  REFRESH_MIN: 15,

  /** 응답 제한 시간 */
  TIMEOUT_MS: 12000
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

  /**
   * 오늘 화면 맨 위에 날씨를 보여줄 도시들.
   * 위도(lat) · 경도(lon) 는 https://www.latlong.net 등에서 찾을 수 있습니다.
   * 다른 나라 버전에서는 이 목록만 바꾸면 됩니다.
   */
  weatherCities: [
    { key: 'tokyo',   label: '도쿄',   lat: 35.6895, lon: 139.6917 },
    { key: 'sapporo', label: '삿포로', lat: 43.0621, lon: 141.3544 }
  ],

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

/** 사진 · 영상 업로드 설정 */
const UPLOAD_CONFIG = {
  MAX_EDGE: 1600,        // 긴 변 최대 픽셀
  TARGET_BYTES: 1024000, // 권장 1MB
  MIME: 'image/jpeg',    // 브라우저가 지원하면 image/webp 로 자동 전환
  QUALITY_START: 0.86,
  QUALITY_MIN: 0.5,

  /* ---- 영상 ----------------------------------------------------------
   * 영상은 사진과 달리 압축을 할 수 없어서 원본 그대로 올라갑니다.
   * Google Apps Script 가 한 번에 다룰 수 있는 크기에 한계가 있어
   * 아래 크기까지만 받습니다. (요즘 휴대폰 1080p 기준 약 40초~1분)
   *
   * 큰 영상은 휴대폰 사진 앱에서 필요한 부분만 잘라낸 뒤 올려주세요.
   * ------------------------------------------------------------------ */
  VIDEO_MAX_BYTES: 20 * 1024 * 1024,   // 20MB

  /** 한 번에 보내는 조각 크기. 네트워크가 느려도 끊기지 않도록 잘라 보냅니다. */
  CHUNK_BYTES: 2 * 1024 * 1024,        // 2MB

  /** 이 크기를 넘으면 여러 조각으로 나눠 보냅니다. */
  CHUNK_THRESHOLD: 3 * 1024 * 1024,    // 3MB

  /** 받아들이는 영상 형식 (휴대폰에서 찍은 영상은 대부분 mp4 또는 mov 입니다) */
  VIDEO_MIME: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp']
};


/* 다른 파일에서 쓸 수 있도록 전역으로 노출 */
window.BESTONE_CONFIG = {
  API_CONFIG,
  AI_CONFIG,
  WEATHER_CONFIG,
  COUNTRY_CONFIG,
  USER_PRESETS,
  DEFAULT_TRIP_CODE,
  CATEGORIES,
  RESERVATION_TYPES,
  PHRASE_CATEGORIES,
  WORD_CATEGORIES,
  TRANSPORT_OPTIONS,
  RECORD_COLORS,
  UPLOAD_CONFIG
};
