// Recorded-shape Wikidata Query Service responses for the nationwide/worldwide place sync
// (edge-functions/_shared/global-places.mjs), used by tests/global-places.test.mjs and qa/global-places.spec.mjs.
// Bindings have exactly the columns buildBranchQuery() selects. Real QIDs are used for real places; the
// Q991000xx items are fictional test data (they stand for "many places in one country" in pagination tests).
export { commonsPage, commonsResponse } from './live-media-fixtures.mjs'

const lit = (value, lang) => ({ type: 'literal', value, ...(lang ? { 'xml:lang': lang } : {}) })

// One SPARQL JSON binding. country is "Q…|label" exactly like the query's ?country column.
export function wdqsRow({ qid, ko, en, dko, den, coord, image, country, admin, site, kind, sitelinks = 0 }) {
  return {
    item: { type: 'uri', value: `http://www.wikidata.org/entity/${qid}` },
    ...(ko ? { label_ko: lit(ko, 'ko') } : {}),
    ...(en ? { label_en: lit(en, 'en') } : {}),
    ...(dko ? { desc_ko: lit(dko, 'ko') } : {}),
    ...(den ? { desc_en: lit(den, 'en') } : {}),
    ...(coord ? { coord: { datatype: 'http://www.opengis.net/ont/geosparql#wktLiteral', type: 'literal', value: coord } } : {}),
    ...(image ? { image: { type: 'uri', value: 'http://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(image) } } : {}),
    ...(country ? { country: lit(country) } : {}),
    ...(admin ? { admin: lit(admin) } : {}),
    ...(site ? { site: { type: 'uri', value: site } } : {}),
    ...(kind ? { kind: lit(kind) } : {}),
    sitelinks: { datatype: 'http://www.w3.org/2001/XMLSchema#integer', type: 'literal', value: String(sitelinks) },
  }
}

export function wdqsBranch(rows) {
  return {
    head: { vars: ['item', 'label_ko', 'label_en', 'desc_ko', 'desc_en', 'coord', 'image', 'country', 'admin', 'site', 'kind', 'sitelinks'] },
    results: { bindings: rows.map(wdqsRow) },
  }
}

const KR = 'Q884|대한민국'

// Korean places. The first three duplicate curated places (by name, host building and exact name) and must be hidden.
export const KOREA = {
  ddp: { qid: 'Q5295847', ko: '동대문디자인플라자', en: 'Dongdaemun Design Plaza', coord: 'Point(127.0095 37.5665)', country: KR, admin: '중구', kind: 'Media Facade', sitelinks: 30 },
  lotteTower: { qid: 'Q494895', ko: '롯데월드타워', en: 'Lotte World Tower', coord: 'Point(127.1025 37.5125)', country: KR, admin: '송파구', kind: 'Architectural Lighting', sitelinks: 60 },
  nTower: { qid: 'Q69134', ko: 'N서울타워', en: 'N Seoul Tower', coord: 'Point(126.9882 37.5512)', country: KR, admin: '용산구', kind: 'Nightscape', sitelinks: 70 },
  jinju: { qid: 'Q12618343', ko: '진주남강유등축제', en: 'Jinju Namgang Yudeung Festival', dko: '경상남도 진주시 남강 일대에서 열리는 유등 축제', coord: 'Point(128.0847 35.1856)', image: 'Jinju lantern festival.jpg', country: KR, admin: '진주시', kind: 'Festival', sitelinks: 8 },
  gwangan: { qid: 'Q485443', ko: '광안대교', en: 'Gwangan Bridge', dko: '부산 수영구와 해운대구를 잇는 현수교', coord: 'Point(129.1186 35.1475)', image: 'Gwangan Bridge night.jpg', country: KR, admin: '수영구', site: 'http://example.org/insecure', kind: 'Architectural Lighting', sitelinks: 20 },
  lantern: { qid: 'Q12859650', ko: '서울빛초롱축제', en: 'Seoul Lantern Festival', coord: 'Point(126.9784 37.5690)', country: KR, admin: '중구', kind: 'Festival', sitelinks: 3 },
}

// Places in other countries. Coordinates are WKT, longitude first (Sydney is lon 151, lat -33).
export const WORLD = {
  vivid: { qid: 'Q7937834', ko: '비비드 시드니', en: 'Vivid Sydney', dko: '시드니에서 열리는 빛·음악·아이디어 축제', coord: 'Point(151.2093 -33.8688)', image: 'Vivid Sydney 2019.jpg', country: 'Q408|오스트레일리아', admin: '시드니', site: 'https://www.vividsydney.com/', kind: 'Festival', sitelinks: 25 },
  lyon: { qid: 'Q4167', ko: '빛의 축제', en: 'Festival of Lights', dko: '프랑스 리옹의 빛 축제', coord: 'Point(4.8357 45.7640)', image: 'Fete des Lumieres Lyon.jpg', country: 'Q142|프랑스', admin: '리옹', kind: 'Festival', sitelinks: 30 },
  graz: { qid: 'Q597137', ko: '쿤스트하우스 그라츠', en: 'Kunsthaus Graz', coord: 'Point(15.4339 47.0713)', image: 'Kunsthaus Graz.jpg', country: 'Q40|오스트리아', admin: '그라츠', kind: 'Media Facade', sitelinks: 20 },
  // Labels are plain text: tags are stripped, but entity-encoded markup decodes to literal "<img …>" text that the
  // app must escape when it renders it.
  xss: { qid: 'Q99100099', ko: '&lt;img src=x onerror="window.__xss=1"&gt;빛', en: 'Test <script>alert(1)</script>', dko: '<b>굵게</b> 설명', coord: 'Point(2.35 48.85)', country: 'Q142|프랑스', admin: '파리', kind: 'Light Art', sitelinks: 1 },
}

// 30 fictional light installations in Tokyo: more than one page (24) of results for one country.
export const JAPAN = Array.from({ length: 30 }, (_, i) => ({
  qid: 'Q991000' + String(i + 10), ko: `도쿄 빛 설치 ${String(i + 1).padStart(2, '0')}`, en: `Tokyo light installation ${i + 1}`,
  coord: `Point(${(139.70 + i * 0.002).toFixed(4)} ${(35.66 + i * 0.001).toFixed(4)})`, country: 'Q17|일본', admin: '미나토구', kind: 'Light Art', sitelinks: 0,
}))

// What each branch returns in the browser tests. Branches not listed return no rows; FAILING ones fail.
export const BRANCH_ROWS = {
  'korea:seeds': [KOREA.ddp, KOREA.lotteTower, KOREA.nTower, KOREA.jinju, { ...KOREA.gwangan, kind: 'Architectural Lighting' }, KOREA.lantern],
  'korea:classes': [{ ...KOREA.gwangan, kind: 'Nightscape' }, { ...KOREA.lantern, kind: 'Festival' }],
  'world:seeds': [WORLD.vivid, WORLD.lyon, WORLD.graz],
  'world:classes-art': [...JAPAN, WORLD.xss],
  'world:parts': [{ ...WORLD.graz, kind: 'Architectural Lighting' }],
}
export const FAILING = { 'world:genres': 'http500', 'world:lantern': 'invalid' }

export const FILES = {
  'Vivid Sydney 2019.jpg': { artist: '<a href="//commons.wikimedia.org/wiki/User:Lee">Lee Photographer</a>', license: 'CC BY-SA 4.0', date: '2019-05-30 19:02:11', url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Vivid_Sydney_2019.jpg' },
  // Korean freedom of panorama: shown under the MEDIA_KR_FOP_DISPLAY policy.
  'Jinju lantern festival.jpg': { artist: 'Park', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0', templates: ['Template:NoFoP-South Korea'], url: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Jinju_lantern_festival.jpg' },
  'Gwangan Bridge night.jpg': { artist: 'Choi', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Gwangan_Bridge_night.jpg' },
  // Blocked: France has no freedom of panorama (and the Korean exception does not apply abroad).
  'Fete des Lumieres Lyon.jpg': { artist: 'Martin', license: 'CC BY-SA 4.0', templates: ['Template:NoFoP-France'], url: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Fete_des_Lumieres_Lyon.jpg' },
  // Blocked: non-commercial license.
  'Kunsthaus Graz.jpg': { artist: 'Huber', license: 'CC BY-NC 4.0', url: 'https://upload.wikimedia.org/wikipedia/commons/3/34/Kunsthaus_Graz.jpg' },
}
