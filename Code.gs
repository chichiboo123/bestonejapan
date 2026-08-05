/*************************************************************
 * BestOne in Japan - Google Apps Script Backend (Code.gs)
 * -----------------------------------------------------------
 * 두 사람이 함께 쓰는 여행 기록 / 공동 일정 관리 웹앱의 백엔드입니다.
 *
 * 데이터 저장: Google Sheets
 * 이미지 저장: Google Drive
 * 통신 방식  : 하나의 웹앱 URL + action 분기 (doGet / doPost)
 *
 * 처음 사용하시는 분은 README.md 의 "설치 안내서"를 먼저 읽어주세요.
 *
 * 실행해야 하는 함수 (Apps Script 편집기 상단에서 선택 후 실행)
 *   1) setupBestOneProject()   : 시트/헤더/기본 설정 생성 (여러 번 실행해도 안전)
 *   2) generatePasswordHash()  : 비밀번호 해시 만들기 (로그 확인)
 *   3) seedJapanData()         : 일본어 표현/단어/샘플 데이터 생성
 *   4) checkSetup()            : 설정이 제대로 되었는지 점검
 *   5) clearSampleData()       : 샘플 데이터만 삭제
 *   6) repairDateTimeColumns() : 날짜/시각이 "1899-12-30..." 처럼 깨져 보일 때 복구
 *************************************************************/

/* ============================================================
 * 0. 상수 / 스키마 정의
 * ========================================================== */

var APP_VERSION = '1.0.0';

/** 공통 필드 (모든 데이터 시트 끝에 붙습니다) */
var COMMON_TAIL = ['createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'isDeleted', 'isSample'];

/**
 * 날짜/시각 자동 서식 문제 방지용 필드 분류
 * -----------------------------------------------------------
 * Google Sheets 는 "09:22", "2026-08-05" 같은 문자열을 셀에 쓰면
 * 사람이 직접 입력한 것처럼 자동으로 날짜/시각 형식으로 바꿔버립니다.
 * 그러면 다음에 읽어올 때 문자열이 아니라 Date 객체로 돌아오는데,
 * 시각 전용 값은 내부적으로 1899-12-30 을 기준일로 저장되어 있어서
 * 그대로 포맷하면 "1899-12-30T08:47:08Z" 같은 값이 되어버립니다.
 *
 * 이 문제를 막기 위해:
 *   1) 아래 목록의 컬럼은 시트에 셀 서식을 "일반 텍스트"로 강제합니다
 *      (getSheet_ / headersOf_ 에서 처리) → 앞으로는 자동 변환되지 않습니다.
 *   2) 그래도 이미 Date 로 저장되어 있던 값은 읽을 때(formatDateTimeCell_)
 *      필드 종류에 맞춰 올바른 형태(날짜만 또는 시각만)로 복원합니다.
 */
/** 날짜만 담는 칸 (yyyy-MM-dd) */
var DATE_ONLY_FIELDS_ = {
  date: 1, checkInDate: 1, checkOutDate: 1,
  startDate: 1, endDate: 1            // 여행 기본 정보(Settings 시트)
};

/** 시각만 담는 칸 (HH:mm) */
var TIME_ONLY_FIELDS_ = {
  startTime: 1, endTime: 1, depTime: 1, arrTime: 1, boardingTime: 1,
  checkInTime: 1, checkOutTime: 1, departBy: 1,
  firstBus: 1, lastBus: 1             // 사용자가 "05:40" 처럼 적을 수 있는 칸
};

/**
 * 전체 시각(ISO 타임스탬프)을 담는 칸.
 * 값 형식은 기본값과 같지만, 자동 변환되면 updatedAt 비교가 어긋나
 * 저장할 때마다 "다른 사람이 먼저 수정했습니다" 오류가 나므로 함께 보호합니다.
 */
var TIMESTAMP_FIELDS_ = {
  createdAt: 1, updatedAt: 1, at: 1, issuedAt: 1, expiresAt: 1, lastSeenAt: 1
};

/**
 * 시트별로 추가 보호가 필요한 칸.
 * Settings 시트는 key/value 구조라서 startDate 같은 날짜가 'value' 칸에 들어갑니다.
 */
var EXTRA_TEXT_COLUMNS_ = { Settings: { value: 1 } };

/** 이 칸을 "일반 텍스트" 서식으로 고정해야 하는가? */
function isProtectedColumn_(sheetName, header) {
  if (DATE_ONLY_FIELDS_[header] || TIME_ONLY_FIELDS_[header] || TIMESTAMP_FIELDS_[header]) return true;
  var extra = EXTRA_TEXT_COLUMNS_[sheetName];
  return !!(extra && extra[header]);
}

/**
 * Date 객체를 필드 종류에 맞는 문자열로 되돌립니다. Date 가 아니면 그대로 돌려줍니다.
 * @param {string} header 칸 이름. Settings 시트의 'value' 칸은 그 행의 key 를 넘겨줍니다.
 */
function formatDateTimeCell_(header, v) {
  if (!(v instanceof Date)) return v;
  if (DATE_ONLY_FIELDS_[header]) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  if (TIME_ONLY_FIELDS_[header]) return Utilities.formatDate(v, 'Asia/Tokyo', 'HH:mm');
  return Utilities.formatDate(v, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/**
 * 날짜·시각 칸에 "일반 텍스트" 서식을 강제해 자동 변환을 막습니다.
 * @param {Sheet} sh 대상 시트
 * @param {string} sheetName 시트 이름
 * @param {string[]} headers 전체 헤더 배열
 * @param {number[]} [onlyCols] 1부터 시작하는 칸 번호만 처리하고 싶을 때 (없으면 전체)
 */
function protectDateTimeColumns_(sh, sheetName, headers, onlyCols) {
  var maxRows = Math.max(sh.getMaxRows() - 1, 1);
  headers.forEach(function (h, idx) {
    if (!isProtectedColumn_(sheetName, h)) return;
    var col = idx + 1;
    if (onlyCols && onlyCols.indexOf(col) === -1) return;
    try {
      sh.getRange(2, col, maxRows, 1).setNumberFormat('@');
    } catch (e) { /* 서식 설정 실패는 무시하고 계속 진행 */ }
  });
}

/** 시트 이름과 헤더(영문 필드명) 정의 */
var SCHEMA = {
  Settings: ['key', 'value', 'updatedAt'],

  Members: ['id', 'tripId', 'nickname', 'displayName', 'emoji', 'color', 'role'].concat(COMMON_TAIL),

  Sessions: ['token', 'tripId', 'nickname', 'issuedAt', 'expiresAt', 'lastSeenAt', 'device'],

  Reservations: [
    'id', 'tripId', 'type', 'title', 'date', 'startTime', 'endTime', 'place', 'meetingPoint',
    'people', 'bookingNumber', 'qrImageUrl', 'ticketUrl', 'bookingSite', 'officialSite',
    'prepare', 'cancelPolicy', 'transport', 'mapUrl', 'memo'
  ].concat(COMMON_TAIL),

  Flights: [
    'id', 'tripId', 'date', 'airline', 'flightNo', 'depAirport', 'depTerminal', 'boardingTime', 'depTime',
    'arrAirport', 'arrTerminal', 'arrTime', 'seat', 'baggage', 'bookingNumber', 'bookingSite',
    'ticketUrl', 'memo'
  ].concat(COMMON_TAIL),

  Accommodations: [
    'id', 'tripId', 'name', 'nameJa', 'checkInDate', 'checkInTime', 'checkOutDate', 'checkOutTime',
    'address', 'addressJa', 'nearestStation', 'recommendedExit', 'roomType', 'bookingNumber',
    'bookingSite', 'breakfast', 'nonSmoking', 'luggageStorage', 'mapUrl', 'officialSite',
    'ticketUrl', 'phone', 'memo'
  ].concat(COMMON_TAIL),

  Schedules: [
    'id', 'tripId', 'date', 'startTime', 'endTime', 'category', 'title', 'place', 'description',
    'transport', 'travelMinutes', 'departBy', 'mapUrl', 'reservationId', 'prepare', 'isDone',
    'likes', 'mustGo', 'author'
  ].concat(COMMON_TAIL),

  ScheduleComments: ['id', 'tripId', 'scheduleId', 'text'].concat(COMMON_TAIL),

  DailyRecords: [
    'id', 'tripId', 'date', 'author', 'photoUrl', 'places', 'bestMoment', 'foods', 'oneLine',
    'color', 'music', 'surprise', 'revisit', 'tomorrow', 'rating', 'freeText'
  ].concat(COMMON_TAIL),

  SharedRecords: [
    'id', 'tripId', 'date', 'photoUrl', 'bestMoment', 'words', 'title', 'memo'
  ].concat(COMMON_TAIL),

  Photos: [
    'id', 'tripId', 'fileId', 'url', 'viewUrl', 'name', 'mimeType', 'size', 'refType', 'refId', 'date'
  ].concat(COMMON_TAIL),

  JapanesePhrases: [
    'id', 'tripId', 'category', 'ko', 'ja', 'reading', 'favorite', 'memo', 'sortOrder'
  ].concat(COMMON_TAIL),

  JapaneseWords: [
    'id', 'tripId', 'category', 'ja', 'reading', 'ko', 'favorite', 'memo', 'sortOrder'
  ].concat(COMMON_TAIL),

  Stations: [
    'id', 'tripId', 'city', 'nameKo', 'nameJa', 'nameEn', 'lines', 'lineColor', 'stationNumber',
    'exits', 'recommendedExit', 'transfers', 'elevator', 'coinLocker', 'toilet', 'hotelRelation',
    'nearby', 'mapUrl', 'officialSite', 'photoUrl', 'favorite', 'memo'
  ].concat(COMMON_TAIL),

  Buses: [
    'id', 'tripId', 'city', 'company', 'lineName', 'fromStop', 'toStop', 'fromStopJa', 'toStopJa',
    'boardingPoint', 'boardingDoor', 'alightMethod', 'icCard', 'needTicket', 'paymentMethod',
    'fare', 'durationMinutes', 'firstBus', 'lastBus', 'officialSite', 'mapUrl', 'photoUrl', 'memo'
  ].concat(COMMON_TAIL),

  Routes: [
    'id', 'tripId', 'name', 'fromPlace', 'toPlace', 'steps', 'totalMinutes', 'totalCost',
    'lastTrain', 'caution', 'mapUrl', 'scheduleId', 'imageUrl', 'favorite', 'memo'
  ].concat(COMMON_TAIL),

  Expenses: [
    'id', 'tripId', 'date', 'category', 'title', 'amount', 'currency', 'payer', 'memo'
  ].concat(COMMON_TAIL),

  ActivityLogs: ['id', 'tripId', 'at', 'nickname', 'action', 'target', 'detail']
};

/** action 이름 -> 시트 이름 매핑 (일반 CRUD) */
var ENTITY_MAP = {
  schedule: 'Schedules',
  scheduleComment: 'ScheduleComments',
  reservation: 'Reservations',
  flight: 'Flights',
  accommodation: 'Accommodations',
  dailyRecord: 'DailyRecords',
  sharedRecord: 'SharedRecords',
  japanesePhrase: 'JapanesePhrases',
  japaneseWord: 'JapaneseWords',
  station: 'Stations',
  bus: 'Buses',
  route: 'Routes',
  expense: 'Expenses',
  photo: 'Photos',
  member: 'Members'
};

/** 여행 기본 정보로 Settings 시트에 저장되는 키 목록 */
var TRIP_KEYS = [
  'tripId', 'tripName', 'country', 'countryCode', 'city', 'startDate', 'endDate',
  'traveler1', 'traveler2', 'coverImage', 'intro', 'currency', 'timezone',
  'emergencyContact', 'createdAt', 'updatedAt'
];

/* ============================================================
 * 1. 진입점 (doGet / doPost)
 * ========================================================== */

/**
 * GET 요청 처리.
 * 브라우저에서 웹앱 URL을 그냥 열면 상태 확인용 JSON이 보입니다.
 * 데이터 요청도 ?action=... 형태로 가능합니다(간단 조회 및 연결 테스트용).
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    if (!params.action) {
      return jsonOut_({
        success: true,
        data: {
          app: 'BestOne in Japan API',
          version: APP_VERSION,
          serverTime: new Date().toISOString(),
          setup: quickSetupState_()
        },
        message: 'BestOne API 가 정상 동작 중입니다.'
      });
    }
    return handleRequest_(params);
  } catch (err) {
    return jsonOut_(fail_('SERVER_ERROR', '서버 오류: ' + (err && err.message ? err.message : err)));
  }
}

/**
 * POST 요청 처리.
 * 프런트엔드는 Content-Type: text/plain 으로 JSON 문자열을 보냅니다.
 * (브라우저 preflight(OPTIONS) 요청을 발생시키지 않기 위한 방식입니다.)
 */
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      var raw = e.postData.contents;
      // text/plain(JSON 문자열) 또는 form-urlencoded 모두 지원
      if (raw.charAt(0) === '{') {
        body = JSON.parse(raw);
      } else if (e.parameter && e.parameter.payload) {
        body = JSON.parse(e.parameter.payload);
      } else {
        body = e.parameter || {};
      }
    } else if (e && e.parameter) {
      body = e.parameter;
    }
    return handleRequest_(body);
  } catch (err) {
    return jsonOut_(fail_('BAD_REQUEST', '요청을 해석할 수 없습니다: ' + (err && err.message ? err.message : err)));
  }
}

/**
 * 실제 라우팅. action 값에 따라 기능을 분기합니다.
 */
