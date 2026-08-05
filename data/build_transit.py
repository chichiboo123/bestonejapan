# -*- coding: utf-8 -*-
"""
BestOne in Japan - 노선 데이터 생성 스크립트

출처(모두 오픈 소스/오픈 데이터):
  1) 도쿄권 : nagix/mini-tokyo-3d (MIT) data/railways.json + data/stations.json
     - 한국어 역명 · 노선 색 · 역 순서 · 좌표 포함
  2) 역 번호 : piuccio/open-data-jp-railway-stations (ekidata 기반) short_code
  3) 삿포로/홋카이도 : piuccio/open-data-jp-railway-stations (ekidata 기반)
     - ekidata_id = 노선ID(5자리) + 순번(2자리) 이므로 역 순서를 복원할 수 있음
     - 한국어 역명은 이 저장소에서 직접 붙임(아래 KO_HOKKAIDO)

사용법 (data/ 폴더에서 실행):

    curl -O https://raw.githubusercontent.com/nagix/mini-tokyo-3d/master/data/railways.json
    curl -O https://raw.githubusercontent.com/nagix/mini-tokyo-3d/master/data/stations.json
    curl -o jp-stations.json https://raw.githubusercontent.com/piuccio/open-data-jp-railway-stations/master/stations.json
    python3 build_transit.py
"""
import json, io, collections

OUT = 'transit.js'   # 이 스크립트가 있는 data/ 폴더에 생성됩니다

rw = json.load(open('railways.json'))
st = json.load(open('stations.json'))
jp = json.load(open('jp-stations.json'))

station_by_id = {s['id']: s for s in st}

# ---- 역 번호(JY01 등) 매핑: piuccio 데이터의 code -> short_code ----
short_code = {}
for g in jp:
    for s in g['stations']:
        if s.get('code') and s.get('short_code'):
            short_code[s['code']] = s['short_code']

def rnd(v):
    return round(float(v), 5)

# =====================================================================
# 1) 도쿄권
# =====================================================================
# 여객 영업을 하지 않는 화물선·연결선은 길찾기에 혼선을 주므로 제외합니다
EXCLUDE = {'JR-East.YamanoteFreight', 'JR-East.TokaidoFreight', 'JR-East.OsakiBranch'}

tokyo_lines = []
for r in rw:
    if r['id'] in EXCLUDE:
        continue
    ids = r.get('stations') or []
    if len(ids) < 2:
        continue
    loop = ids[0] == ids[-1]
    if loop:
        ids = ids[:-1]
    stations = []
    for sid in ids:
        s = station_by_id.get(sid)
        if not s:
            continue
        t = s.get('title', {})
        c = s.get('coord') or [None, None]
        entry = {
            'ko': t.get('ko') or t.get('en') or t.get('ja') or '',
            'ja': t.get('ja') or '',
            'en': t.get('en') or '',
        }
        if short_code.get(sid):
            entry['c'] = short_code[sid]
        if c[0] is not None:
            entry['g'] = [rnd(c[1]), rnd(c[0])]   # [lat, lon]
        stations.append(entry)
    if len(stations) < 2:
        continue
    t = r.get('title', {})
    tokyo_lines.append({
        'id': r['id'],
        'ko': t.get('ko') or t.get('en') or r['id'],
        'ja': t.get('ja') or '',
        'en': t.get('en') or '',
        'op': r['id'].split('.')[0],
        'color': r.get('color') or '#7d9db3',
        'loop': loop,
        'stations': stations,
    })

