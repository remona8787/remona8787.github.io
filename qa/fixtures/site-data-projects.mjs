// Test fixture for the static archive dataset (docs/STATIC_ARCHIVE.md "Output" and its v0.18 addendum, docs/UI_v018.md):
// well-known media facade, projection, light art and festival projects in Korea (every one of the eight regions) and
// across the world, with the hard cases the UI must handle (no images, only daytime context images, a small image
// that must never fill a large slot, a video, a curated seed place with coordinates, long and non-Latin names). TEST DATA: names and places are real projects, but coordinates, years, images and sources are
// plausible values written for tests, not verified facts. Image files are named Fixture_… and never exist on Commons;
// the specs route every image request to a local file. Never publish this as the archive.
//
// Image kinds per project (k): 'hero' = night, media visibly running, reviewed for the hero (v0.18 tier 1); 'night' =
// media active at night (tier 1); 'art' = architectural media art (tier 2); 'led' = LED or projection visible (tier 3);
// 'scene' = an exhibition or installation scene (tier 4); 'day' = daytime architectural context (tier 5); 'small' = a
// media-active photo only 500 px wide (it may fill a card, never a hero or a featured slot); no kind = no image at all
// (the UI draws the designed placeholder).
export const PROJECTS = [
  // Curated seed places keep their ids (SEOUL…) in the dataset and carry its coordinates.
  // id, name_ko, name_en, name_original (lang), iso, city, lat, lng, type, year, images, extra
  ['kunsthaus-graz-bix', '쿤스트하우스 그라츠 BIX 파사드', 'Kunsthaus Graz BIX facade', ['Kunsthaus Graz BIX-Fassade', 'de'], 'AT', 'Graz', 47.0712, 15.4342, 'media_facade', 2003, ['hero', 'night', 'day'], { credits: [['architect', 'Peter Cook, Colin Fournier'], ['media_artist', 'realities:united']], technologies: ['led_mono', 'pixel_points'], method: 'led_backlit_cladding', envelope: 'membrane_etfe' }],
  ['ars-electronica-center', '아르스 일렉트로니카 센터', 'Ars Electronica Center', ['Ars Electronica Center', 'de'], 'AT', 'Linz', 48.3096, 14.2843, 'media_facade', 2009, ['hero', 'art', 'day'], { credits: [['architect', 'Treusch architecture'], ['operator', 'Ars Electronica Linz']], technologies: ['led_rgb', 'realtime_data'], method: 'led_media_glass', envelope: 'glass_curtain_wall', video: true, visit: { status: 'operating', note: { ko: '해가 진 뒤 매일 밤 점등', en: 'Lit every night after sunset' } } }],
  ['uniqa-tower', '우니카 타워 미디어파사드', 'Uniqa Tower media facade', ['Uniqa Tower', 'de'], 'AT', 'Vienna', 48.2117, 16.38, 'media_facade', 2004, ['night'], { technologies: ['led_rgb'], method: 'led_linear_pixel', envelope: 'glass_curtain_wall' }],
  ['allianz-arena', '알리안츠 아레나', 'Allianz Arena', ['Allianz Arena', 'de'], 'DE', 'Munich', 48.2188, 11.6247, 'media_architecture', 2005, ['night', 'day'], { credits: [['architect', 'Herzog & de Meuron']], envelope: 'membrane_etfe' }],
  ['festival-of-lights-berlin', '베를린 빛의 축제', 'Festival of Lights Berlin', ['Festival of Lights', 'de'], 'DE', 'Berlin', 52.5163, 13.3777, 'festival_program', 2005, ['hero', 'art'], { visit: { status: 'event_based', period: { ko: '매년 10월', en: 'Every October' } } }],
  ['fete-des-lumieres', '리옹 빛의 축제', 'Fête des Lumières', ['Fête des Lumières', 'fr'], 'FR', 'Lyon', 45.764, 4.8357, 'festival_program', 1999, ['hero', 'night', 'art'], { visit: { status: 'event_based', period: { ko: '매년 12월 8일 전후 나흘', en: 'Four nights around 8 December' } } }],
  ['amsterdam-light-festival', '암스테르담 빛 축제', 'Amsterdam Light Festival', ['Amsterdam Light Festival', 'nl'], 'NL', 'Amsterdam', 52.3676, 4.9041, 'festival_program', 2012, ['art'], {}],
  ['glow-eindhoven', '글로우 아인트호번', 'GLOW Eindhoven', ['GLOW Eindhoven', 'nl'], 'NL', 'Eindhoven', 51.4416, 5.4697, 'festival_program', 2006, ['led'], {}],
  ['lumiere-durham', '루미에르 더럼', 'Lumiere Durham', ['Lumiere', 'en'], 'GB', 'Durham', 54.7753, -1.5849, 'festival_program', 2009, ['night'], {}],
  ['piccadilly-lights', '피카딜리 라이츠', 'Piccadilly Lights', ['Piccadilly Lights', 'en'], 'GB', 'London', 51.5101, -0.1342, 'urban_screen', 1908, ['day'], { method: 'led_cabinet_screen' }],
  ['torre-glories', '토레 글로리에스 조명', 'Torre Glòries lighting', ['Torre Glòries', 'ca'], 'ES', 'Barcelona', 41.4036, 2.1894, 'media_facade', 2005, ['led', 'day'], { credits: [['architect', 'Jean Nouvel']], technologies: ['led_rgb'], method: 'led_linear_pixel' }],
  ['medialab-prado', '메디아랩 프라도 디지털 파사드', 'Medialab-Prado digital facade', ['Fachada digital de Medialab-Prado', 'es'], 'ES', 'Madrid', 40.4106, -3.6934, 'media_facade', 2010, [], { technologies: ['led_mono', 'pixel_points'], method: 'led_linear_pixel' }],
  ['harpa-reykjavik', '하르파 콘서트홀 파사드', 'Harpa facade', ['Harpa', 'is'], 'IS', 'Reykjavík', 64.1505, -21.9327, 'media_facade', 2011, ['night', 'day'], { credits: [['architect', 'Henning Larsen'], ['artist', 'Olafur Eliasson']] }],
  ['signal-festival-prague', '시그널 페스티벌', 'Signal Festival', ['Signal Festival', 'cs'], 'CZ', 'Prague', 50.087, 14.4208, 'festival_program', 2013, ['art'], {}],
  ['circle-of-light-moscow', '모스크바 빛의 원 축제', 'Circle of Light Moscow', ['Круг света', 'ru'], 'RU', 'Moscow', 55.7539, 37.6208, 'festival_program', 2011, ['night'], {}],
  ['burj-khalifa-led', '부르즈 할리파 LED 파사드', 'Burj Khalifa LED facade', ['برج خليفة', 'ar'], 'AE', 'Dubai', 25.1972, 55.2744, 'media_facade', 2019, ['hero', 'night'], { technologies: ['led_rgb'], method: 'led_linear_pixel' }],
  ['al-bahr-towers', '알 바르 타워', 'Al Bahr Towers', ['أبراج البحر', 'ar'], 'AE', 'Abu Dhabi', 24.4886, 54.3615, 'media_architecture', 2012, ['day'], { method: 'kinetic' }],
  ['crown-fountain', '크라운 분수', 'Crown Fountain', ['Crown Fountain', 'en'], 'US', 'Chicago', 41.8815, -87.6237, 'media_wall', 2004, ['night', 'day'], { credits: [['artist', 'Jaume Plensa']], method: 'led_cabinet_screen' }],
  ['times-square-screens', '타임스스퀘어 스크린', 'Times Square screens', ['Times Square', 'en'], 'US', 'New York', 40.758, -73.9855, 'urban_screen', 1990, ['night'], {}],
  ['the-bay-lights', '더 베이 라이츠', 'The Bay Lights', ['The Bay Lights', 'en'], 'US', 'San Francisco', 37.7983, -122.3778, 'light_art', 2013, ['hero', 'led'], { credits: [['artist', 'Leo Villareal']], technologies: ['led_mono', 'generative'] }],
  ['quartier-des-spectacles', '카르티에 데 스펙타클 프로젝션', 'Quartier des Spectacles projections', ['Quartier des spectacles', 'fr'], 'CA', 'Montreal', 45.5088, -73.5617, 'projection_mapping', 2009, ['art'], {}],
  ['filux-mexico', '필룩스 빛 축제', 'FILUX Festival', ['Festival Internacional de las Luces', 'es'], 'MX', 'Mexico City', 19.4326, -99.1332, 'festival_program', 2016, [], {}],
  ['fiesp-galeria-digital', '피에스피 갤러리 디지털', 'FIESP Digital Art Gallery', ['Galeria de Arte Digital do SESI-SP', 'pt'], 'BR', 'São Paulo', -23.5614, -46.6559, 'media_facade', 2012, ['led'], {}],
  ['vivid-sydney', '비비드 시드니', 'Vivid Sydney', ['Vivid Sydney', 'en'], 'AU', 'Sydney', -33.8568, 151.2153, 'festival_program', 2009, ['hero', 'night', 'art'], { visit: { status: 'event_based', period: { ko: '매년 5월 말–6월', en: 'Late May to June every year' } } }],
  ['badu-gili', '바두 길리 프로젝션', 'Badu Gili', ['Badu Gili', 'en'], 'AU', 'Sydney', -33.8572, 151.2151, 'projection_mapping', 2017, ['art'], { visit: { status: 'operating', note: { ko: '매일 밤 정해진 시각에 상영', en: 'Shown nightly at set times' } } }],
  ['symphony-of-lights', '심포니 오브 라이츠', 'A Symphony of Lights', ['幻彩詠香江', 'zh'], 'HK', 'Hong Kong', 22.2934, 114.1719, 'festival_program', 2004, ['night'], {}],
  ['marina-bay-spectra', '스펙트라 빛과 물의 쇼', 'Spectra light and water show', ['Spectra', 'en'], 'SG', 'Singapore', 1.2834, 103.8607, 'projection_mapping', 2017, ['night'], {}],
  ['kinetic-rain', '키네틱 레인', 'Kinetic Rain', ['Kinetic Rain', 'en'], 'SG', 'Singapore', 1.3554, 103.9864, 'light_art', 2012, ['led', 'day'], { method: 'kinetic' }],
  ['teamlab-planets', '팀랩 플래닛', 'teamLab Planets TOKYO', ['チームラボプラネッツ', 'ja'], 'JP', 'Tokyo', 35.6491, 139.7898, 'interactive_installation', 2018, ['art'], { credits: [['artist', 'teamLab']], technologies: ['laser_projector', 'sensors'] }],
  ['shibuya-crossing-screens', '시부야 교차로 스크린', 'Shibuya Crossing screens', ['渋谷スクランブル交差点', 'ja'], 'JP', 'Tokyo', 35.6595, 139.7005, 'urban_screen', 2000, ['day'], {}],
  ['water-cube', '워터 큐브', 'Beijing National Aquatics Center', ['国家游泳中心', 'zh'], 'CN', 'Beijing', 39.9928, 116.3843, 'media_architecture', 2008, ['night'], { envelope: 'membrane_etfe' }],
  // Korea: every region (kr_region, as the pipeline derives it from the administrative chain).
  ['galleria-centercity', '갤러리아 센터시티', 'Galleria Centercity', ['갤러리아 센터시티', 'ko'], 'KR', 'Cheonan', 36.8188, 127.1559, 'media_facade', 2010, ['night', 'day'], { kr: 'daejeon_sejong_chungcheong', credits: [['architect', 'UNStudio']], technologies: ['led_rgb'], method: 'led_media_glass' }],
  ['seoul-square-media-canvas', '서울스퀘어 미디어 캔버스', 'Seoul Square Media Canvas', ['서울스퀘어 미디어 캔버스', 'ko'], 'KR', 'Seoul', 37.5555, 126.9732, 'media_facade', 2009, ['hero', 'art'], { kr: 'seoul', technologies: ['led_mono'], method: 'led_linear_pixel' }],
  ['SEOUL006', '서울라이트 DDP', 'Seoul Light DDP', ['서울라이트 DDP', 'ko'], 'KR', 'Seoul', 37.5665, 127.0095, 'projection_mapping', 2019, ['hero', 'night'], { kr: 'seoul' }],
  ['lotte-world-tower-facade', '롯데월드타워 미디어파사드', 'Lotte World Tower media facade', ['롯데월드타워', 'ko'], 'KR', 'Seoul', 37.5125, 127.1025, 'media_facade', 2017, ['led'], { kr: 'seoul' }],
  ['coex-kpop-square-wave', '코엑스 K-POP 스퀘어 웨이브', 'COEX K-POP Square WAVE', ['코엑스 K-POP 스퀘어', 'ko'], 'KR', 'Seoul', 37.5126, 127.0592, 'urban_screen', 2020, ['hero', 'night', 'day'], { kr: 'seoul', technologies: ['led_rgb'], method: 'led_cabinet_screen', visit: { status: 'operating', note: { ko: '매일 낮과 밤 정해진 시각에 상영', en: 'Shown daily at set times' } } }],
  ['seoul-lantern-festival', '서울빛초롱축제', 'Seoul Lantern Festival', ['서울빛초롱축제', 'ko'], 'KR', 'Seoul', 37.5692, 126.9784, 'festival_program', 2009, ['night', 'art'], { kr: 'seoul', visit: { status: 'event_based', period: { ko: '매년 12월–1월', en: 'December to January every year' } } }],
  ['gwangan-bridge-lights', '광안대교 경관조명', 'Gwangan Bridge lights', ['광안대교', 'ko'], 'KR', 'Busan', 35.1475, 129.13, 'light_art', 2003, ['night'], { kr: 'busan_ulsan_gyeongnam', envelope: 'bridge_infrastructure' }],
  ['jinju-namgang-yudeung', '진주남강유등축제', 'Jinju Namgang Yudeung Festival', ['진주남강유등축제', 'ko'], 'KR', 'Jinju', 35.1886, 128.0807, 'festival_program', 2000, ['night'], { kr: 'busan_ulsan_gyeongnam', visit: { status: 'event_based', period: { ko: '매년 10월', en: 'Every October' } } }],
  ['haeundae-light-festival', '해운대 빛축제', 'Haeundae Light Festival', ['해운대 빛축제', 'ko'], 'KR', 'Busan', 35.1587, 129.1604, 'festival_program', 2014, ['led'], { kr: 'busan_ulsan_gyeongnam' }],
  ['SEOUL001', '아뜰리에 노들', 'Atelier Nodeul', ['아뜰리에 노들', 'ko'], 'KR', 'Seoul', 37.5176, 126.9599, 'media_facade', 2024, [], { kr: 'seoul' }],
  ['convention-centre-atrium-long', '컨벤션 센터 북측 아트리움 인터랙티브 미디어 파사드 2단계 확장 프로젝트 (국제 공모 당선작)', 'Convention Centre North Atrium Interactive Facade, Phase Two Extension (International Competition Winner)', null, 'KR', 'Goyang', 37.6688, 126.7453, 'interactive_installation', 2021, [], { kr: 'gyeonggi_incheon' }],
  ['inspire-aurora', '인스파이어 오로라', 'INSPIRE Aurora', ['인스파이어 오로라', 'ko'], 'KR', 'Incheon', 37.4625, 126.3863, 'media_wall', 2024, ['art', 'small'], { kr: 'gyeonggi_incheon', technologies: ['led_rgb'] }],
  ['suwon-hwaseong-media-art', '수원 화성 미디어아트', 'Suwon Hwaseong Media Art', ['수원 화성 미디어아트', 'ko'], 'KR', 'Suwon', 37.2871, 127.0119, 'projection_mapping', 2016, ['small'], { kr: 'gyeonggi_incheon' }],
  ['arte-museum-gangneung', '아르떼뮤지엄 강릉', 'ARTE MUSEUM Gangneung', ['아르떼뮤지엄 강릉', 'ko'], 'KR', 'Gangneung', 37.7919, 128.9197, 'media_architecture', 2021, ['scene', 'art'], { kr: 'gangwon' }],
  ['hanbit-tower-facade', '한빛탑 미디어파사드', 'Hanbit Tower media facade', ['한빛탑', 'ko'], 'KR', 'Daejeon', 36.3758, 127.3874, 'media_facade', 2021, ['night'], { kr: 'daejeon_sejong_chungcheong' }],
  ['acc-media-wall', '국립아시아문화전당 미디어월', 'ACC Media Wall', ['국립아시아문화전당 미디어월', 'ko'], 'KR', 'Gwangju', 35.1468, 126.92, 'media_wall', 2015, ['hero', 'led'], { kr: 'gwangju_jeolla', credits: [['architect', 'Kyu Sung Woo']] }],
  ['gwangju-media-art-festival', '광주 미디어아트 페스티벌', 'Gwangju Media Art Festival', ['광주 미디어아트 페스티벌', 'ko'], 'KR', 'Gwangju', 35.1495, 126.9172, 'festival_program', 2012, ['art'], { kr: 'gwangju_jeolla' }],
  ['gyeongju-woljeonggyo', '경주 월정교 야간경관', 'Woljeonggyo Bridge night lighting', ['월정교', 'ko'], 'KR', 'Gyeongju', 35.8296, 129.2187, 'light_art', 2018, ['night', 'day'], { kr: 'daegu_gyeongbuk' }],
  ['arte-museum-jeju', '아르떼뮤지엄 제주', 'ARTE MUSEUM Jeju', ['아르떼뮤지엄 제주', 'ko'], 'KR', 'Jeju', 33.3964, 126.345, 'media_architecture', 2020, ['scene'], { kr: 'jeju' }],
  ['bunker-de-lumieres-jeju', '빛의 벙커', 'Bunker de Lumières', ['빛의 벙커', 'ko'], 'KR', 'Seogwipo', 33.4367, 126.9157, 'projection_mapping', 2018, ['art', 'scene'], { kr: 'jeju', visit: { status: 'operating', note: { ko: '연중 상설 전시', en: 'Open all year' } } }],
  ['cairo-tower-show', '카이로 타워 라이트 쇼', 'Cairo Tower light show', ['برج القاهرة', 'ar'], 'EG', 'Cairo', 30.0459, 31.2243, 'media_architecture', 2009, ['led'], {}],
]