function handleRequest_(req) {
  var action = String(req.action || '').trim();
  if (!action) return jsonOut_(fail_('NO_ACTION', 'action 값이 없습니다.'));

  // ---- 인증이 필요 없는 action ----
  if (action === 'ping') {
    return jsonOut_(ok_({ serverTime: new Date().toISOString(), version: APP_VERSION }, 'pong'));
  }
  if (action === 'login') return jsonOut_(apiLogin_(req));
  if (action === 'getPublicInfo') return jsonOut_(apiPublicInfo_());

  // ---- 여기부터는 세션 토큰 필요 ----
  var ctx = validateToken_(req.token);
  if (!ctx.valid) {
    return jsonOut_(fail_('INVALID_SESSION', ctx.message || '로그인이 만료되었습니다. 다시 로그인해 주세요.'));
  }

  try {
    switch (action) {
      case 'validateSession':
        return jsonOut_(ok_({ nickname: ctx.nickname, expiresAt: ctx.expiresAt }, '세션이 유효합니다.'));

      case 'logout':
        return jsonOut_(apiLogout_(req.token, ctx));

      case 'getBootstrapData':
        return jsonOut_(apiBootstrap_(ctx));

      case 'getToday':
        return jsonOut_(apiToday_(ctx, req.date));

      case 'getTrip':
        return jsonOut_(ok_({ trip: readTrip_() }, ''));

      case 'saveTrip':
        return jsonOut_(apiSaveTrip_(req, ctx));

      /* ------- 조회 ------- */
      case 'getSchedules':        return jsonOut_(listOut_('Schedules', 'schedules'));
      case 'getScheduleComments': return jsonOut_(listOut_('ScheduleComments', 'scheduleComments'));
      case 'getReservations':     return jsonOut_(listOut_('Reservations', 'reservations'));
      case 'getFlights':          return jsonOut_(listOut_('Flights', 'flights'));
      case 'getAccommodations':   return jsonOut_(listOut_('Accommodations', 'accommodations'));
      case 'getDailyRecords':     return jsonOut_(listOut_('DailyRecords', 'dailyRecords'));
      case 'getSharedRecords':    return jsonOut_(listOut_('SharedRecords', 'sharedRecords'));
      case 'getJapanesePhrases':  return jsonOut_(listOut_('JapanesePhrases', 'japanesePhrases'));
      case 'getJapaneseWords':    return jsonOut_(listOut_('JapaneseWords', 'japaneseWords'));
      case 'getStations':         return jsonOut_(listOut_('Stations', 'stations'));
      case 'getBuses':            return jsonOut_(listOut_('Buses', 'buses'));
      case 'getRoutes':           return jsonOut_(listOut_('Routes', 'routes'));
      case 'getExpenses':         return jsonOut_(listOut_('Expenses', 'expenses'));
      case 'getPhotos':           return jsonOut_(listOut_('Photos', 'photos'));
      case 'getMembers':          return jsonOut_(listOut_('Members', 'members'));

      /* ------- 저장 ------- */
      case 'saveSchedule':        return jsonOut_(saveEntity_('Schedules', req, ctx));
      case 'saveScheduleComment': return jsonOut_(saveEntity_('ScheduleComments', req, ctx));
      case 'saveReservation':     return jsonOut_(saveEntity_('Reservations', req, ctx));
      case 'saveFlight':          return jsonOut_(saveEntity_('Flights', req, ctx));
      case 'saveAccommodation':   return jsonOut_(saveEntity_('Accommodations', req, ctx));
      case 'saveDailyRecord':     return jsonOut_(saveEntity_('DailyRecords', req, ctx));
      case 'saveSharedRecord':    return jsonOut_(saveEntity_('SharedRecords', req, ctx));
      case 'saveJapanesePhrase':  return jsonOut_(saveEntity_('JapanesePhrases', req, ctx));
      case 'saveJapaneseWord':    return jsonOut_(saveEntity_('JapaneseWords', req, ctx));
      case 'saveStation':         return jsonOut_(saveEntity_('Stations', req, ctx));
      case 'saveBus':             return jsonOut_(saveEntity_('Buses', req, ctx));
      case 'saveRoute':           return jsonOut_(saveEntity_('Routes', req, ctx));
      case 'saveExpense':         return jsonOut_(saveEntity_('Expenses', req, ctx));
      case 'saveMember':          return jsonOut_(saveEntity_('Members', req, ctx));

      /* ------- 삭제 (isDeleted = true) ------- */
      case 'deleteSchedule':        return jsonOut_(deleteEntity_('Schedules', req, ctx));
      case 'deleteScheduleComment': return jsonOut_(deleteEntity_('ScheduleComments', req, ctx));
      case 'deleteReservation':     return jsonOut_(deleteEntity_('Reservations', req, ctx));
      case 'deleteFlight':          return jsonOut_(deleteEntity_('Flights', req, ctx));
      case 'deleteAccommodation':   return jsonOut_(deleteEntity_('Accommodations', req, ctx));
      case 'deleteDailyRecord':     return jsonOut_(deleteEntity_('DailyRecords', req, ctx));
      case 'deleteSharedRecord':    return jsonOut_(deleteEntity_('SharedRecords', req, ctx));
      case 'deleteJapanesePhrase':  return jsonOut_(deleteEntity_('JapanesePhrases', req, ctx));
      case 'deleteJapaneseWord':    return jsonOut_(deleteEntity_('JapaneseWords', req, ctx));
      case 'deleteStation':         return jsonOut_(deleteEntity_('Stations', req, ctx));
      case 'deleteBus':             return jsonOut_(deleteEntity_('Buses', req, ctx));
      case 'deleteRoute':           return jsonOut_(deleteEntity_('Routes', req, ctx));
      case 'deleteExpense':         return jsonOut_(deleteEntity_('Expenses', req, ctx));

      /* ------- 범용 CRUD (entity 이름으로) ------- */
      case 'saveEntity':   return jsonOut_(saveEntity_(entitySheet_(req.entity), req, ctx));
      case 'deleteEntity': return jsonOut_(deleteEntity_(entitySheet_(req.entity), req, ctx));

      /* ------- 이미지 ------- */
      case 'uploadImage': return jsonOut_(apiUploadImage_(req, ctx));
      case 'deleteImage': return jsonOut_(apiDeleteImage_(req, ctx));

      /* ------- 일정에 예약 추가 ------- */
      case 'addReservationToSchedule': return jsonOut_(apiReservationToSchedule_(req, ctx));

      /* ------- AI 도우미 (키는 스크립트 속성에만 있습니다) ------- */
      case 'aiChat':   return jsonOut_(apiAiChat_(req, ctx));
      case 'aiModels': return jsonOut_(apiAiModels_(req, ctx));
      case 'aiStatus': return jsonOut_(apiAiStatus_(req, ctx));

      default:
        return jsonOut_(fail_('UNKNOWN_ACTION', '알 수 없는 요청입니다: ' + action));
    }
  } catch (err) {
    logActivity_(ctx.nickname, 'ERROR', action, String(err && err.message ? err.message : err));
    return jsonOut_(fail_('SERVER_ERROR', '서버 오류가 발생했습니다: ' + (err && err.message ? err.message : err)));
  }
}

/* ============================================================
 * 2. 응답 유틸
 * ========================================================== */

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok_(data, message) {
  return { success: true, data: data || {}, message: message || '' };
}

function fail_(code, message) {
  return { success: false, error: code, message: message || '오류가 발생했습니다.' };
}

function listOut_(sheetName, key) {
  var data = {};
  data[key] = readSheetObjects_(sheetName, true);
  data.serverTime = new Date().toISOString();
  return ok_(data, '');
}

function entitySheet_(entity) {
  var name = ENTITY_MAP[String(entity || '')];
  if (!name) throw new Error('알 수 없는 entity 입니다: ' + entity);
  return name;
}

/* ============================================================
 * 3. Script Properties / 스프레드시트 접근
 * ========================================================== */

function props_() {
  return PropertiesService.getScriptProperties();
}

function prop_(key, fallback) {
  var v = props_().getProperty(key);
  return (v === null || v === undefined || v === '') ? (fallback === undefined ? '' : fallback) : v;
}

function getSpreadsheet_() {
  var id = prop_('SPREADSHEET_ID', '');
  if (!id) {
    // Script Properties 가 없으면 이 스크립트가 붙어있는 스프레드시트를 사용
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
    throw new Error('SPREADSHEET_ID 가 설정되지 않았습니다. 프로젝트 설정 > 스크립트 속성에서 추가해 주세요.');
  }
  return SpreadsheetApp.openById(id);
}

/** 시트를 얻고, 없으면 헤더와 함께 만듭니다. */
function getSheet_(name) {
  if (!SCHEMA[name]) throw new Error('정의되지 않은 시트입니다: ' + name);
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SCHEMA[name].length).setFontWeight('bold').setBackground('#f0ece1');
    protectDateTimeColumns_(sh, name, SCHEMA[name]);
  }
  return sh;
}

/** 시트의 헤더를 실제 시트에서 읽어옵니다(사용자가 열을 추가했을 수도 있으므로). */
function headersOf_(sh, name) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) {
    sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]);
    protectDateTimeColumns_(sh, name, SCHEMA[name]);
    return SCHEMA[name].slice();
  }
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || ''); });
  // 스키마에 있는데 시트에 없는 컬럼은 뒤에 추가
  var missing = [];
  SCHEMA[name].forEach(function (h) {
    if (headers.indexOf(h) === -1) missing.push(h);
  });
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    var newCols = [];
    for (var i = 0; i < missing.length; i++) newCols.push(headers.length + 1 + i);
    headers = headers.concat(missing);
    protectDateTimeColumns_(sh, name, headers, newCols);
  }
  return headers;
}

/**
 * 시트 전체를 객체 배열로 읽습니다.
 * @param {string} name 시트명
 * @param {boolean} skipDeleted isDeleted=true 인 행 제외 여부
 */
function readSheetObjects_(name, skipDeleted) {
  var sh = getSheet_(name);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h || ''); });
  var out = [];
  var keyCol = headers.indexOf('key');   // Settings 시트용
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var isEmpty = true;
    var obj = {};
    // Settings 시트는 key/value 구조라서 'value' 칸의 형식이 같은 행의 key 에 따라 달라집니다.
    var rowKey = (name === 'Settings' && keyCol >= 0) ? String(row[keyCol] || '') : '';
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = row[c];
      if (v instanceof Date) {
        var hint = (rowKey && headers[c] === 'value') ? rowKey : headers[c];
        v = formatDateTimeCell_(hint, v);
      }
      if (v !== '' && v !== null && v !== undefined) isEmpty = false;
      obj[headers[c]] = normalizeCell_(v);
    }
    if (isEmpty) continue;
    if (skipDeleted && isTrue_(obj.isDeleted)) continue;
    out.push(obj);
  }
  return out;
}

function normalizeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v;
  return String(v);
}

function isTrue_(v) {
  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';
}

/* ============================================================
 * 4. 인증 (로그인 / 세션)
 * ========================================================== */

/**
 * 비밀번호 해시 = SHA-256( salt + ':' + password ) 의 hex 문자열
 */
function hashPassword_(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ':' + String(password),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function apiPublicInfo_() {
  return ok_({
    appName: prop_('APP_NAME', 'BestOne in Japan'),
    tripCodeRequired: true,
    members: safeMemberNames_(),
    version: APP_VERSION
  }, '');
}

function safeMemberNames_() {
  try {
    var members = readSheetObjects_('Members', true);
    return members.map(function (m) {
      return { nickname: m.nickname, displayName: m.displayName, emoji: m.emoji, color: m.color };
    });
  } catch (e) {
    return [];
  }
}

/**
 * 로그인
 * 입력: tripCode, password, nickname
 */
function apiLogin_(req) {
  var tripCode = String(req.tripCode || '').trim();
  var password = String(req.password || '');
  var nickname = sanitizeText_(req.nickname, 40);

  if (!password) return fail_('NO_PASSWORD', '비밀번호를 입력해 주세요.');
  if (!nickname) return fail_('NO_NICKNAME', '사용자를 선택하거나 닉네임을 입력해 주세요.');

  var expectedCode = prop_('TRIP_CODE', '');
  if (expectedCode && tripCode.toLowerCase() !== expectedCode.toLowerCase()) {
    logActivity_(nickname, 'LOGIN_FAIL', 'tripCode', '');
    return fail_('INVALID_TRIP_CODE', '여행 코드가 올바르지 않습니다.');
  }

  var salt = prop_('PASSWORD_SALT', '');
  var hash = prop_('PASSWORD_HASH', '');
  if (!hash) {
    return fail_('NO_PASSWORD_SET', 'PASSWORD_HASH 가 설정되지 않았습니다. generatePasswordHash() 를 실행해 주세요.');
  }
  var given = hashPassword_(password, salt);
  if (given.toLowerCase() !== hash.trim().toLowerCase()) {
    logActivity_(nickname, 'LOGIN_FAIL', 'password', '');
    return fail_('INVALID_PASSWORD', '비밀번호가 올바르지 않습니다.');
  }

  // 멤버 등록(없으면 자동 추가)
  ensureMember_(nickname);

  var days = parseInt(prop_('SESSION_DAYS', '180'), 10);
  if (!days || days < 1) days = 180;
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var now = new Date();
  var expires = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  var sh = getSheet_('Sessions');
  sh.appendRow([
    token,
    prop_('TRIP_ID', 'trip-jp-001'),
    nickname,
    now.toISOString(),
    expires.toISOString(),
    now.toISOString(),
    sanitizeText_(req.device, 120)
  ]);
  cacheSession_(token, { nickname: nickname, expiresAt: expires.toISOString() });
  cleanupSessions_();
  logActivity_(nickname, 'LOGIN', '', '');

  return ok_({
    token: token,
    nickname: nickname,
    expiresAt: expires.toISOString(),
    trip: readTrip_()
  }, nickname + '님, 환영합니다!');
}

function apiLogout_(token, ctx) {
  var sh = getSheet_('Sessions');
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var values = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = values.length - 1; i >= 0; i--) {
      if (String(values[i][0]) === String(token)) {
        sh.deleteRow(i + 2);
        break;
      }
    }
  }
  CacheService.getScriptCache().remove('sess_' + token);
  logActivity_(ctx.nickname, 'LOGOUT', '', '');
  return ok_({}, '로그아웃되었습니다.');
}

function cacheSession_(token, obj) {
  try {
    CacheService.getScriptCache().put('sess_' + token, JSON.stringify(obj), 21600); // 6시간
  } catch (e) { /* 캐시는 실패해도 무시 */ }
}

/**
 * 세션 토큰 검증.
 * 시트 접근을 줄이기 위해 CacheService 를 먼저 확인합니다.
 */