# =====================================================================
# 2) 삿포로 / 홋카이도
# =====================================================================
KO_HOKKAIDO = {
    # 지하철 남북선
    '麻生': '아사부', '北３４条': '기타34조', '北２４条': '기타24조', '北１８条': '기타18조',
    '北１２条': '기타12조', 'さっぽろ': '삿포로', '大通': '오도리', 'すすきの': '스스키노',
    '中島公園': '나카지마 공원', '幌平橋': '호로히라바시', '中の島': '나카노시마', '平岸': '히라기시',
    '南平岸': '미나미히라기시', '澄川': '스미카와', '自衛隊前': '지에이타이마에', '真駒内': '마코마나이',
    # 지하철 동서선
    '宮の沢': '미야노사와', '発寒南': '핫사무미나미', '琴似': '고토니', '二十四軒': '니주욘켄',
    '西２８丁目': '니시28초메', '円山公園': '마루야마 공원', '西１８丁目': '니시18초메',
    '西１１丁目': '니시11초메', 'バスセンター前': '버스센터마에', '菊水': '기쿠스이',
    '東札幌': '히가시삿포로', '白石': '시로이시', '南郷７丁目': '난고7초메', '南郷１３丁目': '난고13초메',
    '南郷１８丁目': '난고18초메', '大谷地': '오야치', 'ひばりが丘': '히바리가오카', '新さっぽろ': '신삿포로',
    # 지하철 동풍선
    '栄町': '사카에마치', '新道東': '신도히가시', '元町': '모토마치', '環状通東': '간조도리히가시',
    '東区役所前': '히가시쿠야쿠쇼마에', '北１３条東': '기타13조히가시', '豊水すすきの': '호스이스스키노',
    '学園前': '가쿠엔마에', '豊平公園': '도요히라 공원', '美園': '미소노', '月寒中央': '쓰키사무추오',
    '福住': '후쿠즈미',
    # 시전(노면전차)
    '西４丁目': '니시4초메', '西８丁目': '니시8초메', '中央区役所前': '주오쿠야쿠쇼마에',
    '西１５丁目': '니시15초메', '西線６条': '니시센6조', '西線９条旭山公園通': '니시센9조 아사히야마공원도리',
    '西線１１条': '니시센11조', '西線１４条': '니시센14조', '西線１６条': '니시센16조',
    'ロープウェイ入口': '로프웨이 입구', '電車事業所前': '덴샤지교쇼마에', '中央図書館前': '주오도서관마에',
    '石山通': '이시야마도리', '東屯田通': '히가시톤덴도리', '幌南小学校前': '고난초등학교마에',
    '山鼻１９条': '야마하나19조', '静修学園前': '세이슈가쿠엔마에', '行啓通': '교케이도리',
    '中島公園通': '나카지마공원도리', '山鼻９条': '야마하나9조', '東本願寺前': '히가시혼간지마에',
    '資生館小学校前': '시세이칸초등학교마에', '狸小路': '다누키코지',
    # JR 지토세선
    '苫小牧': '도마코마이', '沼ノ端': '누마노하타', '植苗': '우에나에', '新千歳空港': '신치토세공항',
    '南千歳': '미나미치토세', '千歳': '치토세', '長都': '오사쓰', 'サッポロビール庭園': '삿포로비루테이엔',
    '恵庭': '에니와', '恵み野': '메구미노', '島松': '시마마쓰', '北広島': '기타히로시마',
    '上野幌': '가미노폿포로', '新札幌': '신삿포로', '平和': '헤이와', '苗穂': '나에보', '札幌': '삿포로',
    # JR 하코다테 본선 (오타루~이와미자와)
    '小樽': '오타루', '南小樽': '미나미오타루', '小樽築港': '오타루칫코', '朝里': '아사리',
    '銭函': '제니바코', 'ほしみ': '호시미', '星置': '호시오키', '稲穂': '이나호', '手稲': '데이네',
    '稲積公園': '이나즈미 공원', '発寒': '핫사무', '発寒中央': '핫사무추오', '桑園': '소엔',
    '厚別': '아쓰베쓰', '森林公園': '신린 공원', '大麻': '오아사', '野幌': '노포로', '高砂': '다카사고',
    '江別': '에베쓰', '豊幌': '도요호로', '幌向': '호로무이', '上幌向': '가미호로무이', '岩見沢': '이와미자와',
}

