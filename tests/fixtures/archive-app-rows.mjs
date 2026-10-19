// Recorded-shape rows of public.public_archive_projects (docs/ARCHIVE_SPEC.md §4) for the app track's tests
// (tests/archive-app.test.mjs, tests/app.test.cjs and qa/archive.spec.mjs). Thirty projects across every region with
// the hard cases: missing, city-level and unsourced coordinates, broken and unlicensed media, unicode and
// decomposed names, an Arabic (RTL) name, very long titles, a broken official link, researcher assessments,
// projects linked to curated places (by curated_place_id, QID and name + city) and projects that are Wikidata items
// of the browser-sync fixtures (by wikidata_qid and discovered_qid). Test data: values are plausible, not verified.
// The QIDs Q996… are fictional; Q597137, Q4167, Q7937834 and Q5295847 are the real items the sync fixtures use.

const AT = '2026-10-17T21:00:00.000Z'
const base = {
  name_original: null, name_original_lang: null, name_en: null, name_ko: null, aliases: [],
  country_iso2: null, region: null, city: null, district: null, address: null, latitude: null, longitude: null, location_precision: 'unknown',
  year_installed: null, year_completed: null, year_operating_since: null, year_ended: null, operating_status: null,
  building_name: null, project_type: null, installation_method: null, envelope_type: null, technology: [], display_area_m2: null,
  resolution_text: null, pixel_pitch_mm: null, content_type: [], interactive: null,
  viewing_points: null, spatial_context: [], urban_context: null, summary_ko: null, summary_en: null,
  wikidata_qid: null, official_url: null, discovered_qid: null, curated_place_id: null,
  record_origin: 'auto_collected', review_status: 'unreviewed', update_status: 'current', field_status: {},
  first_collected_at: '2026-09-01T03:00:00.000Z', last_collected_at: AT, last_verified_at: null, created_at: '2026-09-01T03:00:00.000Z', updated_at: AT,
  credits: [], sources: [], media: [], assessments: [],
}
const verified = (...fields) => Object.fromEntries(fields.map(f => [f, { state: 'editor_verified', at: '2026-10-10T00:00:00.000Z' }]))
const reported = (...fields) => Object.fromEntries(fields.map(f => [f, { state: 'source_reported' }]))
const src = (o) => ({ title: null, url: null, publisher: null, kind: 'news', language: 'en', published_at: null, retrieved_at: '2026-09-01T03:00:00.000Z', last_checked_at: '2026-10-15T03:00:00.000Z', link_state: 'ok', reliability: 55, license: null, supports: [], ...o })
const photo = (o) => ({ url: null, page_url: null, license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0', author: 'Archive Photographer', attribution: null, is_primary: true, ...o })
const p = (o) => ({ ...base, ...o })

export const ARCHIVE_ROWS = [
  // Europe
  p({ slug: 'ars-electronica-center', name_original: 'Ars Electronica Center', name_original_lang: 'de', name_en: 'Ars Electronica Center', name_ko: '아르스 일렉트로니카 센터', aliases: ['AEC'],
    country_iso2: 'AT', region: 'europe', city: 'Linz', address: 'Ars-Electronica-Straße 1, 4040 Linz', latitude: 48.3096, longitude: 14.2843, location_precision: 'exact',
    year_installed: 2009, year_completed: 2009, operating_status: 'operating', building_name: 'Ars Electronica Center',
    project_type: 'media_facade', installation_method: 'led_media_glass', envelope_type: 'glass_curtain_wall', technology: ['led_rgb', 'realtime_data'], display_area_m2: 5100, content_type: ['artwork', 'generative'], interactive: true,
    viewing_points: '도나우강 건너편 우어파르 강변', spatial_context: ['waterfront', 'cultural_district'], urban_context: '린츠 도나우강 북쪽 강변의 미디어아트 센터',
    summary_ko: '유리 외피 전체가 LED로 빛나는 린츠의 미디어아트 센터.', summary_en: 'A media art centre in Linz whose glass skin is lit by LEDs.',
    official_url: 'https://ars.electronica.art/center/', record_origin: 'editor_created', review_status: 'researcher_assessed', last_verified_at: '2026-10-10T00:00:00.000Z',
    field_status: { ...verified('latitude', 'longitude', 'project_type', 'installation_method', 'year_installed'), ...reported('display_area_m2', 'envelope_type'), interactive: { state: 'researcher_assessed' } },
    credits: [{ role: 'architect', name: 'Treusch architecture', name_en: 'Treusch architecture', wikidata_qid: null }, { role: 'operator', name: 'Ars Electronica Linz GmbH', name_en: null, wikidata_qid: null }],
    sources: [src({ title: 'Ars Electronica Center', url: 'https://ars.electronica.art/center/', publisher: 'Ars Electronica', kind: 'official', reliability: 90, supports: ['latitude', 'longitude', 'year_installed', 'operating_status'] }),
      src({ title: 'Media facade of the AEC', url: 'https://www.mediaarchitecture.org/aec', publisher: 'Media Architecture Institute', kind: 'specialist_media', reliability: 70, license: 'CC BY 4.0', supports: ['installation_method', 'display_area_m2', 'envelope_type'] })],
    media: [photo({ url: 'https://upload.wikimedia.org/wikipedia/commons/1/11/Ars_Electronica_Center_night.jpg', page_url: 'https://commons.wikimedia.org/wiki/File:Ars_Electronica_Center_night.jpg', author: 'Kim Archive' })],
    assessments: [{ attribute: 'architectural_integration', value: 'high', confidence: 'medium', method: '현장 관찰과 문헌 비교', note: '외피 전체가 화면이 되며 건물 형태를 그대로 드러낸다.', created_at: '2026-10-12T09:00:00.000Z' }] }),
  p({ slug: 'kunsthaus-graz-bix', name_original: 'BIX Medienfassade — Kunsthaus Graz', name_original_lang: 'de', name_en: 'BIX media facade, Kunsthaus Graz', name_ko: '쿤스트하우스 그라츠 BIX 파사드',
    country_iso2: 'AT', region: 'europe', city: 'Graz', latitude: 47.0713, longitude: 15.4339, location_precision: 'exact', year_installed: 2003, operating_status: 'operating', building_name: 'Kunsthaus Graz',
    project_type: 'media_facade', installation_method: 'led_backlit_cladding', envelope_type: 'other', technology: ['led_mono'], content_type: ['artwork'],
    wikidata_qid: 'Q597137', record_origin: 'auto_collected', review_status: 'editor_verified', last_verified_at: '2026-10-11T00:00:00.000Z', field_status: verified('latitude', 'longitude', 'year_installed'),
    credits: [{ role: 'facade_designer', name: 'realities:united', name_en: null, wikidata_qid: null }],
    sources: [src({ title: 'Kunsthaus Graz', url: 'https://www.wikidata.org/wiki/Q597137', publisher: 'Wikidata', kind: 'wikidata', reliability: 70, license: 'CC0 1.0', supports: ['latitude', 'longitude'] })] }),
  p({ slug: 'allianz-arena-skin', name_original: 'Allianz Arena', name_original_lang: 'de', name_en: 'Allianz Arena illuminated skin', name_ko: '알리안츠 아레나 조명 외피',
    country_iso2: 'DE', region: 'europe', city: 'München', latitude: 48.2188, longitude: 11.6247, location_precision: 'exact', year_completed: 2005, operating_status: 'operating',
    project_type: 'media_architecture', installation_method: 'led_backlit_cladding', envelope_type: 'membrane_etfe', technology: ['led_rgb'],
    sources: [src({ title: 'Allianz Arena lighting', url: 'https://news.example.org/allianz-arena-led', publisher: 'Example News', kind: 'news', supports: ['latitude', 'longitude', 'technology'] })] }),
  p({ slug: 'torre-glories-led', name_original: 'Torre Glòries', name_original_lang: 'ca', name_en: 'Torre Glòries LED facade', name_ko: '토레 글로리에스 LED 파사드',
    country_iso2: 'ES', region: 'europe', city: 'Barcelona', latitude: 41.4034, longitude: 2.1894, location_precision: 'street', year_installed: 2005, operating_status: 'event_based',
    project_type: 'media_facade', installation_method: 'led_linear_pixel', envelope_type: 'louvres_fins', technology: ['led_rgb', 'pixel_points'], record_origin: 'auto_collected', review_status: 'editor_verified',
    field_status: verified('latitude', 'longitude'), sources: [src({ title: 'Torre Glòries', url: 'https://www.torreglories.example/', publisher: 'Torre Glòries', kind: 'official', reliability: 90, supports: ['latitude', 'longitude'] })] }),
  p({ slug: 'piccadilly-lights', name_en: 'Piccadilly Lights', name_ko: '피카딜리 라이츠', country_iso2: 'GB', region: 'europe', city: 'London', latitude: 51.5101, longitude: -0.1340, location_precision: 'exact',
    year_installed: 2017, operating_status: 'operating', project_type: 'urban_screen', installation_method: 'led_cabinet_screen', technology: ['led_rgb', 'realtime_data'], content_type: ['advertising'],
    sources: [src({ title: 'Piccadilly Lights', url: 'https://news.example.org/piccadilly', publisher: 'Example News', kind: 'news', supports: [] })] }),
  // Decomposed unicode (NFD) in the original name; the same item as the sync fixtures' Q4167 (Wikidata duplicate dropped).
  p({ slug: 'fete-des-lumieres', name_original: 'Fête des Lumières', name_original_lang: 'fr', name_en: 'Festival of Lights, Lyon', name_ko: '리옹 빛의 축제',
    country_iso2: 'FR', region: 'europe', city: 'Lyon', year_operating_since: 1999, operating_status: 'seasonal', project_type: 'festival_program', installation_method: 'projection', envelope_type: 'historic_facade', technology: ['laser_projector', 'lamp_projector'],
    wikidata_qid: 'Q4167', review_status: 'editor_verified', record_origin: 'auto_collected', sources: [src({ title: 'Fête des Lumières', url: 'https://www.fetedeslumieres.example/', publisher: 'Ville de Lyon', kind: 'public_agency', language: 'fr', reliability: 85 })] }),
  // East Asia: three projects linked to curated places (curated_place_id, exact QID, name + city), and new ones.
  p({ slug: 'coex-kpop-square-wave', name_en: 'COEX K-POP SQUARE WAVE', name_ko: '코엑스 K-POP 스퀘어 WAVE', country_iso2: 'KR', region: 'east_asia', city: 'Seoul', year_installed: 2020,
    operating_status: 'operating', project_type: 'urban_screen', installation_method: 'led_cabinet_screen', technology: ['led_rgb', 'anamorphic_3d'], content_type: ['anamorphic_3d', 'advertising'], display_area_m2: 1620,
    curated_place_id: 'SEOUL007', record_origin: 'curated', review_status: 'editor_verified', field_status: verified('project_type', 'installation_method', 'display_area_m2') }),
  p({ slug: 'ddp-seoul-light', name_en: 'Dongdaemun Design Plaza facade', name_ko: '동대문디자인플라자 파사드', country_iso2: 'KR', region: 'east_asia', city: '서울', year_completed: 2014, envelope_type: 'metal_mesh',
    wikidata_qid: 'Q5295847', record_origin: 'curated', review_status: 'editor_verified', field_status: verified('envelope_type') }),
  p({ slug: 'galleria-west-facade', name_ko: '갤러리아 명품관 WEST 미디어파사드', name_en: 'Galleria West media facade', country_iso2: 'KR', region: 'east_asia', city: 'Seoul', year_installed: 2004,
    installation_method: 'led_backlit_cladding', envelope_type: 'glass_curtain_wall', technology: ['led_rgb'], record_origin: 'auto_collected', review_status: 'unreviewed' }),
  p({ slug: 'busan-cinema-center-big-roof', name_ko: '영화의전당 빅루프 LED', name_en: 'Busan Cinema Center Big Roof', country_iso2: 'KR', region: 'east_asia', city: 'Busan', district: '해운대구',
    latitude: 35.1711, longitude: 129.1270, location_precision: 'exact', year_completed: 2011, operating_status: 'operating', project_type: 'media_architecture', installation_method: 'led_linear_pixel', technology: ['led_rgb'],
    spatial_context: ['cultural_district'], record_origin: 'editor_created', review_status: 'editor_verified', field_status: verified('latitude', 'longitude'), credits: [{ role: 'architect', name: 'Coop Himmelb(l)au', name_en: null, wikidata_qid: null }] }),
  p({ slug: 'greenpix-media-wall', name_original: '绿色像素零能耗媒体墙', name_original_lang: 'zh', name_en: 'GreenPix Zero Energy Media Wall', country_iso2: 'CN', region: 'east_asia', city: 'Beijing',
    latitude: 39.9049, longitude: 116.4074, location_precision: 'city', year_installed: 2008, operating_status: 'inactive', project_type: 'media_wall', installation_method: 'led_media_glass', envelope_type: 'glass_curtain_wall',
    technology: ['led_rgb', 'sensors'], credits: [{ role: 'architect', name: 'Simone Giostra & Partners', name_en: null, wikidata_qid: null }] }),
  p({ slug: 'shibuya-crossing-screens', name_original: '渋谷スクランブル交差点の大型ビジョン', name_original_lang: 'ja', name_en: 'Shibuya Crossing screens', country_iso2: 'JP', region: 'east_asia', city: 'Tokyo',
    latitude: 35.6595, longitude: 139.7005, location_precision: 'exact', operating_status: 'operating', project_type: 'urban_screen', installation_method: 'led_cabinet_screen', technology: ['led_rgb'], content_type: ['advertising', 'information'],
    sources: [src({ title: 'Shibuya screens', url: 'https://news.example.jp/shibuya', publisher: 'Example Shimbun', kind: 'news', language: 'ja', supports: ['latitude', 'longitude'] })],
    // A licence missing and an http link: neither image is shown.
    media: [photo({ url: 'https://upload.wikimedia.org/wikipedia/commons/2/22/Shibuya.jpg', license: null }), photo({ url: 'http://insecure.example.org/shibuya.jpg', is_primary: false })] }),
  p({ slug: 'symphony-of-lights-hk', name_original: '幻彩詠香江', name_original_lang: 'zh', name_en: 'A Symphony of Lights', country_iso2: 'HK', region: 'east_asia', city: 'Hong Kong', year_installed: 2004,
    operating_status: 'operating', project_type: 'light_art', installation_method: 'mixed', technology: ['laser_projector', 'led_rgb', 'sound'], spatial_context: ['skyline', 'waterfront'], discovered_qid: 'Q99600013' }),
  // Southeast and South Asia, Central Asia
  p({ slug: 'spectra-marina-bay', name_en: 'Spectra – A Light & Water Show', country_iso2: 'SG', region: 'southeast_asia', city: 'Singapore', latitude: 1.2834, longitude: 103.8607, location_precision: 'exact',
    year_installed: 2014, operating_status: 'operating', project_type: 'festival_program', installation_method: 'projection', technology: ['laser_projector', 'sound'], spatial_context: ['waterfront'],
    review_status: 'editor_verified', field_status: verified('latitude', 'longitude'), sources: [src({ title: 'Spectra', url: 'https://www.marinabaysands.example/spectra', publisher: 'Marina Bay Sands', kind: 'official', reliability: 90, supports: ['latitude', 'longitude'] })] }),
  p({ slug: 'csmt-heritage-projection', name_en: 'CSMT heritage projection mapping', country_iso2: 'IN', region: 'south_asia', city: 'Mumbai', year_installed: 2019, operating_status: 'event_based',
    project_type: 'projection_mapping', installation_method: 'projection', envelope_type: 'historic_facade', technology: ['laser_projector'], spatial_context: ['heritage_site', 'transit_hub'] }),
  p({ slug: 'khan-shatyr-lighting', name_en: 'Khan Shatyr lighting', country_iso2: 'KZ', region: 'central_asia', city: 'Astana', year_completed: 2010, project_type: 'media_architecture', envelope_type: 'membrane_etfe',
    latitude: 51.1325, longitude: 71.4036, location_precision: 'exact' }),
  // Middle East: Arabic (RTL) original names.
  p({ slug: 'burj-khalifa-led', name_original: 'برج خليفة', name_original_lang: 'ar', name_en: 'Burj Khalifa LED facade', name_ko: '부르즈 할리파 LED 파사드', country_iso2: 'AE', region: 'middle_east', city: 'Dubai',
    latitude: 25.1972, longitude: 55.2744, location_precision: 'exact', year_installed: 2019, operating_status: 'operating', project_type: 'media_facade', installation_method: 'led_linear_pixel', envelope_type: 'glass_curtain_wall', technology: ['led_rgb', 'pixel_points'], display_area_m2: 33000,
    review_status: 'editor_verified', field_status: verified('latitude', 'longitude', 'display_area_m2'),
    media: [photo({ url: 'https://media.example.org/broken/burj.jpg', page_url: 'https://media.example.org/burj', author: 'Gulf Photo', license: 'CC BY 4.0' })] }),
  p({ slug: 'al-bahr-towers', name_original: 'أبراج البحر', name_original_lang: 'ar', name_en: 'Al Bahr Towers', country_iso2: 'AE', region: 'middle_east', city: 'Abu Dhabi', year_completed: 2012,
    project_type: 'media_architecture', installation_method: 'kinetic', envelope_type: 'louvres_fins', technology: ['sensors'], update_status: 'link_broken', official_url: 'https://albahr.example/',
    sources: [src({ title: 'Al Bahr Towers', url: 'https://albahr.example/', publisher: 'Al Bahr', kind: 'official', reliability: 60, link_state: 'broken' })] }),
  // Africa
  p({ slug: 'nelson-mandela-bridge-light', name_en: 'Nelson Mandela Bridge lighting', country_iso2: 'ZA', region: 'africa', city: 'Johannesburg', latitude: -26.1965, longitude: 28.0362, location_precision: 'exact',
    year_installed: 2003, project_type: 'light_art', installation_method: 'led_linear_pixel', envelope_type: 'bridge_infrastructure', technology: ['led_rgb'], spatial_context: ['bridge'],
    sources: [src({ title: 'Bridge lights', url: 'https://news.example.za/bridge', publisher: 'Example Times', kind: 'news', supports: ['latitude', 'longitude'] })] }),
  p({ slug: 'cairo-tower-show', name_original: 'برج القاهرة', name_original_lang: 'ar', name_en: 'Cairo Tower light show', country_iso2: 'EG', region: 'africa', city: 'Cairo', project_type: 'light_art', operating_status: 'event_based' }),
  // North America: a very long title, an editor-created record without any coordinates.
  p({ slug: 'times-square-screens', name_en: 'Times Square screens', name_ko: '타임스스퀘어 전광판', country_iso2: 'US', region: 'north_america', city: 'New York', latitude: 40.758, longitude: -73.9855, location_precision: 'exact',
    project_type: 'urban_screen', installation_method: 'led_cabinet_screen', technology: ['led_rgb'], content_type: ['advertising'], operating_status: 'operating', review_status: 'editor_verified', field_status: verified('latitude', 'longitude') }),
  p({ slug: 'crown-fountain', name_en: 'Crown Fountain', country_iso2: 'US', region: 'north_america', city: 'Chicago', latitude: 41.8816, longitude: -87.6237, location_precision: 'exact', year_installed: 2004,
    project_type: 'media_wall', installation_method: 'led_cabinet_screen', technology: ['led_rgb'], interactive: true, spatial_context: ['park'], credits: [{ role: 'media_artist', name: 'Jaume Plensa', name_en: null, wikidata_qid: null }],
    review_status: 'researcher_assessed', record_origin: 'editor_created', field_status: verified('latitude', 'longitude'),
    assessments: [{ attribute: 'public_interaction', value: { level: 'high', basis: 'water play' }, confidence: 'high', method: 'Field observation', note: null, created_at: '2026-10-13T09:00:00.000Z' }] }),
  p({ slug: 'convention-centre-north-atrium-interactive-facade-phase-two', name_en: 'The Extraordinarily Long-Named Interactive Media Facade Installation at the Downtown Convention Centre Northern Atrium Entrance (Phase II Extension and Public Plaza Programme)',
    country_iso2: 'CA', region: 'north_america', city: 'Toronto', year_installed: 2022, project_type: 'interactive_installation', installation_method: 'mixed', technology: ['sensors', 'mobile_interaction', 'generative'], interactive: true, record_origin: 'editor_created' }),
  p({ slug: 'sphere-exosphere', name_en: 'Sphere Exosphere', country_iso2: 'US', region: 'north_america', city: 'Las Vegas', latitude: 36.1215, longitude: -115.1739, location_precision: 'exact', year_installed: 2023,
    project_type: 'media_architecture', installation_method: 'led_linear_pixel', technology: ['led_rgb'], display_area_m2: 54000, resolution_text: '약 120만 개 LED 퍽', operating_status: 'operating',
    sources: [src({ title: 'Sphere', url: 'https://www.thesphere.example/', publisher: 'Sphere Entertainment', kind: 'official', reliability: 90, supports: ['display_area_m2'] })] }),
  // Latin America
  p({ slug: 'torre-bbva-mexico', name_original: 'Torre BBVA México', name_original_lang: 'es', name_en: 'Torre BBVA lighting', country_iso2: 'MX', region: 'latin_america', city: 'Mexico City', year_completed: 2016,
    project_type: 'media_facade', installation_method: 'led_linear_pixel', envelope_type: 'glass_curtain_wall', technology: ['led_rgb'] }),
  p({ slug: 'conjunto-nacional-sao-paulo', name_original: 'Conjunto Nacional', name_original_lang: 'pt', name_en: 'Conjunto Nacional media facade', country_iso2: 'BR', region: 'latin_america', city: 'São Paulo',
    latitude: -23.5587, longitude: -46.6608, location_precision: 'street', year_installed: 2012, project_type: 'media_facade', installation_method: 'led_linear_pixel', technology: ['led_rgb'],
    sources: [src({ title: 'Conjunto Nacional', url: 'https://news.example.br/conjunto', publisher: 'Exemplo', kind: 'blog', language: 'pt', reliability: 30, supports: ['latitude', 'longitude'] })] }),
  // Oceania: the same item as the sync fixtures' Vivid Sydney (by wikidata_qid); a city-level point stays off the map.
  p({ slug: 'vivid-sydney', name_en: 'Vivid Sydney', name_ko: '비비드 시드니 페스티벌', country_iso2: 'AU', region: 'oceania', city: 'Sydney', year_operating_since: 2009, operating_status: 'seasonal',
    project_type: 'festival_program', installation_method: 'projection', technology: ['laser_projector', 'led_rgb'], wikidata_qid: 'Q7937834', review_status: 'editor_verified',
    latitude: -33.8688, longitude: 151.2093, location_precision: 'city' }),
  p({ slug: 'federation-square-screen', name_en: 'Federation Square big screen', country_iso2: 'AU', region: 'oceania', city: 'Melbourne', latitude: -37.818, longitude: 144.969, location_precision: 'exact',
    project_type: 'urban_screen', installation_method: 'led_cabinet_screen', technology: ['led_rgb'], spatial_context: ['plaza'] }),
  // Rows the app must drop: no slug, no name; and one with values outside the vocabularies (kept, values nulled).
  p({ slug: null, name_en: 'No slug' }),
  p({ slug: 'nameless' }),
  p({ slug: 'bad-values', name_en: 'Values outside the vocabularies', country_iso2: 'zz', project_type: 'hologram', installation_method: 'magic', technology: ['led_rgb', 'telepathy'], operating_status: 'maybe',
    year_installed: 3020, latitude: 95, longitude: 10, location_precision: 'exact', review_status: 'approved', official_url: 'javascript:alert(1)', field_status: { latitude: { state: 'certain' }, project_type: { state: 'derived' } } }),
]

// What the app shows of these rows (tests derive their expectations from this, not from hand counts).
export const DROPPED_SLUGS = ['nameless']
export const LINKED_TO_CURATED = { 'coex-kpop-square-wave': 'SEOUL007', 'ddp-seoul-light': 'SEOUL006', 'galleria-west-facade': 'SEOUL009' }
export const SYNC_DUPLICATE_QIDS = ['Q597137', 'Q4167', 'Q7937834']