function validateToken_(token) {
  token = String(token || '').trim();
  if (!token) return { valid: false, message: '로그인이 필요합니다.' };

  var cached = null;
  try { cached = CacheService.getScriptCache().get('sess_' + token); } catch (e) { cached = null; }
  if (cached) {
    var c = JSON.parse(cached);
    if (new Date(c.expiresAt).getTime() > Date.now()) {
      return { valid: true, nickname: c.nickname, expiresAt: c.expiresAt, token: token };
    }
  }

  var sh = getSheet_('Sessions');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { valid: false, message: '로그인이 만료되었습니다. 다시 로그인해 주세요.' };
  var values = sh.getRange(2, 1, lastRow - 1, 5).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === token) {
      var expiresAt = values[i][4];
      var exp = (expiresAt instanceof Date) ? expiresAt : new Date(String(expiresAt));
      if (exp.getTime() < Date.now()) {
        return { valid: false, message: '로그인이 만료되었습니다. 다시 로그인해 주세요.' };
      }
      var nickname = String(values[i][2]);
      cacheSession_(token, { nickname: nickname, expiresAt: exp.toISOString() });
      return { valid: true, nickname: nickname, expiresAt: exp.toISOString(), token: token };
    }
  }
  return { valid: false, message: '로그인 정보가 확인되지 않습니다. 다시 로그인해 주세요.' };
}

/** 만료된 세션 정리 (100행 넘을 때만 수행) */
function cleanupSessions_() {
  var sh = getSheet_('Sessions');
  var lastRow = sh.getLastRow();
  if (lastRow < 100) return;
  var values = sh.getRange(2, 1, lastRow - 1, 5).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var exp = values[i][4];
    var d = (exp instanceof Date) ? exp : new Date(String(exp));
    if (!d.getTime() || d.getTime() < Date.now()) sh.deleteRow(i + 2);
  }
}

function ensureMember_(nickname) {
  var members = readSheetObjects_('Members', true);
  for (var i = 0; i < members.length; i++) {
    if (String(members[i].nickname) === nickname) return members[i];
  }
  var palette = ['#f2c14e', '#7d9db3'];
  var emojis = ['⭐', '🐘']; // ⭐ / 🐘
  var idx = members.length % 2;
  var rec = {
    id: Utilities.getUuid(),
    tripId: prop_('TRIP_ID', 'trip-jp-001'),
    nickname: nickname,
    displayName: nickname,
    emoji: emojis[idx],
    color: palette[idx],
    role: members.length === 0 ? 'owner' : 'partner',
    createdBy: nickname,
    createdAt: new Date().toISOString(),
    updatedBy: nickname,
    updatedAt: new Date().toISOString(),
    isDeleted: false,
    isSample: false
  };
  appendObject_('Members', rec);
  return rec;
}

/* ============================================================
 * 5. 입력값 검증 / 정제
 * ========================================================== */

/** HTML 태그 제거 + 길이 제한 */
function sanitizeText_(v, maxLen) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  var s = String(v);
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');       // HTML 태그 제거
  s = s.replace(/javascript\s*:/gi, '');           // javascript: 스킴 제거
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // 제어문자 제거(줄바꿈/탭은 유지)
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  return s;
}

/**
 * http/https 링크만 허용합니다.
 * 사진·파일을 여러 장 붙일 수 있도록, 줄바꿈으로 구분된 여러 개의 주소를 받습니다.
 * (각 줄을 따로 검사하므로 이상한 값이 섞여 있으면 그 줄만 버립니다)
 */
function sanitizeUrl_(v) {
  var raw = String(v || '').trim();
  if (!raw) return '';
  var list = raw.split(/[\r\n]+/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return /^https?:\/\//i.test(x); })
    .map(function (x) { return x.substring(0, 600); });
  if (!list.length) return '';
  return list.slice(0, 40).join('\n');   // 한 항목에 최대 40장
}

var URL_FIELDS = {
  mapUrl: 1, bookingSite: 1, officialSite: 1, ticketUrl: 1, qrImageUrl: 1,
  photoUrl: 1, imageUrl: 1, url: 1, viewUrl: 1, coverImage: 1
};

function sanitizeRecord_(rec) {
  var out = {};
  Object.keys(rec || {}).forEach(function (k) {
    var v = rec[k];
    if (v === null || v === undefined) { out[k] = ''; return; }
    if (URL_FIELDS[k]) { out[k] = sanitizeUrl_(v); return; }
    if (k === 'steps') { out[k] = sanitizeText_(v, 8000); return; }
    if (typeof v === 'object') { out[k] = sanitizeText_(JSON.stringify(v), 8000); return; }
    out[k] = sanitizeText_(v, 4000);
  });
  return out;
}

/* ============================================================
 * 6. 범용 저장 / 삭제 (충돌 방지 포함)
 * ========================================================== */

function appendObject_(sheetName, obj) {
  var sh = getSheet_(sheetName);
  var headers = headersOf_(sh, sheetName);
  var row = headers.map(function (h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
  sh.appendRow(row);
  return obj;
}

/**
 * 저장(신규/수정 공통).
 * 요청 형식: { action:'saveSchedule', token:'...', record:{...}, force:false }
 * - record.id 가 없으면 신규 생성(UUID 발급)
 * - record.id 가 있으면 수정. 이때 record.updatedAt(클라이언트가 알고 있는 값)과
 *   서버의 updatedAt 을 비교하여 다르면 CONFLICT 를 돌려줍니다.
 */
function saveEntity_(sheetName, req, ctx) {
  var record = req.record || req.data || {};
  if (typeof record === 'string') record = JSON.parse(record);
  record = sanitizeRecord_(record);

  var vErr = validateRecord_(sheetName, record);
  if (vErr) return fail_('VALIDATION_ERROR', vErr);

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (e) {
    return fail_('BUSY', '다른 저장이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  }

  try {
    var sh = getSheet_(sheetName);
    var headers = headersOf_(sh, sheetName);
    var lastRow = sh.getLastRow();
    var idCol = headers.indexOf('id');
    var updatedAtCol = headers.indexOf('updatedAt');
    var nowIso = new Date().toISOString();
    var tripId = prop_('TRIP_ID', 'trip-jp-001');

    var targetRow = -1;
    var existing = null;

    if (record.id && lastRow >= 2 && idCol >= 0) {
      var idValues = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < idValues.length; i++) {
        if (String(idValues[i][0]) === String(record.id)) { targetRow = i + 2; break; }
      }
    }

    if (targetRow > 0) {
      // ---- 수정 ----
      var rowValues = sh.getRange(targetRow, 1, 1, headers.length).getValues()[0];
      existing = {};
      headers.forEach(function (h, idx) {
        var val = rowValues[idx];
        if (val instanceof Date) val = formatDateTimeCell_(h, val);
        existing[h] = normalizeCell_(val);
      });

      // 충돌 검사
      var force = isTrue_(req.force);
      var clientUpdatedAt = String(req.baseUpdatedAt || record.updatedAt || '');
      var serverUpdatedAt = String(existing.updatedAt || '');
      if (!force && serverUpdatedAt && clientUpdatedAt && serverUpdatedAt !== clientUpdatedAt) {
        return {
          success: false,
          error: 'CONFLICT',
          message: '다른 사람이 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.',
          data: { server: existing }
        };
      }

      var merged = {};
      headers.forEach(function (h) { merged[h] = existing[h]; });
      Object.keys(record).forEach(function (k) {
        if (headers.indexOf(k) === -1) return;
        if (k === 'createdAt' || k === 'createdBy' || k === 'id') return;
        merged[k] = record[k];
      });
      merged.tripId = merged.tripId || tripId;
      merged.updatedBy = ctx.nickname;
      merged.updatedAt = nowIso;
      if (merged.isDeleted === '' || merged.isDeleted === undefined) merged.isDeleted = false;

      var newRow = headers.map(function (h) {
        var v = merged[h];
        return (v === undefined || v === null) ? '' : v;
      });
      sh.getRange(targetRow, 1, 1, headers.length).setValues([newRow]);
      logActivity_(ctx.nickname, 'UPDATE', sheetName, String(merged.id));
      return ok_({ record: merged, sheet: sheetName }, '저장되었습니다.');

    } else {
      // ---- 신규 ----
      var fresh = {};
      headers.forEach(function (h) { fresh[h] = ''; });
      Object.keys(record).forEach(function (k) {
        if (headers.indexOf(k) !== -1) fresh[k] = record[k];
      });
      fresh.id = record.id || Utilities.getUuid();
      fresh.tripId = fresh.tripId || tripId;
      fresh.createdBy = ctx.nickname;
      fresh.createdAt = nowIso;
      fresh.updatedBy = ctx.nickname;
      fresh.updatedAt = nowIso;
      fresh.isDeleted = false;
      if (fresh.isSample === '' ) fresh.isSample = false;

      var appendRowValues = headers.map(function (h) {
        var v = fresh[h];
        return (v === undefined || v === null) ? '' : v;
      });
      sh.appendRow(appendRowValues);
      logActivity_(ctx.nickname, 'CREATE', sheetName, String(fresh.id));
      return ok_({ record: fresh, sheet: sheetName }, '저장되었습니다.');
    }
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 소프트 삭제 (isDeleted = true) */
function deleteEntity_(sheetName, req, ctx) {
  var id = String(req.id || (req.record && req.record.id) || '').trim();
  if (!id) return fail_('NO_ID', '삭제할 항목의 id 가 없습니다.');

  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) {
    return fail_('BUSY', '다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  }
  try {
    var sh = getSheet_(sheetName);
    var headers = headersOf_(sh, sheetName);
    var lastRow = sh.getLastRow();
    var idCol = headers.indexOf('id');
    var delCol = headers.indexOf('isDeleted');
    var upByCol = headers.indexOf('updatedBy');
    var upAtCol = headers.indexOf('updatedAt');
    if (lastRow < 2 || idCol < 0) return fail_('NOT_FOUND', '항목을 찾을 수 없습니다.');

    var idValues = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0]) === id) {
        var row = i + 2;
        if (delCol >= 0) sh.getRange(row, delCol + 1).setValue(true);
        if (upByCol >= 0) sh.getRange(row, upByCol + 1).setValue(ctx.nickname);
        if (upAtCol >= 0) sh.getRange(row, upAtCol + 1).setValue(new Date().toISOString());
        logActivity_(ctx.nickname, 'DELETE', sheetName, id);
        return ok_({ id: id, sheet: sheetName }, '삭제되었습니다.');
      }
    }
    return fail_('NOT_FOUND', '항목을 찾을 수 없습니다.');
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 시트별 최소 필수값 검증 */
function validateRecord_(sheetName, rec) {
  function need(field, label) {
    if (!rec[field] && rec[field] !== 0) return label + '을(를) 입력해 주세요.';
    return null;
  }
  switch (sheetName) {
    case 'Schedules':
      return need('date', '날짜') || need('title', '일정 제목');
    case 'Flights':
      return need('date', '출발일') || need('flightNo', '편명');
    case 'Accommodations':
      return need('name', '호텔명');
    case 'Reservations':
      return need('title', '예약명') || need('type', '예약 유형');
    case 'DailyRecords':
      return need('date', '날짜') || need('author', '작성자');
    case 'SharedRecords':
      return need('date', '날짜');
    case 'JapanesePhrases':
      return need('ko', '한국어') || need('ja', '일본어');
    case 'JapaneseWords':
      return need('ja', '일본어') || need('ko', '한국어');
    case 'Stations':
      return need('nameKo', '역 이름');
    case 'Buses':
      return need('lineName', '노선명 또는 번호');
    case 'Routes':
      return need('name', '경로명');
    case 'Expenses':
      return need('date', '날짜') || need('title', '내용');
    case 'ScheduleComments':
      return need('scheduleId', '일정') || need('text', '내용');
    default:
      return null;
  }
}

/* ============================================================
 * 7. 여행 기본 정보 (Settings 시트)
 * ========================================================== */

function readSettingsMap_() {
  var rows = readSheetObjects_('Settings', false);
  var map = {};
  rows.forEach(function (r) {
    if (r.key) map[String(r.key)] = r.value;
  });
  return map;
}

function readTrip_() {
  var map = readSettingsMap_();
  var trip = {};
  TRIP_KEYS.forEach(function (k) { trip[k] = map[k] !== undefined ? map[k] : ''; });
  if (!trip.tripId) trip.tripId = prop_('TRIP_ID', 'trip-jp-001');
  return trip;
}

function writeSetting_(key, value) {
  var sh = getSheet_('Settings');
  var lastRow = sh.getLastRow();
  var nowIso = new Date().toISOString();
  if (lastRow >= 2) {
    var keys = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(key)) {
        sh.getRange(i + 2, 2, 1, 2).setValues([[value, nowIso]]);
        return;
      }
    }
  }
  sh.appendRow([key, value, nowIso]);
}

function apiSaveTrip_(req, ctx) {
  var trip = req.trip || req.record || {};
  if (typeof trip === 'string') trip = JSON.parse(trip);
  trip = sanitizeRecord_(trip);

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return fail_('BUSY', '다른 저장이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  }
  try {
    var current = readTrip_();
    TRIP_KEYS.forEach(function (k) {
      if (k === 'createdAt' || k === 'updatedAt') return;
      if (trip[k] !== undefined) writeSetting_(k, trip[k]);
    });
    if (!current.createdAt) writeSetting_('createdAt', new Date().toISOString());
    writeSetting_('updatedAt', new Date().toISOString());
    logActivity_(ctx.nickname, 'UPDATE', 'Trip', '');
    return ok_({ trip: readTrip_() }, '여행 정보가 저장되었습니다.');
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ============================================================
 * 8. Bootstrap / Today
 * ========================================================== */

/**
 * 앱을 시작할 때 필요한 모든 데이터를 한 번에 반환합니다.
 * (Apps Script 실행 제한을 고려해 요청 횟수를 최소화하기 위함)
 */
function apiBootstrap_(ctx) {
  var data = {
    trip: readTrip_(),
    members: readSheetObjects_('Members', true),
    flights: readSheetObjects_('Flights', true),
    accommodations: readSheetObjects_('Accommodations', true),
    reservations: readSheetObjects_('Reservations', true),
    schedules: readSheetObjects_('Schedules', true),
    scheduleComments: readSheetObjects_('ScheduleComments', true),
    dailyRecords: readSheetObjects_('DailyRecords', true),
    sharedRecords: readSheetObjects_('SharedRecords', true),
    japanesePhrases: readSheetObjects_('JapanesePhrases', true),
    japaneseWords: readSheetObjects_('JapaneseWords', true),
    stations: readSheetObjects_('Stations', true),
    buses: readSheetObjects_('Buses', true),
    routes: readSheetObjects_('Routes', true),
    expenses: readSheetObjects_('Expenses', true),
    photos: readSheetObjects_('Photos', true),
    me: ctx.nickname,
    serverTime: new Date().toISOString(),
    todayJst: todayJst_(),
    // AI 도우미를 서버 키로 쓸 수 있는지 (키 자체는 절대 보내지 않습니다)
    aiReady: aiServerReady_(),
    aiModels: aiServerReady_() ? aiServerModels_() : []
  };
  return ok_(data, '');
}

function todayJst_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * 오늘 화면에 필요한 데이터만 모아서 반환합니다.
 */
function apiToday_(ctx, dateStr) {
  var date = sanitizeText_(dateStr, 10) || todayJst_();
  var schedules = readSheetObjects_('Schedules', true).filter(function (s) { return s.date === date; });
  var flights = readSheetObjects_('Flights', true).filter(function (f) { return f.date === date; });
  var accs = readSheetObjects_('Accommodations', true).filter(function (a) {
    return a.checkInDate <= date && date <= (a.checkOutDate || a.checkInDate);
  });
  var reservations = readSheetObjects_('Reservations', true).filter(function (r) { return r.date === date; });
  var records = readSheetObjects_('DailyRecords', true).filter(function (r) { return r.date === date; });
  var shared = readSheetObjects_('SharedRecords', true).filter(function (r) { return r.date === date; });
  var routes = readSheetObjects_('Routes', true);
  return ok_({
    date: date,
    schedules: schedules,
    flights: flights,
    accommodations: accs,
    reservations: reservations,
    dailyRecords: records,
    sharedRecords: shared,
    routes: routes,
    serverTime: new Date().toISOString()
  }, '');
}

/** 예약을 일정으로 복사 */
function apiReservationToSchedule_(req, ctx) {
  var reservationId = String(req.reservationId || '');
  var list = readSheetObjects_('Reservations', true);
  var found = null;
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === reservationId) { found = list[i]; break; }
  }
  if (!found) return fail_('NOT_FOUND', '예약을 찾을 수 없습니다.');

  var record = {
    date: found.date,
    startTime: found.startTime,
    endTime: found.endTime,
    category: found.type || 'etc',
    title: found.title,
    place: found.place || found.meetingPoint,
    description: found.memo,
    mapUrl: found.mapUrl,
    reservationId: found.id,
    prepare: found.prepare,
    transport: found.transport,
    author: ctx.nickname
  };
  return saveEntity_('Schedules', { record: record }, ctx);
}

/* ============================================================
 * 9. 이미지 업로드 (Google Drive)
 * ========================================================== */

function getDriveFolder_() {
  var id = prop_('DRIVE_FOLDER_ID', '');
  if (!id) throw new Error('DRIVE_FOLDER_ID 가 설정되지 않았습니다. 프로젝트 설정 > 스크립트 속성에서 추가해 주세요.');
  return DriveApp.getFolderById(id);
}

/**
 * 이미지 업로드
 * 요청: { action:'uploadImage', token, base64, mimeType, name, refType, refId, date }
 * base64 는 "data:image/jpeg;base64,...." 형태 또는 순수 base64 문자열 모두 지원합니다.
 */
function apiUploadImage_(req, ctx) {
  var base64 = String(req.base64 || req.dataUrl || '');
  if (!base64) return fail_('NO_IMAGE', '업로드할 이미지가 없습니다.');

  var mimeType = sanitizeText_(req.mimeType, 60) || 'image/jpeg';
  var m = base64.match(/^data:([^;]+);base64,(.*)$/);
  if (m) {
    mimeType = m[1];
    base64 = m[2];
  }
  var allowed = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'application/pdf': 1 };
  if (!allowed[mimeType]) {
    return fail_('BAD_MIME', '지원하지 않는 파일 형식입니다. (JPEG, PNG, WebP, PDF 만 가능)');
  }
  // 대략적인 용량 제한 (base64 는 원본의 약 1.37배)
  if (base64.length > 12 * 1024 * 1024) {
    return fail_('TOO_LARGE', '파일이 너무 큽니다. 더 작은 이미지를 선택해 주세요.');
  }

  var name = sanitizeText_(req.name, 100) ||
    ('bestone_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss'));

  try {
    var folder = getDriveFolder_();
    var bytes = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(bytes, mimeType, name);
    var file = folder.createFile(blob);

    // 링크가 있는 사람은 볼 수 있도록 설정 (README 의 개인정보 안내를 꼭 읽어주세요)
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      // 조직 정책 등으로 실패할 수 있습니다. 파일 자체는 저장됩니다.
    }

    var fileId = file.getId();
    var url = (mimeType === 'application/pdf')
      ? ('https://drive.google.com/file/d/' + fileId + '/preview')
      : ('https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1600');
    var viewUrl = 'https://drive.google.com/file/d/' + fileId + '/view';

    var rec = {
      id: Utilities.getUuid(),
      tripId: prop_('TRIP_ID', 'trip-jp-001'),
      fileId: fileId,
      url: url,
      viewUrl: viewUrl,
      name: name,
      mimeType: mimeType,
      size: bytes.length,
      refType: sanitizeText_(req.refType, 40),
      refId: sanitizeText_(req.refId, 60),
      date: sanitizeText_(req.date, 10),
      createdBy: ctx.nickname,
      createdAt: new Date().toISOString(),
      updatedBy: ctx.nickname,
      updatedAt: new Date().toISOString(),
      isDeleted: false,
      isSample: false
    };
    appendObject_('Photos', rec);
    logActivity_(ctx.nickname, 'UPLOAD', 'Photos', fileId);
    return ok_({ photo: rec }, '사진이 업로드되었습니다.');
  } catch (err) {
    return fail_('UPLOAD_FAILED', '업로드에 실패했습니다: ' + (err && err.message ? err.message : err));
  }
}

function apiDeleteImage_(req, ctx) {
  var id = String(req.id || '');
  var fileId = String(req.fileId || '');
  var photos = readSheetObjects_('Photos', true);
  var target = null;
  for (var i = 0; i < photos.length; i++) {
    if ((id && String(photos[i].id) === id) || (fileId && String(photos[i].fileId) === fileId)) {
      target = photos[i]; break;
    }
  }
  if (!target) return fail_('NOT_FOUND', '사진 정보를 찾을 수 없습니다.');

  try {
    if (target.fileId) DriveApp.getFileById(target.fileId).setTrashed(true);
  } catch (e) {
    // Drive 에서 이미 지워졌을 수 있습니다.
  }
  return deleteEntity_('Photos', { id: target.id }, ctx);
}

/* ============================================================
 * 10. 활동 로그
 * ========================================================== */

function logActivity_(nickname, action, target, detail) {
  try {
    var sh = getSheet_('ActivityLogs');
    sh.appendRow([
      Utilities.getUuid(),
      prop_('TRIP_ID', 'trip-jp-001'),
      new Date().toISOString(),
      String(nickname || ''),
      String(action || ''),
      String(target || ''),
      String(detail || '').substring(0, 500)
    ]);
    // 로그가 너무 많아지면 오래된 것부터 정리
    var lastRow = sh.getLastRow();
    if (lastRow > 3000) sh.deleteRows(2, 1000);
  } catch (e) { /* 로그 실패는 무시 */ }
}

/* ============================================================
 * 10-2. AI 도우미 (Google Gemini) 중계
 * ------------------------------------------------------------
 * ★ API 키를 브라우저에 두지 않기 위한 부분입니다.
 *
 *   [브라우저] --(세션 토큰)--> [이 스크립트] --(API 키)--> [Gemini]
 *
 * 키는 스크립트 속성 GEMINI_API_KEY 에만 있고, 브라우저로는 절대
 * 내려가지 않습니다. 로그인한 사람만(= 유효한 세션 토큰이 있는 사람만)
 * 이 기능을 쓸 수 있으므로, 주소를 안다고 해서 남이 내 키를 쓸 수 없습니다.
 *
 * 스크립트 속성 (프로젝트 설정 > 스크립트 속성)
 *   GEMINI_API_KEY  : AI Studio 에서 만든 키 (필수)
 *   GEMINI_MODELS   : 쉼표로 구분한 모델 순서 (선택, 없으면 아래 기본값)
 *   GEMINI_BASE     : API 주소 (선택, 보통 건드리지 않습니다)
 * ========================================================== */

/** 스크립트 속성에 모델 순서가 없을 때 쓰는 기본값 */
var AI_DEFAULT_MODELS_ = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-2.5-flash-lite'
];