HOKKAIDO_LINES = [
    ('99102', '삿포로 지하철 남북선', '札幌市営地下鉄南北線', 'Namboku Line',  '삿포로시영지하철', '#00a54f', None),
    ('99101', '삿포로 지하철 동서선', '札幌市営地下鉄東西線', 'Tozai Line',    '삿포로시영지하철', '#f39700', None),
    ('99103', '삿포로 지하철 동풍선', '札幌市営地下鉄東豊線', 'Toho Line',     '삿포로시영지하철', '#0080c6', None),
    ('99104', '삿포로 시전(노면전차)', '札幌市電',            'Sapporo Streetcar', '삿포로시전',   '#009944', None),
    ('11109', 'JR 지토세선',           'JR千歳線',            'JR Chitose Line', 'JR홋카이도',    '#2f6f4f', None),
    ('11103', 'JR 하코다테 본선',      'JR函館本線',          'JR Hakodate Line', 'JR홋카이도',   '#2f6f4f', '岩見沢'),
]

by_line = collections.defaultdict(list)
for g in jp:
    for s in g['stations']:
        by_line[s['ekidata_line_id']].append(s)

sapporo_lines = []
for lid, ko, ja, en, op, color, cut_after in HOKKAIDO_LINES:
    rows = sorted(by_line.get(lid, []), key=lambda s: s['ekidata_id'])
    stations = []
    for s in rows:
        name = s['name_kanji']
        entry = {'ko': KO_HOKKAIDO.get(name, name), 'ja': name, 'en': ''}
        if s.get('lat'):
            entry['g'] = [rnd(s['lat']), rnd(s['lon'])]
        stations.append(entry)
        if cut_after and name == cut_after:
            break
    if len(stations) < 2:
        print('  [건너뜀]', lid, ko)
        continue
    sapporo_lines.append({
        'id': 'Sapporo.' + lid, 'ko': ko, 'ja': ja, 'en': en,
        'op': op, 'color': color, 'loop': False, 'stations': stations,
    })
    miss = [s['ja'] for s in stations if s['ko'] == s['ja']]
    print(f'  {ko}: {len(stations)}역' + (f'  (한국어 미매핑 {len(miss)}: {miss[:4]})' if miss else ''))

# =====================================================================
# 3) 파일로 저장
# =====================================================================
data = {
    'meta': {
        'sources': [
            {'name': 'nagix/mini-tokyo-3d', 'license': 'MIT',
             'url': 'https://github.com/nagix/mini-tokyo-3d', 'use': '도쿄권 노선·역·한국어 역명·노선색'},
            {'name': 'piuccio/open-data-jp-railway-stations', 'license': 'MIT (ekidata 기반)',
             'url': 'https://github.com/piuccio/open-data-jp-railway-stations', 'use': '역 번호, 삿포로·홋카이도 노선/역 순서'},
        ],
        'note': '실시간 운행·요금은 포함되지 않습니다. 구글 지도/공식 사이트를 함께 확인하세요.',
    },
    'cities': [
        {'key': 'tokyo', 'ko': '도쿄', 'lines': tokyo_lines},
        {'key': 'sapporo', 'ko': '삿포로 · 홋카이도', 'lines': sapporo_lines},
    ],
}

body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
out = ('/* 자동 생성 파일 - build_transit.py 로 만들었습니다. 직접 고치지 마세요.\n'
       '   출처: nagix/mini-tokyo-3d (MIT), piuccio/open-data-jp-railway-stations (MIT)\n'
       '*/\n'
       'window.TRANSIT_DATA = ' + body + ';\n')
io.open(OUT, 'w', encoding='utf-8').write(out)

nt = sum(len(l['stations']) for l in tokyo_lines)
ns = sum(len(l['stations']) for l in sapporo_lines)
print()
print(f'도쿄권   : {len(tokyo_lines)}개 노선 / {nt}개 역')
print(f'삿포로권 : {len(sapporo_lines)}개 노선 / {ns}개 역')
print(f'파일 크기: {len(out)/1024:.0f} KB  ->  {OUT}')