// v0.18 image objects (docs/STATIC_ARCHIVE.md v0.18 addendum): provider, display sizes, rights, measurements, tier
// (1–6), role and the editorial verdict. Commons-shaped URLs, so the specs can answer every request with a local file.
const TIER = { hero: 1, night: 1, art: 2, led: 3, scene: 4, day: 5, small: 1 }
const ROLE = { hero: 'hero', night: 'featured', art: 'card', led: 'card', scene: 'gallery', day: 'context', small: 'card' }
const ACTIVE = { hero: 92, night: 88, art: 74, led: 61, scene: 48, day: 4, small: 85 }
export const DISPLAY_WIDTHS = [330, 500, 960, 1280, 1920, 3840]
export const BUILD_ID = 'fixture-2026-10-20T06-17Z'
const at = '2026-10-20T06:17:00Z'

function image(id, kind, i) {
  const file = `Fixture_${id}_${kind}_${i + 1}.jpg`, h = (id.length * 7 + i) % 16, hh = h.toString(16) + ((id.length + i * 3) % 16).toString(16)
  const path = `${h.toString(16)}/${hh}/${file}`, W = kind === 'small' ? 500 : 4000, H = kind === 'day' ? Math.round(W * 2 / 3) : Math.round(W * 3 / 4)
  const thumb = w => `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}/${w}px-${file}`
  const display = kind === 'small' ? [[500, `https://upload.wikimedia.org/wikipedia/commons/${path}`]] : DISPLAY_WIDTHS.filter(w => w < W).map(w => [w, thumb(w)])
  return {
    id: `img-${id}-${i + 1}`, project: id, provider: 'commons',
    src: `https://upload.wikimedia.org/wikipedia/commons/${path}`, page: `https://commons.wikimedia.org/wiki/File:${file}`, display,
    thumb: kind === 'small' ? `https://upload.wikimedia.org/wikipedia/commons/${path}` : thumb(500), thumb_w: 500,
    author: 'Fixture Photographer ' + (i + 1), rights_holder: null, attribution: null,
    license: i % 3 === 0 ? 'CC BY-SA 4.0' : i % 3 === 1 ? 'CC BY 2.0' : 'CC0 1.0',
    license_url: i % 3 === 0 ? 'https://creativecommons.org/licenses/by-sa/4.0' : i % 3 === 1 ? 'https://creativecommons.org/licenses/by/2.0' : 'https://creativecommons.org/publicdomain/zero/1.0/',
    usage: 'hotlink', width: W, height: H, bytes: W * H / 4, format: 'jpeg',
    quality: { sharpness: 0.81, blockiness: 0.04, score: 0.86 }, media_active: ACTIVE[kind],
    tier: TIER[kind], role: ROLE[kind], home_ok: TIER[kind] <= 3, checked_at: at, approved: ['hero', 'night'].includes(kind) ? true : null,
  }
}
// The same image as the pipeline wrote it before v0.18 (no provider, display or verdict; tiers 1–4), for the
// fallback specs.
const V17_TIER = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4 }
export function v17Image(m) { if (!m) return m; const { id, project, provider, display, rights_holder, usage, bytes, format, quality, media_active, checked_at, approved, thumb_w, ...rest } = m; return { ...rest, tier: V17_TIER[m.tier], role: m.role === 'context' ? 'context' : m.tier === 1 ? (m.role === 'hero' ? 'hero' : 'media_active') : m.tier === 2 ? 'media_art' : 'lighting' } }
// Shards as the pipeline makes them (pipeline/lib/output.mjs): FNV-1a of the id modulo a power-of-two shard count.
const fnv1a = text => { let h = 0x811c9dc5; for (const b of new TextEncoder().encode(String(text))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 } return h >>> 0 }
const shardCount = (n, target) => { let c = 1; while (n / c > target) c *= 2; return c }
export const shardOf = (id, count) => String(fnv1a(id) % count).padStart(3, '0')