var AI_BASE_DEFAULT_ = 'https://generativelanguage.googleapis.com/v1beta';

/** 서버에 AI 키가 준비되어 있는지 */
function aiServerReady_() {
  return !!prop_('GEMINI_API_KEY', '');
}

function aiBase_() {
  var b = String(prop_('GEMINI_BASE', AI_BASE_DEFAULT_) || AI_BASE_DEFAULT_);
  return b.replace(/\/+$/, '');
}

/** 서버가 정한 모델 순서 */
function aiServerModels_() {
  var raw = prop_('GEMINI_MODELS', '');
  if (!raw) return AI_DEFAULT_MODELS_.slice();
  var list = String(raw).split(/[,\n]/).map(function (s) {
    return String(s || '').trim().replace(/^models\//, '');
  }).filter(Boolean);
  return list.length ? list : AI_DEFAULT_MODELS_.slice();
}

/**
 * 브라우저가 보낸 모델 이름은 그대로 믿지 않고 형태만 확인합니다.
 * (이상한 문자가 섞여 다른 주소를 부르는 일이 없도록)
 */
function aiSanitizeModels_(arr) {
  if (!arr || !arr.length) return [];
  var out = [];
  for (var i = 0; i < arr.length && out.length < 8; i++) {
    var m = String(arr[i] || '').trim().replace(/^models\//, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(m)) continue;
    if (out.indexOf(m) < 0) out.push(m);
  }
  return out;
}

/**
 * 실패 응답을 보고 "다음 모델로 넘어갈 것"과
 * "넘어가도 소용없는 것(키 문제)"을 구분합니다.
 */
function aiClassifyError_(status, bodyText) {
  var msg = '';
  var gstatus = '';
  try {
    var j = JSON.parse(bodyText);
    if (j && j.error) {
      msg = String(j.error.message || '');
      gstatus = String(j.error.status || '');
    }
  } catch (e) { /* 본문이 JSON 이 아닐 수 있습니다 */ }

  if (/API_KEY_INVALID|API key not valid/i.test(bodyText) ||
      status === 401 || gstatus === 'UNAUTHENTICATED') {
    return { fatal: true, message: 'GEMINI_API_KEY 가 올바르지 않습니다. 스크립트 속성을 다시 확인해 주세요.' };
  }
  if (status === 403 || gstatus === 'PERMISSION_DENIED') {
    return {
      fatal: true,
      message: 'API 키가 거부되었습니다. AI Studio 에서 키가 활성 상태인지, ' +
               '키에 걸어둔 사용 제한이 이 스크립트를 막고 있지 않은지 확인해 주세요.'
    };
  }
  return { fatal: false, message: msg || ('HTTP ' + status) };
}

/**
 * AI 답변 요청. 키는 서버에만 있고 응답에도 포함하지 않습니다.
 *
 * 요청 형식
 *   { action:'aiChat', token, system, contents:[{role,text}], models:[...], useSearch:true }
 * 응답 형식
 *   { text, model, index, total, grounded }
 */
function apiAiChat_(req, ctx) {
  var key = prop_('GEMINI_API_KEY', '');
  if (!key) {
    return fail_('AI_NO_KEY',
      '서버에 Gemini API 키가 없습니다. Apps Script 의 [프로젝트 설정 > 스크립트 속성] 에 ' +
      'GEMINI_API_KEY 를 추가한 뒤 다시 시도해 주세요.');
  }

  // 모델 순서 : 사용자가 앱에서 고른 순서가 있으면 그것을 쓰고, 없으면 서버 기본값
  var models = aiSanitizeModels_(req.models);
  if (!models.length) models = aiServerModels_();
  if (!models.length) return fail_('AI_NO_MODEL', '사용할 모델이 정해져 있지 않습니다.');

  // 대화 내용 정리 (너무 긴 요청은 잘라냅니다)
  var contents = [];
  var src = req.contents || [];
  for (var i = 0; i < src.length && i < 40; i++) {
    var role = (src[i] && src[i].role === 'model') ? 'model' : 'user';
    var text = String((src[i] && src[i].text) || '').substring(0, 8000);
    if (!text) continue;
    contents.push({ role: role, parts: [{ text: text }] });
  }
  if (!contents.length) return fail_('AI_NO_INPUT', '보낼 내용이 없습니다.');

  var system = String(req.system || '').substring(0, 20000);
  var useSearch = req.useSearch !== false;
  var maxTokens = Math.min(Math.max(parseInt(req.maxOutputTokens, 10) || 1400, 128), 8192);

  var base = aiBase_();
  var errors = [];

  for (var mi = 0; mi < models.length; mi++) {
    var model = models[mi];

    // 검색 도구를 켜고 먼저 시도 → 도구를 지원하지 않으면 끄고 한 번 더
    var tries = useSearch ? [true, false] : [false];

    for (var t = 0; t < tries.length; t++) {
      var payload = {
        contents: contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens }
      };
      if (system) payload.systemInstruction = { parts: [{ text: system }] };
      if (tries[t]) payload.tools = [{ google_search: {} }];

      var url = base + '/models/' + encodeURIComponent(model) +
                ':generateContent?key=' + encodeURIComponent(key);

      var res, code, body;
      try {
        res = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        code = res.getResponseCode();
        body = res.getContentText();
      } catch (err) {
        errors.push(model + ': 연결 실패');
        break;   // 연결 문제면 도구만 바꿔도 소용없으니 다음 모델로
      }

      if (code < 200 || code >= 300) {
        // 검색 도구를 지원하지 않는 모델이면 도구 없이 다시 시도
        if (tries[t] && /tool|google_search|function/i.test(body)) continue;
        var info = aiClassifyError_(code, body);
        if (info.fatal) return fail_('AI_KEY_ERROR', info.message);
        errors.push(model + ': ' + info.message);
        break;
      }

      var json;
      try { json = JSON.parse(body); } catch (e2) {
        errors.push(model + ': 응답 해석 실패');
        break;
      }

      var cand = json.candidates && json.candidates[0];
      var parts = (cand && cand.content && cand.content.parts) || [];
      var out = '';
      for (var p = 0; p < parts.length; p++) out += (parts[p].text || '');
      out = out.replace(/^\s+|\s+$/g, '');

      if (!out) {
        errors.push(model + ': 빈 응답' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''));
        break;
      }

      return ok_({
        text: out,
        model: model,
        index: mi,
        total: models.length,
        grounded: !!(cand.groundingMetadata || cand.grounding_metadata)
      }, '');
    }
  }

  return fail_('AI_FAILED',
    '모든 모델을 시도했지만 답을 받지 못했습니다.\n' + errors.join('\n'));
}

