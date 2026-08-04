# BestOne in Japan

> «어린왕자와 코끼리의 일본 여행»
> 두 사람이 함께 준비하고, 서로를 돕고, 둘만의 이야기를 남기는 개인 여행 앱

---

## 목차

1. [이 앱은 무엇인가요](#1-이-앱은-무엇인가요)
2. [전체 프로젝트 구조](#2-전체-프로젝트-구조)
3. [데이터 흐름](#3-데이터-흐름)
4. [Google Sheets 시트와 필드 구조](#4-google-sheets-시트와-필드-구조)
5. [설치 안내서 (초보자용 · 1단계 ~ 11단계)](#5-설치-안내서)
6. [테스트 방법](#6-테스트-방법)
7. [자주 발생하는 오류 해결](#7-자주-발생하는-오류-해결)
8. [다른 나라 버전으로 바꾸는 방법](#8-다른-나라-버전으로-바꾸는-방법)
9. [개인정보 · 보안 주의사항](#9-개인정보--보안-주의사항)

---

## 1. 이 앱은 무엇인가요

이미 예약을 마친 여행의 정보를 한곳에 모아두고, 여행 중에 필요한 것만 빠르게 꺼내 보고,
여행이 끝난 뒤에는 두 사람이 각자의 시선으로 같은 하루를 기록하는 앱입니다.

| 화면 | 하는 일 |
| --- | --- |
| **오늘** | 오늘 날짜·도시·대표 문구, 다음 일정과 남은 시간, 출발 권장 시각, 오늘 쓸 티켓, 숙소, 이동 경로, 자주 쓸 일본어, 오늘의 기록, 긴급 연락처 |
| **일정** | 날짜별 세로 타임라인. 추가·수정·삭제·완료 표시·꼭 가기 표시·짧은 메모 |
| **예약** | 항공 / 숙소 / 관광·투어·공연·경기·열차·음식점 예약, QR·티켓 이미지 |
| **현지** | 일본어 표현, 일본어 단어장, 역 정보, 버스 정보, 이동 경로 |
| **기록** | 두 사람의 개별 기록, 공동 기록, 사진, 지출, 여행 요약 |

기술적으로는 이렇게 되어 있습니다.

* **프런트엔드** : HTML + CSS + JavaScript (빌드 과정 없음) → GitHub Pages 에 그대로 올리면 끝
* **백엔드** : Google Apps Script 웹 앱 (`Code.gs`)
* **데이터베이스** : Google Sheets
* **사진 저장소** : Google Drive
* **설치** : PWA (스마트폰 홈 화면에 앱처럼 설치 가능, 오프라인 열람 지원)

---

## 2. 전체 프로젝트 구조

```
bestonejapan/
├── index.html            앱 화면 뼈대 (로그인 화면 + 5개 탭 + 공통 UI)
├── style.css             디자인 (어린왕자·사막·별 콘셉트, 다크 모드 포함)
├── config.js             ★ 설정 파일 - Apps Script 주소와 국가 설정
├── script.js             앱 동작 전체 (통신, 화면 그리기, 폼, 사진 업로드)
├── manifest.json         PWA 설치 정보
├── service-worker.js     오프라인 캐시
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
├── Code.gs               ★ Google Apps Script 에 붙여 넣을 백엔드 전체 코드
└── README.md             이 문서
```

> `Code.gs` 는 GitHub 에 올려두지만 **실행은 Google Apps Script 편집기 안에서** 됩니다.
> GitHub Pages 는 `Code.gs` 를 사용하지 않습니다. (보관용 사본입니다)

---

## 3. 데이터 흐름

```
[스마트폰 브라우저]
      │  ① 로그인 (여행 코드 + 비밀번호 + 사용자)
      ▼
[Apps Script 웹 앱]  ── 비밀번호를 SHA-256 해시로 비교
      │  ② 세션 토큰 발급 (Sessions 시트에 저장)
      ▼
[브라우저 localStorage] 토큰 저장 → 다음부터 자동 로그인
      │
      │  ③ 모든 데이터 요청에 토큰 포함 (POST, text/plain)
      ▼
[Apps Script]  토큰 검증 → Google Sheets 읽기/쓰기 → JSON 응답
      │                    └ 사진은 Google Drive 에 저장하고 링크만 시트에 기록
      ▼
[브라우저] 화면 그리기 + localStorage 에 사본 저장 (오프라인 대비)
```

**저장할 때 일어나는 일**

1. 저장 버튼을 누르면 버튼이 잠깁니다(중복 저장 방지).
2. Apps Script 가 `LockService` 로 잠금을 걸고 시트에 씁니다.
3. 수정일 때는 내가 알고 있던 `updatedAt` 과 서버의 `updatedAt` 을 비교합니다.
   다르면 "상대방이 먼저 수정했습니다" 안내가 뜨고, 덮어쓸지 선택할 수 있습니다.
4. 저장이 끝나면 자동으로 전체 데이터를 다시 불러옵니다.
5. 저장에 실패하면 작성한 내용을 **이 기기에 임시 저장**합니다.
   (설정 ☰ → 임시 저장 에서 다시 저장할 수 있습니다)

---

## 4. Google Sheets 시트와 필드 구조

`setupBestOneProject()` 를 실행하면 아래 18개 시트가 자동으로 만들어집니다.
**시트 이름을 직접 만들 필요는 없습니다.**

| 시트 | 담는 내용 |
| --- | --- |
| `Settings` | 여행 기본 정보 (key / value 형태) |
| `Members` | 두 사람의 닉네임·이모지·색상 |
| `Sessions` | 로그인 토큰 |
| `Reservations` | 관광·투어·공연·경기·열차·음식점·기타 예약 |
| `Flights` | 항공 |
| `Accommodations` | 숙소 |
| `Schedules` | 날짜별 일정 |
| `ScheduleComments` | 일정별 짧은 메모 |
| `DailyRecords` | 두 사람 각자의 하루 기록 |
| `SharedRecords` | 공동 기록 |
| `Photos` | 업로드한 사진 (Drive 파일 ID + 링크) |
| `JapanesePhrases` | 일본어 표현 |
| `JapaneseWords` | 일본어 단어장 |
| `Stations` | 지하철·철도역 정보 |
| `Buses` | 버스 정보 |
| `Routes` | 저장한 이동 경로 |
| `Expenses` | 지출 |
| `ActivityLogs` | 활동 기록 (누가 무엇을 저장했는지) |

### 공통 필드

`Settings`, `Sessions`, `ActivityLogs` 를 제외한 모든 시트에는 아래 필드가 들어 있습니다.

| 필드 | 뜻 |
| --- | --- |
| `id` | 고유 ID (UUID. 행 번호를 ID 로 쓰지 않습니다) |
| `tripId` | 여행 ID |
| `createdBy` / `createdAt` | 최초 작성자 / 작성 시각 |
| `updatedBy` / `updatedAt` | 마지막 수정자 / 수정 시각 (충돌 방지에 사용) |
| `isDeleted` | 삭제 표시. `TRUE` 이면 앱에서 보이지 않습니다 (행은 남습니다) |
| `isSample` | 샘플 데이터 표시. `clearSampleData()` 로 한 번에 지울 수 있습니다 |

### 주요 시트의 필드

<details>
<summary><b>Settings</b> (여행 기본 정보) — 펼쳐보기</summary>

`key`, `value`, `updatedAt`

저장되는 key : `tripId`, `tripName`, `country`, `countryCode`, `city`, `startDate`, `endDate`,
`traveler1`, `traveler2`, `coverImage`, `intro`, `currency`, `timezone`, `emergencyContact`,
`createdAt`, `updatedAt`
</details>

<details>
<summary><b>Flights</b> (항공) — 펼쳐보기</summary>

`id`, `tripId`, `date`, `airline`, `flightNo`, `depAirport`, `depTerminal`, `depTime`,
`arrAirport`, `arrTerminal`, `arrTime`, `seat`, `baggage`, `bookingNumber`, `bookingSite`,
`ticketUrl`, `memo` + 공통 필드
</details>

<details>
<summary><b>Accommodations</b> (숙소) — 펼쳐보기</summary>

`id`, `tripId`, `name`, `nameJa`, `checkInDate`, `checkInTime`, `checkOutDate`, `checkOutTime`,
`address`, `addressJa`, `nearestStation`, `recommendedExit`, `roomType`, `bookingNumber`,
`bookingSite`, `breakfast`, `nonSmoking`, `luggageStorage`, `mapUrl`, `officialSite`,
`ticketUrl`, `phone`, `memo` + 공통 필드
</details>

<details>
<summary><b>Schedules</b> (일정) — 펼쳐보기</summary>

`id`, `tripId`, `date`, `startTime`, `endTime`, `category`, `title`, `place`, `description`,
`transport`, `travelMinutes`, `departBy`, `mapUrl`, `reservationId`, `prepare`, `isDone`,
`likes`, `mustGo`, `author` + 공통 필드
</details>

<details>
<summary><b>Reservations</b> (예약) — 펼쳐보기</summary>

`id`, `tripId`, `type`, `title`, `date`, `startTime`, `endTime`, `place`, `meetingPoint`,
`people`, `bookingNumber`, `qrImageUrl`, `ticketUrl`, `bookingSite`, `officialSite`,
`prepare`, `cancelPolicy`, `transport`, `mapUrl`, `memo` + 공통 필드
</details>

<details>
<summary><b>DailyRecords / SharedRecords</b> (기록) — 펼쳐보기</summary>

**DailyRecords** : `id`, `tripId`, `date`, `author`, `photoUrl`, `places`, `bestMoment`, `foods`,
`oneLine`, `color`, `music`, `surprise`, `revisit`, `tomorrow`, `rating`, `freeText` + 공통 필드

**SharedRecords** : `id`, `tripId`, `date`, `photoUrl`, `bestMoment`, `words`, `title`, `memo` + 공통 필드
</details>

<details>
<summary><b>Stations / Buses / Routes</b> (현지 정보) — 펼쳐보기</summary>

**Stations** : `id`, `tripId`, `city`, `nameKo`, `nameJa`, `nameEn`, `lines`, `lineColor`,
`stationNumber`, `exits`, `recommendedExit`, `transfers`, `elevator`, `coinLocker`, `toilet`,
`hotelRelation`, `nearby`, `mapUrl`, `officialSite`, `photoUrl`, `favorite`, `memo` + 공통 필드

**Buses** : `id`, `tripId`, `city`, `company`, `lineName`, `fromStop`, `toStop`, `fromStopJa`,
`toStopJa`, `boardingPoint`, `boardingDoor`, `alightMethod`, `icCard`, `needTicket`,
`paymentMethod`, `fare`, `durationMinutes`, `firstBus`, `lastBus`, `officialSite`, `mapUrl`,
`photoUrl`, `memo` + 공통 필드

**Routes** : `id`, `tripId`, `name`, `fromPlace`, `toPlace`, `steps`(JSON), `totalMinutes`,
`totalCost`, `lastTrain`, `caution`, `mapUrl`, `scheduleId`, `imageUrl`, `favorite`, `memo` + 공통 필드
</details>

### Apps Script API 목록

모든 요청은 하나의 웹 앱 주소로 가고, `action` 값으로 구분됩니다.

```
ping                       연결 확인 (로그인 불필요)
login / logout / validateSession
getBootstrapData           앱 시작 시 필요한 모든 데이터를 한 번에
getToday                   오늘 화면용 데이터만
getTrip / saveTrip
getSchedules / saveSchedule / deleteSchedule
getScheduleComments / saveScheduleComment / deleteScheduleComment
getReservations / saveReservation / deleteReservation
getFlights / saveFlight / deleteFlight
getAccommodations / saveAccommodation / deleteAccommodation
getDailyRecords / saveDailyRecord / deleteDailyRecord
getSharedRecords / saveSharedRecord / deleteSharedRecord
getJapanesePhrases / saveJapanesePhrase / deleteJapanesePhrase
getJapaneseWords / saveJapaneseWord / deleteJapaneseWord
getStations / saveStation / deleteStation
getBuses / saveBus / deleteBus
getRoutes / saveRoute / deleteRoute
getExpenses / saveExpense / deleteExpense
getPhotos / uploadImage / deleteImage
addReservationToSchedule
```

**응답 형식은 항상 같습니다.**

```json
{ "success": true,  "data": { }, "message": "저장되었습니다." }
{ "success": false, "error": "INVALID_SESSION", "message": "로그인이 만료되었습니다." }
```

---

## 5. 설치 안내서

> 처음이라도 **순서대로 따라 하면 30~40분** 정도면 끝납니다.
> 컴퓨터(PC)에서 진행하는 것을 권합니다.

---

### 1단계 · Google Sheets 만들기

1. 크롬 브라우저에서 <https://sheets.google.com> 에 접속합니다.
2. 왼쪽 위 **`＋ 빈 스프레드시트`** 를 누릅니다.
3. 왼쪽 위 **`제목 없는 스프레드시트`** 를 눌러 이름을 **`BestOne 여행 데이터`** 로 바꿉니다.
4. **스프레드시트 ID 를 확인합니다.** 브라우저 주소창을 보세요.

```
https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=0
                                      └──────────── 이 부분이 스프레드시트 ID ────────────┘
```

`/d/` 와 `/edit` 사이의 긴 문자열이 **SPREADSHEET_ID** 입니다.
메모장에 복사해 두세요.

> **시트 이름(탭)을 직접 만들 필요는 없습니다.**
> 5단계에서 `setupBestOneProject()` 를 실행하면
> `Settings`, `Members`, `Schedules` 등 18개 시트와 첫 줄 헤더가 자동으로 만들어집니다.

---

### 2단계 · Apps Script 열고 코드 붙여 넣기

1. 방금 만든 스프레드시트 상단 메뉴에서 **`확장 프로그램`** → **`Apps Script`** 를 누릅니다.
2. 새 탭에 코드 편집기가 열립니다. 왼쪽 파일 목록에 **`코드.gs`** (또는 `Code.gs`)가 있습니다.
3. 편집기 가운데에 이미 적혀 있는 아래 코드를 **모두 지웁니다.**

```javascript
function myFunction() {

}
```

   (편집기 안을 클릭 → `Ctrl+A` (Mac 은 `Cmd+A`) → `Delete`)

4. 이 저장소의 **`Code.gs` 파일 전체 내용을 복사**해서 그 자리에 붙여 넣습니다.
   (GitHub 에서 `Code.gs` 를 열고 오른쪽 위 **복사 아이콘**을 누르면 전체가 복사됩니다)
5. 왼쪽 위 **`프로젝트 이름`** 을 눌러 **`BestOne API`** 로 바꿉니다.
6. 상단의 **💾 저장 아이콘** 을 누릅니다. (또는 `Ctrl+S`)

---

### 3단계 · Drive 폴더 만들기 (사진 저장소)

1. <https://drive.google.com> 에 접속합니다.
2. 왼쪽 위 **`＋ 신규`** → **`새 폴더`** 를 누르고 이름을 **`BestOne 사진`** 으로 만듭니다.
3. 만든 폴더를 **더블클릭해서 들어갑니다.**
4. 주소창을 보면 이렇게 되어 있습니다.

```
https://drive.google.com/drive/folders/1XyZaBcDeFgHiJkLmNoPqRsTuVwX
                                        └───── 이 부분이 폴더 ID ─────┘
```

이 값이 **DRIVE_FOLDER_ID** 입니다. 메모장에 복사해 두세요.

> ⚠️ **업로드 파일의 공유 범위 주의**
> 앱은 사진을 올릴 때 그 파일을 **"링크가 있는 모든 사용자 - 뷰어"** 로 바꿉니다.
> 브라우저에서 `<img>` 로 사진을 보여주려면 이 설정이 필요합니다.
> 즉 **사진의 링크 주소를 아는 사람은 누구나 그 사진을 볼 수 있습니다.**
> (링크는 매우 긴 무작위 문자열이라 우연히 찾기는 어렵지만, 검색·유출 가능성은 0이 아닙니다)
> 여권·항공권·신분증처럼 **개인정보가 그대로 보이는 사진은 올리지 마세요.**
> 꼭 필요하면 이름·번호 부분을 가린 뒤 올리시길 권합니다.
> 폴더 자체는 공개되지 않으므로 폴더를 통째로 남이 볼 수는 없습니다.

---

### 4단계 · Script Properties (스크립트 속성) 설정

여기에 **비밀번호와 주소 같은 민감한 값**을 넣습니다.
이 값들은 GitHub 에도, 브라우저에도 저장되지 않습니다.

1. Apps Script 편집기 **왼쪽 메뉴**에서 **⚙️ `프로젝트 설정`** 을 누릅니다.
2. 화면을 아래로 내리면 **`스크립트 속성`** 영역이 있습니다.
3. **`스크립트 속성 추가`** 를 누르고 아래 값을 하나씩 넣습니다.
   (하나 넣을 때마다 **`스크립트 속성 저장`** 을 누르세요)

| 속성 (이름) | 값 (내용) | 설명 |
| --- | --- | --- |
| `SPREADSHEET_ID` | 1단계에서 복사한 ID | 예: `1AbCdEfGh...` |
| `DRIVE_FOLDER_ID` | 3단계에서 복사한 ID | 예: `1XyZaBcDe...` |
| `TRIP_CODE` | `bestone` | 로그인 화면에 입력할 여행 코드. 원하는 단어로 바꿔도 됩니다 |
| `SESSION_DAYS` | `180` | 로그인 유지 기간(일). 180이면 약 6개월 동안 다시 로그인하지 않아도 됩니다 |
| `TRIP_ID` | `trip-jp-2026` | 여행 구분용 ID. 아무 값이나 괜찮습니다 |

`PASSWORD_SALT` 와 `PASSWORD_HASH` 는 **다음 순서로 만듭니다.**

#### 비밀번호 해시 만들기

1. 편집기 왼쪽 **`< >` 편집기** 아이콘을 눌러 코드 화면으로 돌아갑니다.
2. `Code.gs` 안에서 `generatePasswordHash` 를 찾습니다. (`Ctrl+F` 로 검색)
3. 이 줄을 찾습니다.

```javascript
var PASSWORD = 'PUT-YOUR-PASSWORD-HERE'; // ← 여기에 원하는 비밀번호를 입력하세요
```

4. `PUT-YOUR-PASSWORD-HERE` 부분을 **두 사람이 함께 쓸 비밀번호**로 바꿉니다.
   예) `var PASSWORD = 'ourjapan2026';`
5. 💾 저장 후, 편집기 위쪽 **함수 선택 상자**에서 **`generatePasswordHash`** 를 고릅니다.
6. **▶ 실행** 버튼을 누릅니다.
   (처음 실행하면 권한 승인 창이 뜹니다 → 아래 **[권한 승인하기]** 참고)
7. 화면 아래 **`실행 로그`** 에 이런 내용이 나옵니다.

```
PASSWORD_SALT (이미 스크립트 속성에 저장됨): a1b2c3d4e5f6g7h8
PASSWORD_HASH (아래 값을 복사해서 스크립트 속성에 붙여 넣으세요):
9f2b8c1e4d7a....(64자리 긴 문자열)....
```

8. 이 **64자리 문자열을 복사**합니다.
9. 다시 **⚙️ 프로젝트 설정 → 스크립트 속성** 으로 가서 추가합니다.

| 속성 | 값 |
| --- | --- |
| `PASSWORD_HASH` | 복사한 64자리 문자열 |

   (`PASSWORD_SALT` 는 함수 실행 때 **자동으로 저장**되므로 직접 넣지 않아도 됩니다.
   목록에 없다면 로그에 나온 값을 직접 추가하세요.)

10. **⚠️ 중요** : 코드로 돌아가 `PASSWORD` 값을 다시 `'PUT-YOUR-PASSWORD-HERE'` 로 되돌리고 저장하세요.
    비밀번호 원문이 코드에 남지 않게 하기 위함입니다.
    (GitHub 에 올리는 `Code.gs` 에도 절대 원문을 넣지 마세요)

> 정리하면, **비밀번호 원문은 어디에도 저장되지 않습니다.**
> 서버에는 `salt` 와 `SHA-256 해시`만 있고, 로그인할 때 같은 방식으로 계산해 비교합니다.

#### 권한 승인하기 (처음 실행할 때 한 번만)

1. **`권한 검토`** 버튼을 누릅니다.
2. 본인 Google 계정을 선택합니다.
3. **"Google에서 확인하지 않은 앱"** 이라는 경고 화면이 나옵니다.
   → 이것은 내가 직접 만든 개인 프로젝트라 정상입니다.
4. 왼쪽 아래 **`고급`** 을 누릅니다.
5. 맨 아래 **`BestOne API(안전하지 않음)으로 이동`** 을 누릅니다.
6. **`허용`** 을 누릅니다.

---

### 5단계 · 초기화 함수 실행 (시트 자동 생성)

1. 편집기 위쪽 **함수 선택 상자**에서 **`setupBestOneProject`** 를 고릅니다.
2. **▶ 실행** 을 누릅니다.
3. 아래 **실행 로그**에 이런 내용이 나오면 성공입니다.

```
스프레드시트: BestOne 여행 데이터 (1AbCd...)
[생성] 시트 Settings
[생성] 시트 Members
... (18개)
[확인] Drive 폴더: BestOne 사진
=== setupBestOneProject 완료 ===
```

4. 스프레드시트 탭으로 돌아가 새로고침(F5)하면 아래쪽에 **시트 18개**가 생겨 있습니다.

> 이 함수는 **여러 번 실행해도 안전**합니다. 기존 데이터는 지워지지 않습니다.
> `[없음]` 이나 `[오류]` 가 보이면 4단계의 속성 값을 다시 확인하세요.
> **`checkSetup`** 함수를 실행하면 설정 상태를 한 번에 점검할 수 있습니다.

---

### 6단계 · 초기 데이터 생성

1. 함수 선택 상자에서 **`seedJapanData`** 를 고르고 **▶ 실행** 합니다.
2. 로그 예시:

```
일본어 표현 85개 추가
일본어 단어 88개 추가
샘플 역 2개 추가
샘플 버스 2개 추가
샘플 항공 2개 추가
샘플 숙소 1개 추가
샘플 일정 3개 추가
샘플 이동 경로 1개 추가
샘플 하루 기록 2개 추가
=== seedJapanData 완료 ===
```

3. 스프레드시트의 `JapanesePhrases`, `JapaneseWords` 시트를 열어 보면 내용이 채워져 있습니다.

**샘플 데이터 확인** : 각 시트의 `isSample` 열이 `TRUE` 인 행이 샘플입니다.

**샘플 데이터 삭제** : 함수 선택 상자에서 **`clearSampleData`** 를 고르고 실행하면
샘플 행만 지워집니다. (일본어 표현·단어는 샘플이 아니므로 남습니다)

---

### 7단계 · 웹 앱으로 배포하기

1. Apps Script 편집기 **오른쪽 위 파란 `배포` 버튼** → **`새 배포`** 를 누릅니다.
2. 왼쪽 위 **⚙️ (톱니바퀴) `유형 선택`** → **`웹 앱`** 을 고릅니다.
3. 아래처럼 설정합니다.

| 항목 | 설정할 값 |
| --- | --- |
| 설명 | `BestOne v1` (아무 내용이나 괜찮습니다) |
| **다음 사용자로 실행** | **`나(본인 이메일)`** |
| **액세스 권한이 있는 사용자** | **`모든 사용자`** |

> **왜 "모든 사용자" 인가요?**
> 파트너가 자기 Google 계정으로 로그인하지 않고도 앱을 쓸 수 있게 하려면 필요합니다.
> 대신 **여행 코드 + 비밀번호 + 세션 토큰**으로 앱이 직접 접근을 막습니다.
> 주소만 알아서는 데이터를 볼 수도, 고칠 수도 없습니다.

4. **`배포`** 를 누릅니다. (처음이면 권한 승인 창이 다시 나올 수 있습니다 → 4단계와 동일하게 진행)
5. **웹 앱 URL** 이 나옵니다. **`복사`** 를 누르세요.

```
https://script.google.com/macros/s/AKfycbx.....긴문자열...../exec
```

6. 이 주소를 브라우저 새 탭에 붙여 넣고 열어 보세요. 아래처럼 나오면 성공입니다.

```json
{"success":true,"data":{"app":"BestOne in Japan API", ... },"message":"BestOne API 가 정상 동작 중입니다."}
```

#### 코드를 수정한 뒤에 다시 배포하는 방법 ★중요★

`Code.gs` 를 고치면 **반드시 새 버전으로 다시 배포해야** 반영됩니다.

1. **`배포`** → **`배포 관리`**
2. 목록에서 기존 배포 오른쪽의 **✏️ 연필 아이콘** 클릭
3. **`버전`** 을 **`새 버전`** 으로 변경
4. **`배포`** 클릭

> 이 방법으로 하면 **웹 앱 URL 이 바뀌지 않습니다.**
> `새 배포` 로 만들면 주소가 새로 생기므로 `config.js` 도 고쳐야 합니다.

---

### 8단계 · GitHub 파일 설정과 GitHub Pages 배포

#### 8-1. `config.js` 에 주소 넣기

`config.js` 파일을 열어 **맨 위에서 20번째 줄쯤**에 있는 이 부분을 찾습니다.

```javascript
const API_CONFIG = {
  /** ↓↓↓ 이 값을 본인의 Apps Script 웹 앱 URL 로 바꿔주세요 ↓↓↓ */
  API_URL: 'PUT_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE',
```

`'PUT_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE'` 를 7단계에서 복사한 주소로 바꿉니다.
**작은따옴표는 지우지 마세요.**

```javascript
  API_URL: 'https://script.google.com/macros/s/AKfycbx...../exec',
```

같은 파일 아래쪽의 `DEFAULT_TRIP_CODE` 도 4단계에서 정한 `TRIP_CODE` 와 같게 맞춥니다.

```javascript
const DEFAULT_TRIP_CODE = 'bestone';
```

사용자 이름도 원하는 대로 바꿀 수 있습니다.

```javascript
const USER_PRESETS = [
  { nickname: 'chichiboo', label: '어린왕자', emoji: '⭐' },
  { nickname: 'neederes',  label: '코끼리',   emoji: '🐘' }
];
```

#### 8-2. GitHub 에 파일 올리기

**웹에서 하는 방법 (가장 쉬움)**

1. GitHub 저장소 페이지로 갑니다.
2. `config.js` 파일을 클릭 → 오른쪽 위 **✏️ (Edit this file)** 클릭
3. 주소를 넣고 아래 **`Commit changes`** 클릭

**컴퓨터에서 하는 방법**

```bash
git clone https://github.com/사용자이름/bestonejapan.git
cd bestonejapan
# config.js 를 편집기로 열어 수정
git add .
git commit -m "Apps Script URL 설정"
git push
```

#### 8-3. GitHub Pages 켜기

1. 저장소 상단 메뉴에서 **`Settings`** 를 누릅니다.
2. 왼쪽 메뉴에서 **`Pages`** 를 누릅니다.
3. **`Build and deployment`** 항목에서
   * **Source** : `Deploy from a branch`
   * **Branch** : `main` (또는 현재 브랜치) / 폴더는 `/ (root)`
4. **`Save`** 를 누릅니다.
5. 1~2분 기다린 뒤 같은 페이지를 새로고침하면 주소가 나옵니다.

```
Your site is live at https://사용자이름.github.io/bestonejapan/
```

6. 스마트폰에서 이 주소를 열어 보세요.

#### 8-4. 스마트폰에 앱으로 설치하기 (PWA)

* **안드로이드(크롬)** : 주소 열기 → 오른쪽 위 `⋮` → **`앱 설치`** 또는 **`홈 화면에 추가`**
* **아이폰(사파리)** : 주소 열기 → 아래 **공유 버튼** `⬆️` → **`홈 화면에 추가`**

---

### 9단계 · 첫 로그인

1. GitHub Pages 주소를 엽니다.
2. **여행 코드** : 4단계에서 정한 `TRIP_CODE` (예: `bestone`)
3. **비밀번호** : 4단계에서 정한 비밀번호
4. **누구신가요?** : `어린왕자` 또는 `코끼리` 를 선택 (직접 닉네임 입력도 가능)
5. **`여행 시작하기`** 를 누릅니다.

로그인이 되면 **오늘** 화면이 나오고, 6단계에서 만든 샘플 일정이 보입니다.

**로그인 오류가 날 때 확인할 것**

| 메시지 | 확인할 부분 |
| --- | --- |
| `config.js 의 API_URL 이 아직 설정되지 않았습니다` | 8-1 을 다시 확인 (주소가 `/exec` 로 끝나야 합니다) |
| `여행 코드가 올바르지 않습니다` | `TRIP_CODE` 속성과 입력한 코드가 같은지 |
| `비밀번호가 올바르지 않습니다` | `PASSWORD_HASH` 를 다시 만들어 넣기 (4단계) |
| `PASSWORD_HASH 가 설정되지 않았습니다` | 스크립트 속성에 `PASSWORD_HASH` 추가 |
| `서버에 연결하지 못했습니다` | 7단계 배포 설정에서 **액세스 권한 = 모든 사용자** 인지 |

---

### 10단계 · 파트너와 공유하기

1. 파트너에게 **GitHub Pages 주소**를 보냅니다.
   예) `https://사용자이름.github.io/bestonejapan/`
2. **여행 코드**와 **비밀번호**를 알려줍니다.
   * 🔒 **비밀번호는 공개 게시물(블로그, SNS, 공개 GitHub 이슈)에 절대 올리지 마세요.**
   * 카카오톡 등 개인 대화로 전달하고, 가능하면 전달 후 메시지를 지우세요.
3. 파트너는 로그인 화면에서 **다른 사용자**(예: 코끼리)를 선택해 로그인합니다.

**두 기기에서 잘 공유되는지 테스트하기**

1. 내 폰에서 **일정** 탭 → `＋ 일정 추가` → 제목 `테스트 일정` 저장
2. 파트너 폰에서 오른쪽 위 **⟳ 새로고침** 버튼을 누름
3. `테스트 일정` 이 보이면 성공입니다.
4. 파트너가 그 일정에 짧은 메모를 남기고, 내 폰에서 새로고침해 확인합니다.
5. 확인이 끝나면 테스트 일정은 **수정 → 삭제** 로 지웁니다.

---

### 11단계 · 오류 해결

<details open>
<summary><b>Failed to fetch (서버에 연결하지 못했습니다)</b></summary>

가장 흔한 오류입니다. 아래를 순서대로 확인하세요.

1. `config.js` 의 `API_URL` 이 **`/exec`** 로 끝나나요? (`/dev` 는 안 됩니다)
2. Apps Script **`배포` → `배포 관리`** 에서 **액세스 권한이 `모든 사용자`** 인가요?
3. 웹 앱 주소를 브라우저에 직접 붙여 넣었을 때 JSON 이 나오나요?
   * 로그인 화면이 나온다면 → 액세스 권한 설정이 잘못된 것입니다.
4. 인터넷(와이파이/데이터)이 연결되어 있나요?
5. 회사·학교 네트워크에서 `script.google.com` 이 차단된 경우가 있습니다. 다른 네트워크로 시도해 보세요.
</details>

<details>
<summary><b>CORS 오류 (Access-Control-Allow-Origin ...)</b></summary>

이 앱은 preflight 가 생기지 않도록 만들어져 있어 보통은 나지 않습니다.
그래도 난다면:

1. Apps Script 코드를 임의로 수정해 `setHeader` 등을 추가하지 않았는지 확인하세요.
   (Apps Script 는 응답 헤더를 직접 설정할 수 없습니다)
2. `Code.gs` 를 원본 그대로 다시 붙여 넣고 **새 버전으로 재배포**하세요.
3. 브라우저 확장 프로그램(광고 차단기 등)을 끄고 다시 시도해 보세요.
</details>

<details>
<summary><b>Apps Script URL 오류</b></summary>

* 주소 앞뒤에 **공백이나 따옴표가 잘못 들어가 있지 않은지** 확인하세요.
* `배포 관리` 화면에서 **활성 상태(Active)** 인 배포의 주소를 쓰세요.
* `새 배포` 를 만들면 주소가 **바뀝니다.** `config.js` 도 함께 고쳐야 합니다.
</details>

<details>
<summary><b>권한 승인 오류 / "Google에서 확인하지 않은 앱"</b></summary>

정상적인 화면입니다. 내가 만든 개인 프로젝트라서 나옵니다.

`고급` → `프로젝트 이름(안전하지 않음)으로 이동` → `허용` 순서로 진행하세요.

계속 실패하면 회사·학교 계정 정책 때문일 수 있습니다. 개인 Gmail 계정으로 진행해 보세요.
</details>

<details>
<summary><b>시트를 찾을 수 없음 / 정의되지 않은 시트입니다</b></summary>

1. `setupBestOneProject()` 를 실행했나요? (5단계)
2. 시트 이름을 손으로 바꾸지 않았나요? 대소문자까지 정확해야 합니다. (`Schedules`, `Flights` …)
3. 이름을 잘못 바꿨다면 원래 이름으로 되돌리거나, 그 시트를 삭제하고
   `setupBestOneProject()` 를 다시 실행하세요. (데이터는 사라지니 주의)
</details>

<details>
<summary><b>Script Properties 누락</b></summary>

Apps Script 에서 **`checkSetup`** 함수를 실행하세요.
`[없음]` 으로 표시되는 속성을 **⚙️ 프로젝트 설정 → 스크립트 속성** 에서 추가하면 됩니다.
</details>

<details>
<summary><b>로그인 실패</b></summary>

* 비밀번호를 바꾸고 싶다면 `generatePasswordHash()` 를 다시 실행해
  새 `PASSWORD_HASH` 를 넣으세요.
* `PASSWORD_SALT` 를 바꾸면 **기존 비밀번호가 모두 무효**가 됩니다.
  salt 를 바꿨다면 해시도 반드시 다시 만들어야 합니다.
* 여행 코드 대소문자는 구분하지 않습니다.
</details>

<details>
<summary><b>세션 만료 (로그인이 만료되었습니다)</b></summary>

* `SESSION_DAYS` 값을 늘리면 더 오래 유지됩니다. (예: `365`)
* 브라우저의 "사이트 데이터 삭제"를 하면 토큰이 지워져 다시 로그인해야 합니다.
* 시크릿 모드에서는 앱을 닫으면 토큰이 사라집니다.
</details>

<details>
<summary><b>사진 업로드 실패</b></summary>

1. `DRIVE_FOLDER_ID` 가 스크립트 속성에 있나요?
2. 그 폴더가 **삭제되거나 휴지통에 있지 않은지** 확인하세요.
3. 파일이 너무 크지 않은지 확인하세요. (앱이 자동 압축하지만 원본 20MB 초과는 거부합니다)
4. Google Drive 저장 용량이 가득 찼는지 확인하세요.
5. 지원 형식 : JPEG, PNG, WebP, PDF
</details>

<details>
<summary><b>Drive 폴더 권한 오류</b></summary>

* 폴더를 만든 계정과 Apps Script 를 실행하는 계정이 **같아야** 합니다.
* 회사·학교 계정은 "링크가 있는 모든 사용자에게 공개"가 정책상 막혀 있을 수 있습니다.
  이 경우 사진은 저장되지만 앱에서 미리보기가 안 보일 수 있습니다.
  → 개인 Gmail 계정으로 만드는 것을 권장합니다.
</details>

<details>
<summary><b>GitHub Pages 에서 예전 코드가 보이는 캐시 문제</b> ★자주 발생★</summary>

수정한 내용이 반영되지 않을 때는 순서대로 시도하세요.

1. **`service-worker.js`** 파일을 열어 맨 위 줄의 버전을 올립니다.

   ```javascript
   const CACHE_VERSION = 'v1';   →   const CACHE_VERSION = 'v2';
   ```

   저장 후 GitHub 에 다시 올리면 브라우저가 새 파일을 받아옵니다.

2. **강력 새로고침**
   * PC 크롬 : `Ctrl + Shift + R` (Mac: `Cmd + Shift + R`)
   * 안드로이드 크롬 : `⋮` → `설정` → `개인정보 보호` → `인터넷 사용 기록 삭제` → `캐시된 이미지 및 파일`
   * 아이폰 사파리 : `설정` 앱 → `Safari` → `방문 기록 및 웹사이트 데이터 지우기`

3. 홈 화면에 설치한 앱이라면 **삭제 후 다시 설치**합니다.

4. GitHub Actions 탭에서 **`pages build and deployment`** 가 초록색(성공)인지 확인합니다.
   배포는 보통 1~2분 걸립니다.
</details>

---

## 6. 테스트 방법

아래 순서대로 확인하면 모든 핵심 기능을 점검할 수 있습니다.
두 대의 기기(또는 브라우저 2개 - 하나는 시크릿 창)로 진행하세요.

| # | 테스트 | 방법 | 기대 결과 |
| --- | --- | --- | --- |
| 1 | **사용자 1 로그인** | 기기 A에서 `어린왕자` 선택 후 로그인 | 오늘 화면이 뜨고 오른쪽 위에 닉네임 표시 |
| 2 | **사용자 2 로그인** | 기기 B에서 `코끼리` 선택 후 로그인 | 같은 여행 데이터가 보임 |
| 3 | **사용자 1이 일정 추가** | 기기 A → 일정 탭 → `＋ 일정 추가` → 저장 | "저장되었습니다" 토스트 |
| 4 | **사용자 2가 확인** | 기기 B → 오른쪽 위 `⟳` | 새 일정이 보이고 작성자 배지가 파란색(상대방) |
| 5 | **사용자 2가 기록 작성** | 기기 B → 기록 탭 → `✍️ 내 기록` → 저장 | 저장 후 기록 카드가 나타남 |
| 6 | **사용자 1이 기록 확인** | 기기 A → 기록 탭 → 같은 날짜 | 두 사람의 기록이 나란히 보임 |
| 7 | **사진 업로드** | 기록 탭 → 사진 → `＋ 업로드` → 사진 선택 | 진행 막대 후 미리보기 표시. Drive 폴더에도 파일 생성 |
| 8 | **일본어 즐겨찾기** | 현지 탭 → 표현 → `☆` 클릭 | `⭐` 로 바뀌고, 오늘 화면 "즐겨찾는 일본어"에 나타남 |
| 9 | **역 정보 추가** | 현지 탭 → 역 정보 → `＋ 역 추가` | 저장 후 목록에 표시, `역명 크게 보기` 동작 |
| 10 | **로그아웃 후 재로그인** | ☰ → 로그아웃 → 다시 로그인 | 정상 로그인, 데이터 유지 |
| 11 | **세션 만료 처리** | 브라우저 개발자도구 → Application → Local Storage → `bestone_jp_token` 값을 아무 문자로 바꾸고 새로고침 | "로그인이 만료되었습니다" 안내 후 로그인 화면 |
| 12 | **잘못된 비밀번호** | 로그아웃 후 틀린 비밀번호 입력 | "비밀번호가 올바르지 않습니다" 표시, 로그인 안 됨 |
| 13 | **인터넷 연결 실패** | 비행기 모드 켜고 앱 실행 | "오프라인 - 저장된 자료" 표시, 마지막 자료 열람 가능 |
| 14 | **오프라인 작성 보관** | 비행기 모드에서 일정 저장 시도 | "작성 내용은 이 기기에 임시 저장했습니다" → ☰ → 임시 저장에서 확인 → 온라인 후 `다시 저장` |
| 15 | **연속 저장 방지** | 저장 버튼을 빠르게 여러 번 누름 | 첫 클릭 후 버튼이 "저장 중…" 으로 잠김. 중복 생성 안 됨 |
| 16 | **동시 수정 충돌** | 두 기기에서 같은 일정을 열고 A 저장 → B 저장 | B에서 "다른 사람이 먼저 수정했습니다" 안내 후 선택 가능 |
| 17 | **모바일 화면 확인** | 스마트폰 세로/가로, 태블릿, PC | 레이아웃이 깨지지 않고 버튼이 충분히 큼 |
| 18 | **PWA 설치** | 홈 화면에 추가 후 실행 | 주소창 없이 앱처럼 실행됨 |

---

## 7. 자주 발생하는 오류 해결

위 [11단계](#11단계--오류-해결) 를 참고하세요. 그 밖의 상황은 아래와 같습니다.

| 증상 | 원인과 해결 |
| --- | --- |
| 저장은 되는데 화면에 안 보임 | `isDeleted` 가 `TRUE` 인지 시트에서 확인. `⟳` 새로고침 |
| 날짜가 하루 밀려 보임 | 앱은 **Asia/Tokyo** 기준으로 계산합니다. 한국에서 접속해도 동일합니다. 시트에 직접 입력할 때는 `2026-04-20` 형식(문자)으로 넣으세요 |
| 시트에 직접 입력했는데 앱에 안 나옴 | `id` 칸이 비어 있으면 안 됩니다. 아무 고유 문자열이나 넣으세요. `isDeleted` 는 비우거나 `FALSE` |
| "다른 저장이 진행 중입니다" | 두 사람이 동시에 저장할 때 잠깐 나옵니다. 잠시 후 다시 시도 |
| Apps Script 실행 시간 초과 | 데이터가 아주 많을 때. `ActivityLogs` 시트의 오래된 행을 지우면 빨라집니다 |
| 일본어 음성이 안 나옴 | 기기에 일본어 음성이 없을 수 있습니다. (안드로이드: 설정 → 언어 → 텍스트 음성 변환에서 일본어 설치) |
| 사진이 깨져 보임 | Drive 파일 공유 설정이 "링크가 있는 사용자"인지 확인 (3단계 주의사항) |

---

## 8. 다른 나라 버전으로 바꾸는 방법

국가 정보가 코드 전체에 흩어져 있지 않고 **`config.js` 한 곳**에 모여 있습니다.

### 8-1. 프런트엔드 (`config.js`)

```javascript
const COUNTRY_CONFIG = {
  code: 'FR',
  nameKo: '프랑스',
  nameEn: 'France',
  currency: 'EUR',
  currencySymbol: '€',
  timezone: 'Europe/Paris',
  language: 'fr',
  speechLang: 'fr-FR',
  appName: 'BestOne in France',
  subtitle: '«어린왕자와 코끼리의 프랑스 여행»',
  localLabels: {
    phrases: '프랑스어 표현',
    words: '프랑스어 단어장',
    stations: '역 정보',
    buses: '버스 정보',
    routes: '이동 경로'
  },
  emergency: [
    { label: '통합 긴급전화', value: '112' },
    { label: '주프랑스 대한민국 대사관', value: '+33-1-4753-0101' }
  ],
  externalLinks: [
    { label: 'Google 지도', url: 'https://www.google.com/maps' },
    { label: 'SNCF Connect', url: 'https://www.sncf-connect.com/' }
  ]
};
```

`API_CONFIG.STORAGE_PREFIX` 도 함께 바꾸면 (`bestone_fr_`) 나라별 데이터가 섞이지 않습니다.

### 8-2. 시간대 처리 (`script.js`)

`script.js` 위쪽의 이 상수를 바꾸세요.

```javascript
const TZ_OFFSET_HOURS = 9;   // Asia/Tokyo
```

| 나라 | 값 |
| --- | --- |
| 일본 | `9` |
| 태국 | `7` |
| 영국 | `0` (여름 서머타임 기간에는 `1`) |
| 프랑스 | `1` (여름 서머타임 기간에는 `2`) |

### 8-3. 백엔드 (`Code.gs`)

1. **새 스프레드시트**와 **새 Apps Script 프로젝트**를 만드세요. (나라별로 분리하는 편이 안전합니다)
2. `Code.gs` 안의 아래 부분을 바꿉니다.

```javascript
function todayJst_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');   // ← 시간대 변경
}
```

`readSheetObjects_` 안의 `'Asia/Tokyo'` 도 같은 값으로 바꾸면 됩니다.

3. `SEED_PHRASES_()` 와 `SEED_WORDS_()` 의 내용을 그 나라 언어로 교체합니다.
   형식만 유지하면 됩니다.
   * 표현 : `['카테고리', '한국어', '현지어', '한국어식 읽는 법']`
   * 단어 : `['카테고리', '현지어', '읽는 법', '한국어']`
4. `setupBestOneProject()` 안의 기본값(`country`, `city`, `currency`, `timezone`, `emergencyContact`)을 바꿉니다.

### 8-4. 화면 문구

`index.html` 의 아래 부분은 `config.js` 값으로 자동 교체되지만, 초기 표시값도 바꿔두면 깔끔합니다.

```html
<span id="brandCountry">Japan</span>
<span class="brand-sub" id="brandSubtitle">«어린왕자와 코끼리의 일본 여행»</span>
```

시트 구조와 API 는 나라와 관계없이 **그대로 사용**할 수 있습니다.

---

## 9. 개인정보 · 보안 주의사항

* 이 앱은 **공개 서비스가 아니라 두 사람이 쓰는 개인 앱**입니다. 회원가입 기능은 없습니다.
* **비밀번호 원문은 어디에도 저장되지 않습니다.** (salt + SHA-256 해시만 서버에 보관)
* **프런트엔드 코드(`config.js`, `script.js`)에는 비밀번호가 없습니다.** GitHub 에 공개해도 됩니다.
* Apps Script 웹 앱 주소만으로는 데이터를 읽거나 고칠 수 없습니다.
  모든 요청에 **세션 토큰**이 필요하고, 서버에서 검증합니다.
* 다만 이 앱은 **금융·의료 수준의 보안 체계는 아닙니다.**
  * 여권 번호, 신용카드 번호, 주민등록번호는 **입력하지 마세요.**
  * 여권 사진, 신분증 사진은 **올리지 마세요.**
  * 항공권 QR 은 좌석 확인용으로만 쓰고, 여행이 끝나면 삭제하시길 권합니다.
* Drive 에 올린 사진은 **링크를 아는 사람이 볼 수 있는 상태**가 됩니다. ([3단계 주의사항](#3단계--drive-폴더-만들기-사진-저장소))
* 여행이 끝나면
  1. Apps Script → `배포 관리` → 배포를 **보관 처리(Archive)** 하거나
  2. `TRIP_CODE` / `PASSWORD_HASH` 를 바꿔 두시면 더 안전합니다.

---

## 삽화에 대해

앱의 그림(로그인 화면의 사막·별·달·작은 여행자, 아이콘)은
《어린 왕자》의 모티프에서 영감을 받아 **이 프로젝트를 위해 새로 그린 SVG·PNG 그림**입니다.
원작 삽화는 나라에 따라 아직 저작권이 남아 있어 그대로 사용하지 않았습니다.
직접 구한 이미지를 쓰고 싶다면 `icons/` 폴더의 파일을 교체하거나
`index.html` 의 `<svg class="login-art">` 부분을 `<img>` 태그로 바꾸면 됩니다.

---

> «여행 전에는 함께 준비하고, 여행 중에는 서로를 돕고, 여행 후에는 둘만의 이야기를 남긴다.»