export function record([id, ko, en, orig, iso, city, lat, lng, type, year, kinds, x], i) {
  const images = kinds.map((k, j) => image(id, k, j))
  return {
    id, name_ko: ko, name_en: en, name_original: orig?.[0] || null, name_original_lang: orig?.[1] || null, aliases: [],
    country_iso2: iso, city, lat, lng, project_type: type, year_installed: year, year_completed: null, operating_status: x.visit?.status || null,
    installation_method: x.method || null, envelope_type: x.envelope || null, technologies: x.technologies || [], content_types: [],
    credits: (x.credits || []).map(([role, name]) => ({ role, name })), curated_place_id: x.curated || null, ...(iso === 'KR' ? { kr_region: x.kr || null } : {}),
    ...(KR_PLACE[id] ? { city_ko: KR_PLACE[id][0], ...(KR_PLACE[id][1] ? { district: KR_PLACE[id][1] } : {}) } : {}),
    summary_ko: `${ko}: 시험용 요약 문장입니다. 실제 기록이 아닙니다.`, summary_en: `${en}: a test summary sentence, not a real record.`,
    wikidata: null, official_url: null,
    images, videos: x.video ? [{ src: `https://upload.wikimedia.org/wikipedia/commons/${'a'}/${'a1'}/Fixture_${id}_video.webm`, poster: images[0]?.thumb || null, page: `https://commons.wikimedia.org/wiki/File:Fixture_${id}_video.webm`, license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0', author: 'Fixture Videographer', role: 'media_active' }] : [],
    sources: [{ kind: 'wikipedia', title: en, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(en.replace(/ /g, '_'))}`, publisher: 'Wikipedia' }, { kind: 'commons', title: 'Category:' + en, url: `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(en.replace(/ /g, '_'))}`, publisher: 'Wikimedia Commons' }],
    visit: x.visit ? { status: x.visit.status, note: x.visit.note || null, period: x.visit.period || null } : null,
    added_at: new Date(Date.parse(at) - i * 36e5 * 7).toISOString(),
    shard: '000', // set by siteData()
  }
}
// The card image: the best tier, and never a context photo while a media-active one exists (the pipeline's rule).
const best = r => [...r.images].sort((a, b) => a.tier - b.tier)[0] || null
export const INDEX_FIELDS = ['id', 'name_ko', 'name_en', 'name_original', 'country_iso2', 'city', 'lat', 'lng', 'project_type', 'year', 'thumb', 'visual_rank', 'shard', 'added_at', 'kr_region', 'thumb_w', 'thumb_h', 'city_ko', 'district']
// Korean city names and districts (시·군·구) of some Korean projects, for the drill-down of a region page (v0.18). The
// others have none, as in the live data, and count under 위치 미상.
const KR_PLACE = { 'seoul-square-media-canvas': ['서울', '중구'], 'lotte-world-tower-facade': ['서울', '송파구'], 'coex-kpop-square-wave': ['서울', '강남구'], 'gwangan-bridge-lights': ['부산', '수영구'], 'haeundae-light-festival': ['부산', '해운대구'], 'jinju-namgang-yudeung': ['진주시', null] }
const REGION = { AT: 'europe', DE: 'europe', FR: 'europe', NL: 'europe', GB: 'europe', ES: 'europe', IS: 'europe', CZ: 'europe', RU: 'europe', AE: 'middle_east', EG: 'africa', US: 'north_america', CA: 'north_america', MX: 'latin_america', BR: 'latin_america', AU: 'oceania', HK: 'east_asia', SG: 'southeast_asia', JP: 'east_asia', CN: 'east_asia', KR: 'east_asia' }
export const KR_REGIONS = ['seoul', 'gyeonggi_incheon', 'gangwon', 'daejeon_sejong_chungcheong', 'gwangju_jeolla', 'daegu_gyeongbuk', 'busan_ulsan_gyeongnam', 'jeju']
const FACADE = ['media_facade', 'projection_mapping', 'urban_screen', 'media_wall']
const card = (r, img = best(r)) => ({ id: r.id, name_ko: r.name_ko, name_en: r.name_en, name_original: r.name_original, country_iso2: r.country_iso2, ...(r.country_iso2 === 'KR' ? { kr_region: r.kr_region } : {}), city: r.city, lat: r.lat, lng: r.lng, project_type: r.project_type, year: r.year_installed, shard: r.shard, image: img })
// Visual rank of the index (the app's card tier 1–4): v0.18 tiers 1–3 as they are, 4 (a scene) with 3, 5 (context) as 4.
const RANK = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4 }

// The five files of site-data/ for a list of records. Used by the fixture writer and by the large-dataset specs.
// The index follows the pipeline (pipeline/lib/output.mjs buildIndex): visual_rank is the card image's tier, added_at a
// date, kr_region and the thumbnail's size (v0.18), and with compact: true the Commons thumbnails are stored as
// "<h>/<hh>/<File>" with one thumb_template, as the pipeline does above 512 KB.
// home: 'v18' (docs/UI_v018.md: hero, kr_regions, kr_featured, kr_programs, world, counts) or 'v17' (featured, regions,
// types, themes, recent, with images as the pipeline wrote them before v0.18).
const THUMB_TEMPLATE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/{path}/500px-{file}'
const compactThumb = url => { const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/([0-9a-f]\/[0-9a-f]{2}\/([^/]+))\/500px-([^/]+)$/.exec(url || ''); return m && m[2] === m[3] ? m[1] : url }
// shardTarget: about how many records per shard (the pipeline uses 200; the small UI fixture 16, so it has several).
export function siteData(input, { buildId = BUILD_ID, generatedAt = at, compact = false, shardTarget = 16, home: shape = 'v18' } = {}) {
  const n = shardCount(input.length, shardTarget)
  const records = input.map(r => ({ ...r, shard: shardOf(r.id, n), images: shape === 'v17' ? r.images.map(v17Image) : r.images }))
  const count = (f, list = records) => list.reduce((o, r) => { const k = f(r); if (k) o[k] = (o[k] || 0) + 1; return o }, {})
  const shards = Array.from({ length: n }, (_, i) => String(i).padStart(3, '0')).filter(s => records.some(r => r.shard === s))
  const rank = b => !b ? null : shape === 'v17' ? b.tier : RANK[b.tier]
  const index = { schema: 1, fields: shape === 'v17' ? INDEX_FIELDS.slice(0, 14) : INDEX_FIELDS, ...(compact ? { thumb_template: THUMB_TEMPLATE } : {}), rows: records.map(r => { const b = best(r); const row = [r.id, r.name_ko, r.name_en, r.name_original, r.country_iso2, r.city, r.lat, r.lng, r.project_type, r.year_installed, b ? (compact ? compactThumb(b.thumb) : b.thumb) : null, rank(b), r.shard, r.added_at.slice(0, 10)]; return shape === 'v17' ? row : [...row, r.kr_region ?? null, b ? 500 : null, b ? Math.round(500 * b.height / b.width) : null, r.city_ko ?? null, r.district ?? null] }) }
  const active = i => shape === 'v17' ? i.tier <= 3 : i.tier <= 4 && i.role !== 'context'
  const large = i => (i.width || 0) >= 1600
  const lit = records.filter(r => best(r) && active(best(r)))
  const isHero = i => i.role === 'hero' && large(i)
  const kr = records.filter(r => r.country_iso2 === 'KR'), world = records.filter(r => r.country_iso2 !== 'KR')
  const heroRecs = [...kr, ...world].filter(r => r.images.some(isHero))
  const byRegion = count(r => REGION[r.country_iso2]), byType = count(r => r.project_type), byCountry = count(r => r.country_iso2)
  const repFor = (f, list = lit) => { const r = list.find(x => f(x) && large(best(x))); return r ? { project: r.id, image: best(r) } : {} }
  const hero = heroRecs.slice(0, 6).map(r => ({ project: r.id, image: r.images.find(isHero) }))
  const krLit = kr.filter(r => best(r) && active(best(r)))
  const home = shape === 'v17' ? {
    schema: 1, build_id: buildId, generated_at: generatedAt,
    counts: { projects: records.length, countries: Object.keys(byCountry).length, with_images: records.filter(r => r.images.length).length },
    hero, featured: lit.filter(r => !hero.some(h => h.project === r.id)).slice(0, 8).map(r => r.id),
    regions: Object.entries(byRegion).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, count: n, ...repFor(r => REGION[r.country_iso2] === key) })),
    types: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, count: n, ...repFor(r => r.project_type === key) })),
    themes: [], recent: [...records].sort((a, b) => b.added_at.localeCompare(a.added_at)).slice(0, 8).map(r => r.id), projects: {},
  } : {
    schema: 1, build_id: buildId, generated_at: generatedAt,
    counts: { projects: records.length, countries: Object.keys(byCountry).length, with_images: records.filter(r => r.images.length).length, kr: kr.length, world: world.length },
    hero,
    kr_regions: KR_REGIONS.map(key => ({ key, count: kr.filter(r => r.kr_region === key).length, ...repFor(r => r.kr_region === key, krLit) })),
    kr_featured: krLit.filter(r => FACADE.includes(r.project_type) && !hero.some(h => h.project === r.id)).slice(0, 6).map(r => r.id),
    kr_programs: krLit.filter(r => !FACADE.includes(r.project_type)).slice(0, 8).map(r => r.id),
    world: {
      count: world.length,
      highlights: world.filter(r => best(r) && active(best(r)) && large(best(r))).slice(0, 6).map(r => r.id),
      regions: Object.entries(count(r => REGION[r.country_iso2], world)).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, count: n, ...repFor(r => REGION[r.country_iso2] === key && r.country_iso2 !== 'KR') })),
      countries: Object.entries(count(r => r.country_iso2, world)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => ({ key, count: n })),
    },
    projects: {},
  }
  const named = shape === 'v17' ? [...home.featured, ...home.recent, ...home.regions.map(x => x.project), ...home.types.map(x => x.project)] : [...home.kr_featured, ...home.kr_programs, ...home.world.highlights, ...home.kr_regions.map(x => x.project), ...home.world.regions.map(x => x.project)]
  for (const id of new Set([...hero.map(h => h.project), ...named].filter(Boolean))) home.projects[id] = card(records.find(r => r.id === id))
  const manifest = {
    schema: 1, build_id: buildId, generated_at: generatedAt,
    counts: { projects: records.length, with_images: records.filter(r => r.images.length).length, with_hero: heroRecs.length, by_type: byType, by_region: byRegion, by_country: byCountry, ...(shape === 'v17' ? {} : { kr: kr.length, world: world.length, by_kr_region: count(r => r.kr_region, kr) }) },
    files: { index: 'index.json', home: 'home.json', shards: shards.map(s => `projects/${s}.json`) },
    sources: { wikidata: { status: 'ok', last_success: generatedAt, items: records.length } },
    note: 'TEST FIXTURE: plausible values, not verified facts',
  }
  const shardFiles = Object.fromEntries(shards.map(s => [s, { shard: s, build_id: buildId, projects: records.filter(r => r.shard === s) }]))
  const stats = { build_id: buildId, counts: manifest.counts }
  return { manifest, index, home, shards: shardFiles, stats }
}

// The place page's regression case (fifth brief): SEOUL006 has photos of the work running, a daytime architecture
// photo, a portrait of its credited artist and an unrelated photo the pipeline marked unverified (role_v2). The
// gallery shows the first kind only, 추가 자료 the architecture photo, the credits the portrait, and nothing the last.
function regressionCase(r) {
  if (r.id !== 'SEOUL006') return r
  const v2 = (m, role_v2, more = {}) => ({ ...m, role_v2, ...more })
  return {
    ...r,
    credits: [{ role: 'media_artist', name: 'Fixture Artist' }, { role: 'operator', name: '서울디자인재단' }],
    images: [
      ...r.images.map(m => v2(m, 'project_media')),
      v2(image(r.id, 'art', 2), 'project_media'),
      v2(image(r.id, 'day', 3), 'architecture_context'),
      v2(image(r.id, 'scene', 4), 'artist_portrait', { subject: 'Fixture Artist', caption: 'Portrait of Fixture Artist' }),
      v2(image(r.id, 'night', 5), 'unverified', { caption: 'An unrelated person at night' }),
    ],
  }
}
export const RECORDS = PROJECTS.map(record).map(regressionCase)

// Many synthetic records (test-only, never written to site-data/): for list/count/map equality and timing at scale.
export function manyRecords(n) {
  const types = ['media_facade', 'projection_mapping', 'light_art', 'festival_program', 'urban_screen', 'media_architecture', 'interactive_installation', 'media_wall']
  const isos = Object.keys(REGION)
  return Array.from({ length: n }, (_, i) => {
    const base = PROJECTS[i % PROJECTS.length], iso = isos[i % isos.length]
    const kinds = i % 5 === 0 ? [] : i % 5 === 1 ? ['day'] : i % 5 === 2 ? ['night'] : i % 5 === 3 ? ['art', 'day'] : ['led']
    const lat = i % 17 === 0 ? null : Math.round((-55 + ((i * 37) % 1200) / 10) * 1e4) / 1e4, lng = i % 17 === 0 ? null : Math.round((-170 + ((i * 53) % 3400) / 10) * 1e4) / 1e4
    return record([`scale-${String(i).padStart(5, '0')}`, `규모 시험 프로젝트 ${i}`, `Scale test project ${i}`, null, iso, base[5], lat, lng, types[i % types.length], 1990 + (i % 36), kinds, {}], i)
  })
}