/**
 * 서버 키로 실제 쓸 수 있는 모델 목록을 알려줍니다.
 * (구글이 모델 이름을 바꿨을 때 앱에서 바로 확인할 수 있도록)
 */
function apiAiModels_(req, ctx) {
  var key = prop_('GEMINI_API_KEY', '');
  if (!key) {
    return fail_('AI_NO_KEY',
      '서버에 Gemini API 키가 없습니다. [프로젝트 설정 > 스크립트 속성] 에 GEMINI_API_KEY 를 추가해 주세요.');
  }

  var cache = CacheService.getScriptCache();
  var cached = cache.get('aiModelList');
  if (cached && req.fresh !== true) {
    try { return ok_({ models: JSON.parse(cached), cached: true }, ''); } catch (e) { /* 무시 */ }
  }

  var url = aiBase_() + '/models?pageSize=200&key=' + encodeURIComponent(key);
  var res, code, body;
  try {
    res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    code = res.getResponseCode();
    body = res.getContentText();
  } catch (err) {
    return fail_('AI_LIST_FAILED', '모델 목록을 불러오지 못했습니다: 연결 실패');
  }

  if (code < 200 || code >= 300) {
    var info = aiClassifyError_(code, body);
    return fail_('AI_LIST_FAILED', info.message);
  }

  var json;
  try { json = JSON.parse(body); } catch (e3) {
    return fail_('AI_LIST_FAILED', '모델 목록 응답을 해석하지 못했습니다.');
  }

  var list = [];
  var arr = json.models || [];
  for (var i = 0; i < arr.length; i++) {
    var methods = arr[i].supportedGenerationMethods || arr[i].supported_generation_methods || [];
    if (methods.indexOf('generateContent') < 0) continue;
    var name = String(arr[i].name || '').replace(/^models\//, '');
    if (name) list.push(name);
  }

  try { cache.put('aiModelList', JSON.stringify(list), 1800); } catch (e4) { /* 무시 */ }
  return ok_({ models: list, cached: false }, '');
}

/** 앱이 "서버 키가 준비됐는지 / 서버가 정한 모델 순서" 를 물어볼 때 */
function apiAiStatus_(req, ctx) {
  return ok_({
    ready: aiServerReady_(),
    models: aiServerReady_() ? aiServerModels_() : []
  }, '');
}

/* ============================================================
 * 11. 설치 / 초기화 함수 (사용자가 직접 실행)
 * ========================================================== */

/**
 * ★ 1번으로 실행하세요.
 * 필요한 시트와 헤더, 기본 설정값을 만듭니다.
 * 여러 번 실행해도 기존 데이터는 지워지지 않습니다.
 */
function setupBestOneProject() {
  var log = [];
  var ss;
  try {
    ss = getSpreadsheet_();
  } catch (e) {
    Logger.log('[실패] ' + e.message);
    throw e;
  }
  log.push('스프레드시트: ' + ss.getName() + ' (' + ss.getId() + ')');

  // SPREADSHEET_ID 가 비어 있으면 현재 스프레드시트 ID 로 자동 저장
  if (!prop_('SPREADSHEET_ID', '')) {
    props_().setProperty('SPREADSHEET_ID', ss.getId());
    log.push('SPREADSHEET_ID 를 자동으로 설정했습니다: ' + ss.getId());
  }

  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, SCHEMA[name].length).setFontWeight('bold').setBackground('#f0ece1');
      sh.setColumnWidth(1, 180);
      log.push('[생성] 시트 ' + name);
    } else {
      headersOf_(sh, name); // 부족한 헤더 보충
      log.push('[유지] 시트 ' + name + ' (이미 있음)');
    }
  });

  // 기본 설정값 (없을 때만)
  var settings = readSettingsMap_();
  var tripId = prop_('TRIP_ID', '');
  if (!tripId) {
    tripId = 'trip-jp-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    props_().setProperty('TRIP_ID', tripId);
    log.push('TRIP_ID 를 자동 생성했습니다: ' + tripId);
  }
  var defaults = {
    tripId: tripId,
    tripName: '우리의 일본 여행',
    country: '일본',
    countryCode: 'JP',
    city: '도쿄',
    startDate: '',
    endDate: '',
    traveler1: 'chichiboo',
    traveler2: 'neederes',
    coverImage: '',
    intro: '어린왕자와 코끼리의 일본 여행',
    currency: 'JPY',
    timezone: 'Asia/Tokyo',
    emergencyContact: '주일본 대한민국 대사관 +81-3-3452-7611 / 일본 경찰 110 / 구급·소방 119',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  Object.keys(defaults).forEach(function (k) {
    if (settings[k] === undefined || settings[k] === '') {
      if (k === 'startDate' || k === 'endDate') {
        writeSetting_(k, defaults[k]);
      } else {
        writeSetting_(k, defaults[k]);
      }
      log.push('[설정] ' + k + ' = ' + defaults[k]);
    }
  });

  // 기본 멤버
  var members = readSheetObjects_('Members', true);
  if (members.length === 0) {
    ensureMember_(defaults.traveler1);
    ensureMember_(defaults.traveler2);
    log.push('[생성] 기본 멤버 2명 (' + defaults.traveler1 + ', ' + defaults.traveler2 + ')');
  }

  // Drive 폴더 확인
  var folderId = prop_('DRIVE_FOLDER_ID', '');
  if (!folderId) {
    log.push('[주의] DRIVE_FOLDER_ID 가 없습니다. 사진 업로드를 쓰려면 폴더 ID를 스크립트 속성에 추가하세요.');
  } else {
    try {
      var f = DriveApp.getFolderById(folderId);
      log.push('[확인] Drive 폴더: ' + f.getName());
    } catch (e) {
      log.push('[오류] DRIVE_FOLDER_ID 로 폴더를 열 수 없습니다: ' + e.message);
    }
  }

  // 비밀번호 설정 확인
  if (!prop_('PASSWORD_HASH', '')) {
    log.push('[주의] PASSWORD_HASH 가 없습니다. generatePasswordHash() 를 실행해 해시를 만들어 주세요.');
  }
  if (!prop_('PASSWORD_SALT', '')) {
    var salt = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    props_().setProperty('PASSWORD_SALT', salt);
    log.push('[생성] PASSWORD_SALT 를 자동 생성했습니다: ' + salt);
  }
  if (!prop_('SESSION_DAYS', '')) {
    props_().setProperty('SESSION_DAYS', '180');
    log.push('[설정] SESSION_DAYS = 180');
  }
  if (!prop_('TRIP_CODE', '')) {
    props_().setProperty('TRIP_CODE', 'bestone');
    log.push('[설정] TRIP_CODE = bestone (원하는 값으로 바꾸세요)');
  }

  // AI 도우미 (선택 사항 - 없어도 나머지 기능은 모두 동작합니다)
  if (!prop_('GEMINI_API_KEY', '')) {
    log.push('[선택] GEMINI_API_KEY 가 없습니다. AI 도우미를 쓰려면 ' +
             'https://aistudio.google.com/apikey 에서 키를 만들어 ' +
             '[프로젝트 설정 > 스크립트 속성] 에 GEMINI_API_KEY 로 추가해 주세요.');
  } else {
    log.push('[OK] GEMINI_API_KEY 가 설정되어 있습니다. (모델 순서: ' + aiServerModels_().join(' → ') + ')');
  }

  // 날짜/시각 값이 Google Sheets 에 의해 자동으로 잘못 바뀌어 있으면 복구합니다.
  var repairLog = repairDateTimeColumns_(ss);
  log.push(repairLog);

  log.push('=== setupBestOneProject 완료 ===');
  log.forEach(function (l) { Logger.log(l); });
  return log.join('\n');
}

/**
 * ★ 비밀번호 해시 만들기.
 * 아래 PASSWORD 값을 원하는 비밀번호로 바꾼 뒤 이 함수를 실행하고,
 * 실행 로그(하단 "실행 로그")에 나오는 값을 복사해
 * 스크립트 속성 PASSWORD_HASH 에 붙여 넣으세요.
 * 붙여 넣은 뒤에는 아래 비밀번호를 다시 'PUT-YOUR-PASSWORD-HERE' 로 되돌려 두세요.
 */
function generatePasswordHash() {
  var PASSWORD = 'PUT-YOUR-PASSWORD-HERE'; // ← 여기에 원하는 비밀번호를 입력하세요

  var salt = prop_('PASSWORD_SALT', '');
  if (!salt) {
    salt = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    props_().setProperty('PASSWORD_SALT', salt);
  }
  var hash = hashPassword_(PASSWORD, salt);
  Logger.log('==============================================');
  Logger.log('PASSWORD_SALT (이미 스크립트 속성에 저장됨): ' + salt);
  Logger.log('PASSWORD_HASH (아래 값을 복사해서 스크립트 속성에 붙여 넣으세요):');
  Logger.log(hash);
  Logger.log('==============================================');
  Logger.log('※ 비밀번호 원문은 어디에도 저장되지 않습니다.');
  Logger.log('※ 이 함수의 PASSWORD 값은 사용 후 다시 지워 두세요.');
  return hash;
}

/** 설정 상태 점검 */
function checkSetup() {
  var lines = [];
  var p = props_().getProperties();
  ['SPREADSHEET_ID', 'DRIVE_FOLDER_ID', 'TRIP_CODE', 'PASSWORD_SALT', 'PASSWORD_HASH',
   'SESSION_DAYS', 'TRIP_ID', 'GEMINI_API_KEY', 'GEMINI_MODELS']
    .forEach(function (k) {
      var v = p[k];
      // 비밀 값은 앞 몇 글자만 보여줍니다 (로그에 그대로 남지 않도록)
      if ((k === 'PASSWORD_HASH' || k === 'GEMINI_API_KEY') && v) v = v.substring(0, 8) + '...(생략)';
      var optional = (k === 'GEMINI_API_KEY' || k === 'GEMINI_MODELS');
      lines.push((v ? '[OK] ' : (optional ? '[선택] ' : '[없음] ')) + k + ' = ' + (v || ''));
    });

  try {
    var ss = getSpreadsheet_();
    lines.push('[OK] 스프레드시트 연결: ' + ss.getName());
    Object.keys(SCHEMA).forEach(function (n) {
      var sh = ss.getSheetByName(n);
      lines.push((sh ? '[OK] ' : '[없음] ') + '시트 ' + n + (sh ? ' (행 ' + sh.getLastRow() + ')' : ''));
    });
  } catch (e) {
    lines.push('[오류] 스프레드시트: ' + e.message);
  }

  try {
    var folder = getDriveFolder_();
    lines.push('[OK] Drive 폴더: ' + folder.getName());
  } catch (e) {
    lines.push('[오류] Drive 폴더: ' + e.message);
  }

  lines.forEach(function (l) { Logger.log(l); });
  return lines.join('\n');
}

/**
 * ★ 항공/일정 등의 날짜·시각이 이상하게 보일 때 실행하세요.
 * (예: 탑승 시각이 "1899-12-30T08:47:08Z" 처럼 보이거나, 날짜가 "NaN"으로 보일 때)
 *
 * Google Sheets 가 "09:22" 같은 문자열을 시각으로 자동 인식해 Date 로 바꿔버리면
 * 생기는 문제입니다. 이 함수는 이미 잘못 바뀐 값을 올바른 문자열로 되돌리고,
 * 해당 컬럼을 "일반 텍스트" 서식으로 바꿔 앞으로 같은 문제가 생기지 않게 합니다.
 * 여러 번 실행해도 안전합니다.
 */
function repairDateTimeColumns() {
  var result = repairDateTimeColumns_(getSpreadsheet_());
  Logger.log(result);
  return result;
}

/** repairDateTimeColumns() 의 실제 동작. setupBestOneProject() 에서도 함께 호출됩니다. */
function repairDateTimeColumns_(ss) {
  var log = [];
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var headers = headersOf_(sh, name);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    var targetCols = [];
    headers.forEach(function (h, idx) {
      if (isProtectedColumn_(name, h)) targetCols.push({ header: h, col: idx + 1 });
    });
    if (!targetCols.length) return;

    // Settings 시트는 'value' 칸의 형식이 같은 행의 key 에 따라 달라집니다.
    var keyCol = headers.indexOf('key');
    var rowKeys = [];
    if (name === 'Settings' && keyCol >= 0) {
      rowKeys = sh.getRange(2, keyCol + 1, lastRow - 1, 1).getValues()
        .map(function (r) { return String(r[0] || ''); });
    }

    var fixedCount = 0;
    targetCols.forEach(function (t) {
      var range = sh.getRange(2, t.col, lastRow - 1, 1);
      var values = range.getValues();
      var changed = false;
      var out = values.map(function (row, i) {
        var v = row[0];
        if (v instanceof Date) {
          changed = true;
          fixedCount++;
          var hint = (t.header === 'value' && rowKeys[i]) ? rowKeys[i] : t.header;
          return [formatDateTimeCell_(hint, v)];
        }
        return [v];
      });
      // 서식을 먼저 "일반 텍스트"로 바꾼 뒤에 고친 값을 다시 써야
      // Sheets 가 다시 날짜/시각으로 자동 변환하지 않습니다.
      range.setNumberFormat('@');
      if (changed) range.setValues(out);
    });

    if (fixedCount) log.push('[복구] ' + name + ' 시트에서 ' + fixedCount + '칸을 고쳤습니다.');
  });

  if (!log.length) log.push('[확인] 고칠 값이 없습니다. 모든 날짜/시각이 정상입니다.');
  log.unshift('=== repairDateTimeColumns 결과 ===');
  return log.join('\n');
}

function quickSetupState_() {
  return {
    hasSpreadsheet: !!prop_('SPREADSHEET_ID', ''),
    hasDriveFolder: !!prop_('DRIVE_FOLDER_ID', ''),
    hasPassword: !!prop_('PASSWORD_HASH', ''),
    hasTripCode: !!prop_('TRIP_CODE', '')
  };
}

/* ============================================================
 * 12. 초기 데이터 생성 (seedJapanData)
 * ========================================================== */

/**
 * ★ 초기 데이터(일본어 표현/단어 + 샘플)를 만듭니다.
 * 이미 같은 내용이 있으면 중복해서 넣지 않습니다.
 * 샘플 데이터에는 isSample = true 가 표시되며 clearSampleData() 로 지울 수 있습니다.
 */
function seedJapanData() {
  var log = [];
  var tripId = prop_('TRIP_ID', 'trip-jp-001');
  var now = new Date().toISOString();
  var by = 'system';

  function common(isSample) {
    return {
      tripId: tripId, createdBy: by, createdAt: now,
      updatedBy: by, updatedAt: now, isDeleted: false, isSample: !!isSample
    };
  }
  function merge(a, b) {
    var o = {};
    Object.keys(a).forEach(function (k) { o[k] = a[k]; });
    Object.keys(b).forEach(function (k) { o[k] = b[k]; });
    return o;
  }

  /* ---------- 일본어 표현 ---------- */
  var phrases = SEED_PHRASES_();
  var existingPhrases = {};
  readSheetObjects_('JapanesePhrases', false).forEach(function (p) { existingPhrases[p.ja] = true; });
  var phraseRows = [];
  phrases.forEach(function (p, i) {
    if (existingPhrases[p[2]]) return;
    phraseRows.push(merge({
      id: Utilities.getUuid(), category: p[0], ko: p[1], ja: p[2], reading: p[3],
      favorite: false, memo: '', sortOrder: i + 1
    }, common(false)));
  });
  bulkAppend_('JapanesePhrases', phraseRows);
  log.push('일본어 표현 ' + phraseRows.length + '개 추가');

  /* ---------- 일본어 단어 ---------- */
  var words = SEED_WORDS_();
  var existingWords = {};
  readSheetObjects_('JapaneseWords', false).forEach(function (w) { existingWords[w.ja] = true; });
  var wordRows = [];
  words.forEach(function (w, i) {
    if (existingWords[w[1]]) return;
    wordRows.push(merge({
      id: Utilities.getUuid(), category: w[0], ja: w[1], reading: w[2], ko: w[3],
      favorite: false, memo: '', sortOrder: i + 1
    }, common(false)));
  });
  bulkAppend_('JapaneseWords', wordRows);
  log.push('일본어 단어 ' + wordRows.length + '개 추가');

  /* ---------- 샘플 데이터 ---------- */
  var hasSample = false;
  ['Stations', 'Buses', 'Flights', 'Accommodations', 'Schedules', 'DailyRecords', 'Routes']
    .forEach(function (n) {
      readSheetObjects_(n, false).forEach(function (r) { if (isTrue_(r.isSample)) hasSample = true; });
    });

  if (hasSample) {
    log.push('샘플 데이터가 이미 있어 건너뜁니다. (다시 만들려면 clearSampleData() 실행 후 재실행)');
  } else {
    var trip = readTrip_();
    var d1 = trip.startDate || Utilities.formatDate(
      new Date(Date.now() + 7 * 864e5), 'Asia/Tokyo', 'yyyy-MM-dd');
    var d2 = addDays_(d1, 1);
    var d3 = addDays_(d1, 2);

    // 역
    bulkAppend_('Stations', [
      merge({
        id: Utilities.getUuid(), city: '삿포로', nameKo: '삿포로역', nameJa: '札幌駅', nameEn: 'Sapporo Station',
        lines: 'JR 하코다테 본선 / 삿포로 지하철 난보쿠선', lineColor: '#2f6f4f', stationNumber: 'N06',
        exits: '남쪽 출구(南口), 북쪽 출구(北口), 서쪽 개찰구(西改札)',
        recommendedExit: '남쪽 출구 - 호텔·지하상가 방면', transfers: '난보쿠선, 도호선(오도리역 환승)',
        elevator: '남쪽 출구 개찰 안쪽에 있음', coinLocker: '서쪽 개찰구 앞 대형 로커 있음',
        toilet: '개찰 안/밖 모두 있음', hotelRelation: '숙소에서 도보 7분',
        nearby: '삿포로 시계탑, 오도리 공원, 다이마루 백화점',
        mapUrl: 'https://www.google.com/maps/search/%E6%9C%AD%E5%B9%8C%E9%A7%85',
        officialSite: 'https://www.jrhokkaido.co.jp/', photoUrl: '', favorite: true,
        memo: '에스콘필드 갈 때 여기서 기타히로시마행 승차'
      }, common(true)),
      merge({
        id: Utilities.getUuid(), city: '삿포로', nameKo: '기타히로시마역', nameJa: '北広島駅', nameEn: 'Kitahiroshima Station',
        lines: 'JR 지토세선', lineColor: '#2f6f4f', stationNumber: 'H07',
        exits: '동쪽 출구(東口), 서쪽 출구(西口)', recommendedExit: '동쪽 출구 - 에스콘필드 셔틀/도보 경로',
        transfers: '없음', elevator: '있음', coinLocker: '소형만 있음(경기일 혼잡)',
        toilet: '개찰 안쪽', hotelRelation: '숙소에서 열차 20분',
        nearby: 'ES CON FIELD HOKKAIDO(에스콘필드) 도보 약 20분',
        mapUrl: 'https://www.google.com/maps/search/%E5%8C%97%E5%BA%83%E5%B3%B6%E9%A7%85',
        officialSite: 'https://www.jrhokkaido.co.jp/', photoUrl: '', favorite: true,
        memo: '경기 종료 후 매우 혼잡. 여유 있게 이동'
      }, common(true))
    ]);
    log.push('샘플 역 2개 추가');

    // 버스
    bulkAppend_('Buses', [
      merge({
        id: Utilities.getUuid(), city: '삿포로', company: '홋카이도 중앙버스', lineName: '에스콘필드 직행버스',
        fromStop: '삿포로역 앞', toStop: '에스콘필드 홋카이도',
        fromStopJa: '札幌駅前', toStopJa: 'エスコンフィールド北海道',
        boardingPoint: '삿포로역 남쪽 출구 버스터미널', boardingDoor: '앞문 승차',
        alightMethod: '종점에서 전원 하차', icCard: '사용 가능(Kitaca, Suica 등)',
        needTicket: '불필요(균일 요금)', paymentMethod: '승차 시 선불',
        fare: '약 700엔', durationMinutes: '50', firstBus: '경기 3시간 전부터',
        lastBus: '경기 종료 후 약 1시간까지',
        officialSite: 'https://www.chuo-bus.co.jp/',
        mapUrl: 'https://www.google.com/maps/search/%E6%9C%AD%E5%B9%8C%E9%A7%85%E5%89%8D%E3%83%90%E3%82%B9%E3%82%BF%E3%83%BC%E3%83%9F%E3%83%8A%E3%83%AB',
        photoUrl: '', memo: '경기일에만 운행. 좌석이 없으면 서서 갑니다.'
      }, common(true)),
      merge({
        id: Utilities.getUuid(), city: '교토', company: '교토 시영버스', lineName: '206번',
        fromStop: '교토역 앞', toStop: '기요미즈미치',
        fromStopJa: '京都駅前', toStopJa: '清水道',
        boardingPoint: '교토역 버스터미널 D1 승차장', boardingDoor: '뒷문 승차 / 앞문 하차',
        alightMethod: '내릴 정류장 전에 벨을 누름', icCard: '사용 가능(ICOCA, Suica 등)',
        needTicket: '균일 구간은 불필요', paymentMethod: '하차 시 지불(균일 230엔)',
        fare: '230엔', durationMinutes: '15', firstBus: '05:40', lastBus: '22:40',
        officialSite: 'https://www2.city.kyoto.lg.jp/kotsu/',
        mapUrl: 'https://www.google.com/maps/search/%E4%BA%AC%E9%83%BD%E9%A7%85%E5%89%8D%E3%83%90%E3%82%B9%E3%81%AE%E3%82%8A%E5%A0%B4',
        photoUrl: '', memo: '아침에 매우 혼잡. 잔돈은 차내 환전기에서 교환.'
      }, common(true))
    ]);
    log.push('샘플 버스 2개 추가');

    // 항공
    bulkAppend_('Flights', [
      merge({
        id: Utilities.getUuid(), date: d1, airline: '대한항공', flightNo: 'KE765',
        depAirport: '인천(ICN)', depTerminal: '제2여객터미널', boardingTime: '08:50', depTime: '09:20',
        arrAirport: '신치토세(CTS)', arrTerminal: '국제선', arrTime: '11:55',
        seat: '32A / 32B', baggage: '위탁 23kg x 1, 기내 10kg',
        bookingNumber: 'ABC123', bookingSite: 'https://www.koreanair.com/',
        ticketUrl: '', memo: '출발 2시간 전 공항 도착 권장'
      }, common(true)),
      merge({
        id: Utilities.getUuid(), date: d3, airline: '대한항공', flightNo: 'KE766',
        depAirport: '신치토세(CTS)', depTerminal: '국제선', boardingTime: '12:35', depTime: '13:05',
        arrAirport: '인천(ICN)', arrTerminal: '제2여객터미널', arrTime: '16:45',
        seat: '30C / 30D', baggage: '위탁 23kg x 1',
        bookingNumber: 'ABC123', bookingSite: 'https://www.koreanair.com/',
        ticketUrl: '', memo: '면세품 인도장 위치 확인'
      }, common(true))
    ]);
    log.push('샘플 항공 2개 추가');

    // 숙소
    bulkAppend_('Accommodations', [
      merge({
        id: Utilities.getUuid(), name: '삿포로 그랜드 호텔', nameJa: '札幌グランドホテル',
        checkInDate: d1, checkInTime: '15:00', checkOutDate: d3, checkOutTime: '11:00',
        address: '홋카이도 삿포로시 주오구 기타1조니시 4초메',
        addressJa: '北海道札幌市中央区北1条西4丁目',
        nearestStation: '삿포로역 / 오도리역', recommendedExit: '삿포로역 남쪽 출구',
        roomType: '트윈룸 (금연)', bookingNumber: 'HT-998877',
        bookingSite: 'https://www.booking.com/', breakfast: '포함 (6:30~10:00)',
        nonSmoking: '금연', luggageStorage: '체크인 전/후 보관 가능',
        mapUrl: 'https://www.google.com/maps/search/%E6%9C%AD%E5%B9%8C%E3%82%B0%E3%83%A9%E3%83%B3%E3%83%89%E3%83%9B%E3%83%86%E3%83%AB',
        officialSite: 'https://www.grand1934.com/', ticketUrl: '',
        phone: '+81-11-261-3311', memo: '늦게 도착하면 프런트에 미리 연락'
      }, common(true))
    ]);
    log.push('샘플 숙소 1개 추가');

    // 일정
    bulkAppend_('Schedules', [
      merge({
        id: Utilities.getUuid(), date: d1, startTime: '09:20', endTime: '11:55', category: 'flight',
        title: 'KE765 인천 → 신치토세', place: '인천공항 제2여객터미널', description: '탑승 수속 07:20까지',
        transport: '공항철도', travelMinutes: '60', departBy: '06:00', mapUrl: '',
        reservationId: '', prepare: '여권, 항공권, 유심', isDone: false, likes: '', mustGo: false,
        author: 'system'
      }, common(true)),
      merge({
        id: Utilities.getUuid(), date: d1, startTime: '15:00', endTime: '15:30', category: 'hotel',
        title: '호텔 체크인', place: '삿포로 그랜드 호텔', description: '짐 맡기고 바로 나가기',
        transport: 'JR 쾌속 에어포트', travelMinutes: '40', departBy: '13:40',
        mapUrl: 'https://www.google.com/maps/search/%E6%9C%AD%E5%B9%8C%E3%82%B0%E3%83%A9%E3%83%B3%E3%83%89%E3%83%9B%E3%83%86%E3%83%AB',
        reservationId: '', prepare: '예약 확인서', isDone: false, likes: '', mustGo: false,
        author: 'system'
      }, common(true)),
      merge({
        id: Utilities.getUuid(), date: d2, startTime: '13:00', endTime: '17:00', category: 'sports',
        title: '야구 경기 관람 (에스콘필드)', place: 'ES CON FIELD HOKKAIDO',
        description: '경기 시작 2시간 전 입장 추천', transport: 'JR + 도보',
        travelMinutes: '45', departBy: '11:30',
        mapUrl: 'https://www.google.com/maps/search/ES+CON+FIELD+HOKKAIDO',
        reservationId: '', prepare: '티켓 QR, 모자, 보조배터리', isDone: false, likes: '', mustGo: true,
        author: 'system'
      }, common(true))
    ]);
    log.push('샘플 일정 3개 추가');

    // 이동 경로
    bulkAppend_('Routes', [
      merge({
        id: Utilities.getUuid(), name: '삿포로역 → 에스콘필드',
        fromPlace: '삿포로역', toPlace: 'ES CON FIELD HOKKAIDO',
        steps: JSON.stringify([
          { type: 'train', line: 'JR 지토세선(快速)', from: '삿포로역', to: '기타히로시마역', platform: '5번', minutes: 20, cost: '460엔', note: '쾌속 에어포트 탑승' },
          { type: 'walk', line: '도보', from: '기타히로시마역 동쪽 출구', to: '에스콘필드', platform: '', minutes: 20, cost: '0엔', note: '셔틀버스도 있음' }
        ]),
        totalMinutes: '40', totalCost: '약 460엔', lastTrain: '삿포로행 막차 23:30 전후',
        caution: '경기 종료 직후 매우 혼잡. 30분 정도 여유를 두세요.',
        mapUrl: 'https://www.google.com/maps/dir/%E6%9C%AD%E5%B9%8C%E9%A7%85/ES+CON+FIELD+HOKKAIDO',
        scheduleId: '', imageUrl: '', favorite: true, memo: ''
      }, common(true))
    ]);
    log.push('샘플 이동 경로 1개 추가');

    // 하루 기록
    var trip2 = readTrip_();
    bulkAppend_('DailyRecords', [
      merge({
        id: Utilities.getUuid(), date: d1, author: trip2.traveler1 || 'chichiboo',
        photoUrl: '', places: '신치토세공항, 삿포로역, 오도리 공원',
        bestMoment: '공항 문이 열리고 찬 공기가 훅 들어왔던 순간',
        foods: '공항 라멘, 편의점 푸딩', oneLine: '오늘부터 우리의 별로 가는 여행이 시작됐다.',
        color: '하늘색', music: '비행기 안에서 들은 잔잔한 피아노곡',
        surprise: '생각보다 훨씬 추웠다', revisit: '오도리 공원 야경',
        tomorrow: '야구장에서 소리 지르기', rating: '5',
        freeText: '짐을 풀고 창밖을 봤는데 별이 보였다.'
      }, common(true)),
      merge({
        id: Utilities.getUuid(), date: d1, author: trip2.traveler2 || 'neederes',
        photoUrl: '', places: '신치토세공항, 호텔, 편의점',
        bestMoment: '호텔 방 창문에서 내려다본 거리',
        foods: '수프카레', oneLine: '코끼리 한 마리를 가방에 넣어 온 기분.',
        color: '남색', music: '거리에서 흘러나온 캐럴',
        surprise: '지하도가 너무 넓어서 길을 잃을 뻔했다', revisit: '수프카레 가게',
        tomorrow: '경기장 굿즈샵', rating: '4',
        freeText: '피곤했지만 웃음이 계속 나왔다.'
      }, common(true))
    ]);
    log.push('샘플 하루 기록 2개 추가');
  }

  log.push('=== seedJapanData 완료 ===');
  log.forEach(function (l) { Logger.log(l); });
  return log.join('\n');
}

/** 여러 행을 한 번에 추가 (시트 접근 최소화) */
function bulkAppend_(sheetName, objects) {
  if (!objects || !objects.length) return;
  var sh = getSheet_(sheetName);
  var headers = headersOf_(sh, sheetName);
  var rows = objects.map(function (o) {
    return headers.map(function (h) {
      var v = o[h];
      return (v === undefined || v === null) ? '' : v;
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function addDays_(dateStr, n) {
  var parts = String(dateStr).split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  d.setDate(d.getDate() + n);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  var dd = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

/**
 * 샘플 데이터(isSample = true) 만 삭제합니다.
 * 일본어 표현/단어는 샘플이 아니므로 지워지지 않습니다.
 */
function clearSampleData() {
  var count = 0;
  var targets = ['Stations', 'Buses', 'Flights', 'Accommodations', 'Schedules',
    'DailyRecords', 'SharedRecords', 'Reservations', 'Routes', 'Expenses'];
  targets.forEach(function (name) {
    var sh = getSheet_(name);
    var headers = headersOf_(sh, name);
    var col = headers.indexOf('isSample');
    var lastRow = sh.getLastRow();
    if (col < 0 || lastRow < 2) return;
    var values = sh.getRange(2, col + 1, lastRow - 1, 1).getValues();
    for (var i = values.length - 1; i >= 0; i--) {
      if (isTrue_(values[i][0])) { sh.deleteRow(i + 2); count++; }
    }
  });
  Logger.log('샘플 데이터 ' + count + '행을 삭제했습니다.');
  return count;
}

/* ============================================================
 * 13. 시드 데이터 정의
 * ========================================================== */

/** [카테고리, 한국어, 일본어, 한국어식 읽는 법] */
function SEED_PHRASES_() {
  return [
    ['greeting', '안녕하세요', 'こんにちは', '콘니치와'],
    ['greeting', '안녕하세요 (아침)', 'おはようございます', '오하요- 고자이마스'],
    ['greeting', '안녕히 주무세요', 'おやすみなさい', '오야스미나사이'],
    ['greeting', '감사합니다', 'ありがとうございます', '아리가토- 고자이마스'],
    ['greeting', '죄송합니다', 'すみません', '스미마셍'],
    ['greeting', '실례합니다', '失礼します', '시츠레이시마스'],
    ['greeting', '네 / 아니요', 'はい / いいえ', '하이 / 이이에'],
    ['greeting', '괜찮습니다', '大丈夫です', '다이죠-부데스'],
    ['greeting', '한국에서 왔습니다', '韓国から来ました', '칸코쿠카라 키마시타'],
    ['greeting', '일본어를 잘 못합니다', '日本語があまり話せません', '니홍고가 아마리 하나세마셍'],
    ['greeting', '영어 하실 수 있나요?', '英語は話せますか？', '에-고와 하나세마스카?'],
    ['greeting', '천천히 말씀해 주세요', 'ゆっくり話してください', '윳쿠리 하나시테 쿠다사이'],
    ['greeting', '한 번 더 말씀해 주세요', 'もう一度お願いします', '모- 이치도 오네가이시마스'],
    ['greeting', '또 올게요 (헤어질 때)', 'また来ます', '마타 키마스'],

    ['airport', '입국 심사는 어디인가요?', '入国審査はどこですか？', '뉴-코쿠신사와 도코데스카?'],
    ['airport', '수하물 찾는 곳은 어디인가요?', '手荷物受取所はどこですか？', '테니모츠 우케토리죠와 도코데스카?'],
    ['airport', '관광으로 왔습니다', '観光で来ました', '칸코-데 키마시타'],
    ['airport', '3일 머무릅니다', '3日間滞在します', '밋카칸 타이자이시마스'],
    ['airport', '이 호텔에 묵습니다', 'このホテルに泊まります', '코노 호테루니 토마리마스'],
    ['airport', '유심(SIM)은 어디서 살 수 있나요?', 'SIMカードはどこで買えますか？', '심카-도와 도코데 카에마스카?'],
    ['airport', '공항버스 타는 곳은 어디인가요?', '空港バス乗り場はどこですか？', '쿠-코-바스 노리바와 도코데스카?'],
    ['airport', '여권입니다 (건네면서)', 'パスポートです', '파스포-토데스'],
    ['airport', '신고할 물건은 없습니다', '申告するものはありません', '신코쿠스루 모노와 아리마셍'],
    ['airport', '캐리어가 안 나와요', 'スーツケースが出てきません', '스-츠케-스가 데테키마셍'],
    ['airport', '표를 사고 싶어요', 'チケットを買いたいです', '치켓토오 카이타이데스'],
    ['airport', 'ATM은 어디에 있나요?', 'ATMはどこですか？', '에-티-에무와 도코데스카?'],

    ['train', '이 열차가 삿포로역으로 가나요?', 'この電車は札幌駅に行きますか？', '코노 덴샤와 삿포로에키니 이키마스카?'],
    ['train', '표는 어디서 사나요?', '切符はどこで買えますか？', '킷푸와 도코데 카에마스카?'],
    ['train', '몇 번 승강장인가요?', '何番ホームですか？', '난반 호-무데스카?'],
    ['train', '갈아타야 하나요?', '乗り換えが必要ですか？', '노리카에가 히츠요-데스카?'],
    ['train', '다음 열차는 몇 시인가요?', '次の電車は何時ですか？', '츠기노 덴샤와 난지데스카?'],
    ['train', '막차는 몇 시인가요?', '終電は何時ですか？', '슈-덴와 난지데스카?'],
    ['train', '이 자리 비어 있나요?', 'この席は空いていますか？', '코노 세키와 아이테이마스카?'],
    ['train', 'IC카드를 충전하고 싶습니다', 'ICカードをチャージしたいです', '아이시-카-도오 챠-지 시타이데스'],
    ['train', '이 출구로 나가면 되나요?', 'この出口で合っていますか？', '코노 데구치데 앗테이마스카?'],
    ['train', '코인로커는 어디에 있나요?', 'コインロッカーはどこですか？', '코인록카-와 도코데스카?'],
    ['train', '역은 어디예요?', '駅はどこですか？', '에키와 도코데스카?'],
    ['train', '다음 역은 어디예요?', '次の駅はどこですか？', '츠기노 에키와 도코데스카?'],
    ['train', '환승은 어디서 하나요?', '乗り換えはどこですか？', '노리카에와 도코데스카?'],
    ['train', '전철은 몇 시에 출발하나요?', '電車は何時に出ますか？', '덴샤와 난지니 데마스카?'],
    ['train', '시간표를 보여주세요', '時刻表を見せてください', '지코쿠효-오 미세테 쿠다사이'],
    ['train', '이 전철은 신주쿠행인가요?', 'この電車は新宿行きですか？', '코노 덴샤와 신주쿠유키데스카?'],
    ['train', '3번 출구는 어디예요?', '3番出口はどこですか？', '산반 데구치와 도코데스카?'],
    ['train', '거기까지 얼마예요?', 'そこまでいくらですか？', '소코마데 이쿠라데스카?'],

    ['bus', '이 버스가 여기로 가나요?', 'このバスはここに行きますか？', '코노 바스와 코코니 이키마스카?'],
    ['bus', '요금은 얼마인가요?', '運賃はいくらですか？', '운친와 이쿠라데스카?'],
    ['bus', '정리권을 뽑아야 하나요?', '整理券を取りますか？', '세이리켄오 토리마스카?'],
    ['bus', '앞문으로 타나요, 뒷문으로 타나요?', '前乗りですか、後ろ乗りですか？', '마에노리데스카, 우시로노리데스카?'],
    ['bus', '교통카드를 쓸 수 있나요?', 'ICカードは使えますか？', '아이시-카-도와 츠카에마스카?'],
    ['bus', '여기서 내립니다', 'ここで降ります', '코코데 오리마스'],
    ['bus', '몇 정거장 남았나요?', 'あといくつ停留所がありますか？', '아토 이쿠츠 테-류-죠가 아리마스카?'],
    ['bus', '잔돈을 바꿔 주세요', '両替をお願いします', '료-가에오 오네가이시마스'],
    ['bus', '어느 버스를 타면 되나요?', 'どのバスに乗ればいいですか？', '도노 바스니 노레바 이이데스카?'],
    ['taxi', '이 주소까지 부탁드립니다', 'この住所までお願いします', '코노 쥬-쇼마데 오네가이시마스'],
    ['taxi', '여기까지 가주세요 (지도를 보여주며)', 'ここまでお願いします', '코코마데 오네가이시마스'],
    ['taxi', '곧장 가주세요', 'まっすぐ行ってください', '맛스구 잇테 쿠다사이'],
    ['taxi', '오른쪽으로 돌아주세요', '右に曲がってください', '미기니 마갓테 쿠다사이'],
    ['taxi', '왼쪽으로 돌아주세요', '左に曲がってください', '히다리니 마갓테 쿠다사이'],
    ['taxi', '여기서 세워주세요', 'ここで止めてください', '코코데 토메테 쿠다사이'],
    ['taxi', '트렁크를 열어주세요', 'トランクを開けてください', '토랑쿠오 아케테 쿠다사이'],
    ['taxi', '거스름돈은 괜찮습니다', 'おつりは要りません', '오츠리와 이리마셍'],
    ['taxi', '시간이 얼마나 걸리나요?', 'どのくらいかかりますか？', '도노쿠라이 카카리마스카?'],

    ['hotel', '체크인 하고 싶습니다', 'チェックインをお願いします', '첵쿠인오 오네가이시마스'],
    ['hotel', '예약했습니다. 이름은 ○○입니다', '予約しています。名前は○○です', '요야쿠 시테이마스. 나마에와 ○○데스'],
    ['hotel', '짐을 맡길 수 있나요?', '荷物を預かってもらえますか？', '니모츠오 아즈캇테 모라에마스카?'],
    ['hotel', '체크아웃은 몇 시인가요?', 'チェックアウトは何時ですか？', '첵쿠아우토와 난지데스카?'],
    ['hotel', '와이파이 비밀번호를 알려주세요', 'Wi-Fiのパスワードを教えてください', '와이화이노 파스와-도오 오시에테 쿠다사이'],
    ['hotel', '조식은 몇 시부터인가요?', '朝食は何時からですか？', '쵸-쇼쿠와 난지카라데스카?'],
    ['hotel', '수건을 더 주세요', 'タオルをもう一枚ください', '타오루오 모- 이치마이 쿠다사이'],
    ['hotel', '이름은 ○○입니다', '名前は○○です', '나마에와 ○○데스'],
    ['hotel', '방 번호는 ○○입니다', '部屋番号は○○です', '헤야방고-와 ○○데스'],
    ['hotel', '카드키는 몇 개 받을 수 있나요?', 'カードキーはいくつもらえますか？', '카-도키-와 이쿠츠 모라에마스카?'],
    ['hotel', '체크아웃을 조금 늦출 수 있나요?', 'もう少し遅くできますか？', '모- 스코시 오소쿠 데키마스카?'],
    ['hotel', '방을 바꿔주실 수 있나요?', '部屋を変えてもらえますか？', '헤야오 카에테 모라에마스카?'],
    ['hotel', '조식이 포함되어 있나요?', '朝食はついていますか？', '쵸-쇼쿠와 츠이테 이마스카?'],
    ['hotel', '코인 세탁실은 어디예요?', 'コインランドリーはどこですか？', '코인란도리-와 도코데스카?'],
    ['hotel', '샤워기에서 물이 안 나와요', 'シャワーが出ません', '샤와-가 데마셍'],
    ['hotel', '에어컨이 작동하지 않아요', 'エアコンが動きません', '에아콘가 우고키마셍'],
    ['hotel', '수건을 바꿔주세요', 'タオルを変えてください', '타오루오 카에테 쿠다사이'],
    ['hotel', '쓰레기를 치워주세요', 'ごみを捨ててください', '고미오 스테테 쿠다사이'],
    ['hotel', '이불을 한 장 더 주실 수 있나요?', '布団をもう一枚もらえますか？', '후톤오 모- 이치마이 모라에마스카?'],
    ['hotel', '근처에 편의점이 있나요?', '近くにコンビニはありますか？', '치카쿠니 콘비니와 아리마스카?'],
    ['hotel', '신세 많이 졌습니다 (체크아웃 인사)', 'お世話になりました', '오세와니 나리마시타'],

    ['restaurant', '두 명입니다', '二人です', '후타리데스'],
    ['restaurant', '메뉴판 주세요', 'メニューをください', '메뉴-오 쿠다사이'],
    ['restaurant', '이거 주세요', 'これをください', '코레오 쿠다사이'],
    ['restaurant', '추천 메뉴는 무엇인가요?', 'おすすめは何ですか？', '오스스메와 난데스카?'],
    ['restaurant', '맵지 않게 해 주세요', '辛くしないでください', '카라쿠 시나이데 쿠다사이'],
    ['restaurant', '계산해 주세요', 'お会計をお願いします', '오카이케-오 오네가이시마스'],
    ['restaurant', '따로 계산해 주세요', '別々でお願いします', '베츠베츠데 오네가이시마스'],
    ['restaurant', '정말 맛있었습니다', 'とても美味しかったです', '토테모 오이시캇타데스'],
    ['restaurant', '물 한 잔 주세요', 'お水をください', '오미즈오 쿠다사이'],
    ['restaurant', '어서 오세요 (직원이 하는 말)', 'いらっしゃいませ', '이랏샤이마세'],
    ['restaurant', '테이블석으로 괜찮을까요?', 'テーブル席でもいいですか？', '테-부루세키데모 이이데스카?'],
    ['restaurant', '금연석으로 부탁드려요', '禁煙席をお願いします', '킨엔세키오 오네가이시마스'],
    ['restaurant', '주문할게요', '注文お願いします', '츄-몬 오네가이시마스'],
    ['restaurant', '이건 뭐예요?', 'これは何ですか？', '코레와 난데스카?'],
    ['restaurant', '이걸로 할게요', 'これにします', '코레니 시마스'],
    ['restaurant', '이거 하나 주세요', 'これを一つお願いします', '코레오 히토츠 오네가이시마스'],
    ['restaurant', '주문은 이상입니다', '以上です', '이죠-데스'],
    ['restaurant', '따뜻한 차 있나요?', '温かいお茶はありますか？', '아타타카이 오챠와 아리마스카?'],
    ['restaurant', '리필 되나요?', 'おかわりできますか？', '오카와리 데키마스카?'],
    ['restaurant', '젓가락 있나요?', 'お箸はありますか？', '오하시와 아리마스카?'],
    ['restaurant', '포크 주세요', 'フォークをください', '훠-쿠오 쿠다사이'],
    ['restaurant', '냅킨 있나요?', 'ナプキンはありますか？', '나푸킨와 아리마스카?'],
    ['restaurant', '포장되나요?', 'テイクアウトできますか？', '테이쿠아우토 데키마스카?'],
    ['restaurant', '카드 쓸 수 있나요?', 'クレジットカードは使えますか？', '쿠레짓토카-도와 츠카에마스카?'],
    ['restaurant', '같이 계산해 주세요', '一緒にお願いします', '잇쇼니 오네가이시마스'],
    ['restaurant', '잘 먹었습니다', 'ごちそうさまでした', '고치소-사마데시타'],

    ['shopping', '이거 얼마인가요?', 'これはいくらですか？', '코레와 이쿠라데스카?'],
    ['shopping', '면세 되나요?', '免税できますか？', '멘제- 데키마스카?'],
    ['shopping', '카드로 결제할게요', 'カードで払います', '카-도데 하라이마스'],
    ['shopping', '봉투 주세요', '袋をください', '후쿠로오 쿠다사이'],
    ['shopping', '조금 더 큰 사이즈 있나요?', 'もう少し大きいサイズはありますか？', '모- 스코시 오오키- 사이즈와 아리마스카?'],
    ['shopping', '그냥 보는 중이에요', '見ているだけです', '미테이루 다케데스'],
    ['shopping', '이거 보여주세요', 'これを見せてください', '코레오 미세테 쿠다사이'],
    ['shopping', '이거 있나요? (사진을 보여주며)', 'これ、ありますか？', '코레, 아리마스카?'],
    ['shopping', '다른 색 있나요?', '別の色はありますか？', '베츠노 이로와 아리마스카?'],
    ['shopping', '다른 사이즈 있나요?', '他のサイズはありますか？', '호카노 사이즈와 아리마스카?'],
    ['shopping', '입어봐도 되나요?', '試着してもいいですか？', '시챠쿠시테모 이이데스카?'],
    ['shopping', '딱 맞아요!', 'ぴったりです', '핏타리데스'],
    ['shopping', '조금 커요', 'ちょっと大きいです', '촛토 오오키-데스'],
    ['shopping', '조금 작아요', 'ちょっと小さいです', '촛토 치이사이데스'],
    ['shopping', '조금 더 싸게 안 될까요?', 'もう少し安くなりませんか？', '모- 스코시 야스쿠 나리마셍카?'],
    ['shopping', '이거 세일 중인가요?', 'これはセールですか？', '코레와 세-루데스카?'],
    ['shopping', '현금으로 낼게요', '現金で払います', '겐킨데 하라이마스'],
    ['shopping', '봉투에 넣어주세요', '袋に入れてください', '후쿠로니 이레테 쿠다사이'],
    ['shopping', '선물용으로 포장해 주세요', 'ラッピングお願いします', '랍핑구 오네가이시마스'],
    ['shopping', '선물이에요', 'プレゼントです', '푸레젠토데스'],
    ['shopping', '영수증 주세요', 'レシートをください', '레시-토오 쿠다사이'],

    ['sightseeing', '입장료는 얼마인가요?', '入場料はいくらですか？', '뉴-죠-료-와 이쿠라데스카?'],
    ['sightseeing', '사진 찍어도 되나요?', '写真を撮ってもいいですか？', '샤신오 톳테모 이이데스카?'],
    ['sightseeing', '사진 좀 찍어주시겠어요?', '写真を撮っていただけますか？', '샤신오 톳테 이타다케마스카?'],
    ['sightseeing', '화장실은 어디인가요?', 'トイレはどこですか？', '토이레와 도코데스카?'],
    ['sightseeing', '몇 시에 닫나요?', '何時に閉まりますか？', '난지니 시마리마스카?'],
    ['sightseeing', '지도를 받을 수 있나요?', '地図をもらえますか？', '치즈오 모라에마스카?'],
    ['sightseeing', '이 근처에 편의점이 있나요?', 'この近くにコンビニはありますか？', '코노 치카쿠니 콘비니와 아리마스카?'],
    ['sightseeing', '여기가 어디예요? (지도를 보여주며)', 'ここはどこですか？', '코코와 도코데스카?'],
    ['sightseeing', '걸어서 갈 수 있나요?', '歩いて行けますか？', '아루이테 이케마스카?'],

    ['venue', '입장은 몇 시부터인가요?', '入場は何時からですか？', '뉴-죠-와 난지카라데스카?'],
    ['venue', '이 좌석은 어디인가요?', 'この席はどこですか？', '코노 세키와 도코데스카?'],
    ['venue', '굿즈샵은 어디인가요?', 'グッズショップはどこですか？', '굿즈숍푸와 도코데스카?'],
    ['venue', '재입장이 가능한가요?', '再入場はできますか？', '사이뉴-죠-와 데키마스카?'],
    ['venue', '이 티켓으로 들어갈 수 있나요?', 'このチケットで入れますか？', '코노 치켓토데 하이레마스카?'],

    ['emergency', '도와주세요', '助けてください', '타스케테 쿠다사이'],
    ['emergency', '길을 잃었습니다', '道に迷いました', '미치니 마요이마시타'],
    ['emergency', '몸이 아픕니다', '体調が悪いです', '타이쵸-가 와루이데스'],
    ['emergency', '병원에 가고 싶습니다', '病院に行きたいです', '뵤-인니 이키타이데스'],
    ['emergency', '여권을 잃어버렸습니다', 'パスポートをなくしました', '파스포-토오 나쿠시마시타'],
    ['emergency', '경찰을 불러 주세요', '警察を呼んでください', '케-사츠오 욘데 쿠다사이'],
    ['emergency', '한국어를 할 수 있는 분이 있나요?', '韓国語が話せる人はいますか？', '칸코쿠고가 하나세루 히토와 이마스카?'],
    ['emergency', '약국은 어디인가요?', '薬局はどこですか？', '얏쿄쿠와 도코데스카?']
  ];
}

/** [카테고리, 일본어, 읽는 법, 한국어] */
function SEED_WORDS_() {
  return [
    ['station', '駅', '에키', '역'],
    ['station', '改札', '카이사츠', '개찰구'],
    ['station', '入口', '이리구치', '입구'],
    ['station', '出口', '데구치', '출구'],
    ['station', '東口', '히가시구치', '동쪽 출구'],
    ['station', '西口', '니시구치', '서쪽 출구'],
    ['station', '南口', '미나미구치', '남쪽 출구'],
    ['station', '北口', '키타구치', '북쪽 출구'],
    ['station', '切符', '킷푸', '표'],
    ['station', '券売機', '켄바이키', '발권기'],
    ['station', 'みどりの窓口', '미도리노 마도구치', '(JR) 매표 창구'],
    ['station', 'コインロッカー', '코인록카-', '코인로커'],

    ['subway', '地下鉄', '치카테츠', '지하철'],
    ['subway', '乗り換え', '노리카에', '환승'],
    ['subway', 'ホーム', '호-무', '승강장'],
    ['subway', '上り', '노보리', '상행'],
    ['subway', '下り', '쿠다리', '하행'],
    ['subway', '各駅停車', '카쿠에키테-샤', '각역 정차'],
    ['subway', '一日乗車券', '이치니치 죠-샤켄', '1일 승차권'],

    ['railway', '普通', '후츠-', '보통'],
    ['railway', '快速', '카이소쿠', '쾌속'],
    ['railway', '特急', '톡큐-', '특급'],
    ['railway', '新幹線', '신칸센', '신칸센'],
    ['railway', '指定席', '시테-세키', '지정석'],
    ['railway', '自由席', '지유-세키', '자유석'],
    ['railway', 'グリーン車', '구린샤', '그린샤(특실)'],
    ['railway', '終電', '슈-덴', '막차'],
    ['railway', '始発', '시하츠', '첫차'],
    ['railway', '遅延', '치엔', '지연'],
    ['railway', '運休', '운큐-', '운행 중지'],

    ['bus', 'バス停', '바스테-', '버스 정류장'],
    ['bus', '乗り場', '노리바', '타는 곳'],
    ['bus', '降り場', '오리바', '내리는 곳'],
    ['bus', '整理券', '세이리켄', '정리권'],
    ['bus', '運賃', '운친', '운임'],
    ['bus', '終点', '슈-텐', '종점'],
    ['bus', '両替', '료-가에', '잔돈 교환'],
    ['bus', '前乗り', '마에노리', '앞문 승차'],
    ['bus', '後ろ乗り', '우시로노리', '뒷문 승차'],

    ['hotel', 'ホテル', '호테루', '호텔'],
    ['hotel', 'フロント', '후론토', '프런트'],
    ['hotel', 'チェックイン', '첵쿠인', '체크인'],
    ['hotel', 'チェックアウト', '첵쿠아우토', '체크아웃'],
    ['hotel', '朝食', '쵸-쇼쿠', '조식'],
    ['hotel', '大浴場', '다이요쿠죠-', '대욕장'],
    ['hotel', '禁煙', '킨엔', '금연'],
    ['hotel', '喫煙', '키츠엔', '흡연'],
    ['hotel', '荷物預かり', '니모츠 아즈카리', '짐 보관'],

    ['restaurant', '食堂', '쇼쿠도-', '식당'],
    ['restaurant', '定食', '테-쇼쿠', '정식'],
    ['restaurant', '大盛り', '오오모리', '곱빼기'],
    ['restaurant', '持ち帰り', '모치카에리', '포장'],
    ['restaurant', '飲み放題', '노미호-다이', '무제한 음료'],
    ['restaurant', '食べ放題', '타베호-다이', '무한 리필'],
    ['restaurant', '禁煙席', '킨엔세키', '금연석'],
    ['restaurant', 'お通し', '오토-시', '기본 안주(유료)'],

    ['shopping', '免税', '멘제-', '면세'],
    ['shopping', '税込', '제-코미', '세금 포함'],
    ['shopping', '税抜', '제-누키', '세금 별도'],
    ['shopping', '割引', '와리비키', '할인'],
    ['shopping', '在庫', '자이코', '재고'],
    ['shopping', 'レジ', '레지', '계산대'],

    ['toilet', 'トイレ', '토이레', '화장실'],
    ['toilet', 'お手洗い', '오테아라이', '화장실(정중)'],
    ['toilet', '男', '오토코', '남자'],
    ['toilet', '女', '온나', '여자'],
    ['toilet', '使用中', '시요-츄-', '사용 중'],
    ['toilet', '空き', '아키', '비어 있음'],

    ['payment', '現金', '겐킨', '현금'],
    ['payment', 'クレジットカード', '쿠레짓토카-도', '신용카드'],
    ['payment', 'お会計', '오카이케-', '계산'],
    ['payment', 'レシート', '레시-토', '영수증'],
    ['payment', 'チャージ', '챠-지', '충전'],
    ['payment', '小銭', '코제니', '동전'],

    ['direction', '右', '미기', '오른쪽'],
    ['direction', '左', '히다리', '왼쪽'],
    ['direction', 'まっすぐ', '맛스구', '직진'],
    ['direction', '近く', '치카쿠', '근처'],
    ['direction', '徒歩', '토호', '도보'],
    ['direction', '地図', '치즈', '지도'],
    ['direction', '案内所', '안나이죠', '안내소'],

    ['emergency', '病院', '뵤-인', '병원'],
    ['emergency', '薬局', '얏쿄쿠', '약국'],
    ['emergency', '警察', '케-사츠', '경찰'],
    ['emergency', '救急車', '큐-큐-샤', '구급차'],
    ['emergency', '非常口', '히죠-구치', '비상구'],
    ['emergency', '落とし物', '오토시모노', '분실물'],
    ['emergency', '交番', '코-반', '파출소']
  ];
}
