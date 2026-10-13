// Nationwide (South Korea) and worldwide discovery of light-related places from Wikidata, refreshed every 6 hours.
// Shared by the browser (client/global-places.js, no backend needed) and any later server sync function.
// Pure ESM with injected fetch: no DOM, runs unchanged in browsers, Deno and Node tests.
//
// Discovery is split into small, separate SPARQL "branches" (one per class family, genre list, seed list …) instead of
// one big UNION, so a slow or failing branch cannot take the others down: each branch has its own timeout and LIMIT,
// and results are merged by QID afterwards. Every class/genre QID below was verified on wikidata.org; look-alikes
// that were checked and rejected are listed in REJECTED_QIDS and must never appear in a query.
// Images are NOT fetched here: the client checks each P18 file's rights lazily (checkImages) before showing it.

import { WDQS_URL, SYNC_INTERVAL_MS, DEFAULT_POLICY, fileFromFilePath, fetchCommonsPages, assessRights, toMediaRow, stripHtml, nameVariants, hostVariants } from './live-media.mjs'

/** @typedef {'Media Facade'|'Light Art'|'Media Art'|'Festival'|'Exhibition'|'Architectural Lighting'|'Public Art'|'Nightscape'} Kind */
/** @typedef {'korea'|'world'} Scope */
/**
 * @typedef {object} Branch
 * @property {string} id         e.g. "world:seeds"
 * @property {Scope} scope       which part of the catalogue the branch is meant to cover (an item's own scope comes from its country)
 * @property {number} limit      LIMIT of the outer query (most-linked items first)
 * @property {boolean} [expensive] runs last; its failure or timeout is reported like any other branch
 * @property {string} inner      body of the inner SELECT DISTINCT ?item ?k
 */
/**
 * @typedef {object} RawItem
 * @property {string} qid
 * @property {string} labelKo
 * @property {string} labelEn
 * @property {string} descKo
 * @property {string} descEn
 * @property {{lat: number, lon: number}} coord
 * @property {string} image          Commons file name ('' when none)
 * @property {string} countryQid
 * @property {string} countryLabel
 * @property {string} admin
 * @property {string} website        https only ('' when none)
 * @property {Kind[]} kinds
 * @property {number} sitelinks
 * @property {string[]} branches
 */
/**
 * @typedef {object} GlobalPlace
 * @property {string} place_id               "WD-Q…"
 * @property {string} name_kr                Korean label, else English label, else the QID
 * @property {string} name_en
 * @property {string} short_description
 * @property {Kind} primary_category
 * @property {Kind[]} categories
 * @property {string} country
 * @property {string} country_qid
 * @property {string} city                   label of the item's P131 (or of its P276 location)
 * @property {number} latitude
 * @property {number} longitude
 * @property {'source'} coordinate_review_status
 * @property {'wikidata'} coordinate_source
 * @property {string} coordinate_source_url
 * @property {string} image                  Commons file name ('' when none); never shown before checkImages clears it
 * @property {string} website
 * @property {string} wikidata
 * @property {'wikidata-sync'} origin
 * @property {string} source_url
 * @property {'Wikidata'} source_publisher
 * @property {number} sitelinks
 * @property {Scope} scope
 * @property {string[]} branches             branch ids that returned the item (used to keep it when only those fail)
 */
/** @typedef {{id: string, ok: boolean, count: number, error: string|null, ms: number}} BranchResult */
/** @typedef {(url: string, init?: RequestInit) => Promise<any>} FetchJSON */

export const GLOBAL_SYNC_INTERVAL_MS = SYNC_INTERVAL_MS
export const KOREA_QID = 'Q884'
export const KOREA_LABEL = '대한민국'
export const BRANCH_MARKER = '#AOL global-places branch='
export const WIKIDATA_ITEM = 'https://www.wikidata.org/wiki/'

// When an item has several kinds, the most specific light category wins. Nightscape (observation decks, towers,
// fountains) is the broadest, so it comes last.
/** @type {Kind[]} */
export const CATEGORY_PRIORITY = ['Media Facade', 'Media Art', 'Light Art', 'Festival', 'Exhibition', 'Architectural Lighting', 'Public Art', 'Nightscape']

// Instance-of classes (matched with wdt:P31/wdt:P279*).
/** @type {[string, Kind, string][]} */
export const ART_CLASSES = [
  ['Q17158007', 'Media Facade', 'media facade'],
  ['Q4287692', 'Media Facade', 'mediafacade (display on a building exterior)'],
  ['Q1823448', 'Light Art', 'light installation'],
  ['Q1421557', 'Light Art', 'light art'],
  ['Q1798004', 'Light Art', 'LED art'],
  ['Q131627422', 'Light Art', 'light sculpture art'],
  ['Q29885984', 'Light Art', 'light sculpture'],
  ['Q776483', 'Media Art', 'projection mapping'],
  ['Q860372', 'Media Art', 'digital art'],
  ['Q63442021', 'Exhibition', 'immersive art exhibit'],
  ['Q110409771', 'Exhibition', 'multimedia immersive exhibition'],
  ['Q106561607', 'Exhibition', 'Van Gogh immersive experiences'],
]
/** @type {[string, Kind, string][]} */
export const EVENT_CLASSES = [
  ['Q124414048', 'Festival', 'lights festival'],
  ['Q126682969', 'Festival', 'new media arts festival'],
  ['Q1658880', 'Festival', 'illuminations (outdoor light-up)'],
  ['Q1653073', 'Festival', 'Christmas lights'],
  ['Q380051', 'Nightscape', 'laser lighting show'],
  ['Q1136999', 'Nightscape', 'son et lumière'],
  ['Q926949', 'Nightscape', 'musical fountain'],
  ['Q18088097', 'Nightscape', 'water organ (music + light fountain)'],
  ['Q177305', 'Nightscape', 'observation deck'],
  ['Q6485102', 'Architectural Lighting', 'landscape lighting'],
]
// Korea only: worldwide it would flood the results with rural lookout towers.
/** @type {[string, Kind, string][]} */
export const KOREA_ONLY_CLASSES = [['Q1440300', 'Nightscape', 'observation tower']]
// Genre (P136) or movement (P135) values.
/** @type {[string, Kind, string][]} */
export const GENRES = [
  ['Q1421557', 'Light Art', 'light art'],
  ['Q1798004', 'Light Art', 'LED art'],
  ['Q378604', 'Media Art', 'new media art'],
  ['Q860372', 'Media Art', 'digital art'],
  ['Q1386571', 'Media Art', 'multi-media art'],
  ['Q776483', 'Media Art', 'projection mapping'],
  ['Q63442021', 'Exhibition', 'immersive art exhibit'],
  ['Q1136999', 'Nightscape', 'son et lumière'],
]
// Buildings that carry a media facade / light installation as a part (P527 / P361).
/** @type {[string, Kind, string][]} */
export const PART_CLASSES = [
  ['Q17158007', 'Media Facade', 'media facade'],
  ['Q4287692', 'Media Facade', 'mediafacade'],
  ['Q1823448', 'Architectural Lighting', 'light installation'],
]
export const PUBLIC_ART = 'Q557141'
export const PUBLIC_ART_LIGHT_GENRES = ['Q1421557', 'Q1798004', 'Q860372', 'Q378604']
export const LANTERN_FESTIVAL = 'Q718636' // the lunar-calendar holiday: used only as a P31/P361 target
export const FESTIVAL = 'Q132241' // too broad worldwide: Korea only, filtered by Korean light keywords in the label
export const KOREA_FESTIVAL_KEYWORDS = '빛|등축제|유등|연등|등불|불꽃|조명|루미나|일루미|라이트|미디어|야경'
export const KOREA_NAME_KEYWORDS = '미디어 ?파사드|미디어 ?아트|미디어 ?캔버스|레이저 ?쇼|라이트 ?쇼|빛 ?축제|일루미네이션|음악 ?분수|분수 ?쇼|전망대'

/** @type {[string, Kind, string][]} */
export const KOREA_SEEDS = [
  ['Q5295847', 'Media Facade', 'Dongdaemun Design Plaza & Park'],
  ['Q494895', 'Architectural Lighting', 'Lotte World Tower'],
  ['Q31179486', 'Nightscape', 'Seoul Sky'],
  ['Q69134', 'Nightscape', 'Namsan Seoul Tower'],
  ['Q255506', 'Nightscape', 'Banpo Bridge (Moonlight Rainbow Fountain)'],
  ['Q704504', 'Nightscape', 'Jamsu Bridge'],
  ['Q485443', 'Architectural Lighting', 'Gwangan Bridge (Busan)'],
  ['Q30275918', 'Nightscape', 'Seoullo 7017'],
  ['Q12859650', 'Festival', 'Seoul Lantern Festival'],
  ['Q12618343', 'Festival', 'Jinju Namgang Yudeung Festival'],
  ['Q625724', 'Festival', 'Lotus Lantern Festival (Yeondeunghoe)'],
  ['Q5001265', 'Festival', 'Busan International Fireworks Festival'],
  ['Q862790', 'Festival', 'Seoul International Fireworks Festival'],
  ['Q136488464', 'Exhibition', 'Arte Museum (franchise; usually no coordinates)'],
]
/** @type {[string, Kind, string][]} */
export const WORLD_SEEDS = [
  ['Q7937834', 'Festival', 'Vivid Sydney'],
  ['Q4167', 'Festival', 'Fête des Lumières (Lyon)'],
  ['Q26156861', 'Festival', 'Amsterdam Light Festival'],
  ['Q22087183', 'Festival', 'Lumiere (Durham / Derry / London)'],
  ['Q125715', 'Festival', 'Festival of Lights (Berlin)'],
  ['Q1636567', 'Festival', 'Kobe Luminarie'],
  ['Q4923257', 'Festival', 'Blackpool Illuminations'],
  ['Q5977922', 'Festival', 'i Light Marina Bay'],
  ['Q11235643', 'Festival', 'NIIGATA Pageant of Lights'],
  ['Q7676551', 'Festival', 'Taiwan Lantern Festival'],
  ['Q1068874', 'Nightscape', 'A Symphony of Lights (Hong Kong)'],
  ['Q60749353', 'Media Facade', 'Sphere (Las Vegas)'],
  ['Q597137', 'Media Facade', 'Kunsthaus Graz'],
  ['Q796012', 'Media Facade', 'BIX Medienfassade (Kunsthaus Graz)'],
  ['Q1916349', 'Media Facade', 'Medienfassade (Bayer-Hochhaus, Leverkusen)'],
  ['Q351126', 'Media Facade', 'Project Blinkenlights (Berlin)'],
  ['Q104235671', 'Exhibition', 'teamLab Borderless'],
  ['Q97613610', 'Exhibition', 'teamLab Planets TOKYO'],
  ['Q56255196', 'Exhibition', 'Atelier des Lumières (Paris)'],
  ['Q97366760', 'Exhibition', 'Bassins de Lumières (Bordeaux)'],
  ['Q135116725', 'Exhibition', 'Nxt Museum (Amsterdam)'],
  ['Q191212', 'Light Art', 'Centre for International Light Art (Unna)'],
  ['Q7899954', 'Public Art', 'Urban Light (Los Angeles)'],
]
// Checked and rejected look-alikes (wrong concept, redirect, duplicate or unverified). Never query these.
export const REJECTED_QIDS = [
  'Q10957', // Lumière Festival: a Lyon FILM festival, not the Fête des Lumières (Q4167)
  'Q1189512', // Illumination: the American animation studio
  'Q7765824', // The Sphere: a rental network, not the Las Vegas venue
  'Q24875628', // laser lighting display: redirect to Q380051
  'Q19706461', // second "Christmas lights" item, unclear scope
  'Q12906101', // second "digital art" item, unverified
  'Q7094057', // online art gallery: virtual galleries
  'Q210064', // lighting: far too broad
  'Q682010', // video art: pulls in films and video works, not places
  'Q496218', // a different building from Lotte World Tower (Q494895)
  'Q7937831', // Vivid: a Birmingham arts centre
  'Q55736992', // only uses a Gwangan Bridge photo
  'Q104383619', // unlabeled duplicate of teamLab Borderless
  'Q109905495', // BUSAN X the SKY: description unverified
]

const values = (/** @type {[string, Kind, string][]} */ rows, /** @type {string} */ v) =>
  `VALUES (${v} ?k) {\n${rows.map(([q, k, note]) => `      (wd:${q} "${k}") # ${note.replace(/\n/g, ' ')}`).join('\n')}\n    }`
const IN_KOREA = `{ ?item wdt:P17 wd:${KOREA_QID} . } UNION { ?item wdt:P276/wdt:P17 wd:${KOREA_QID} . }`

/** @type {Branch[]} */
export const BRANCHES = [
  // Cheap, high-value lists first.
  { id: 'korea:seeds', scope: 'korea', limit: 100, inner: values(KOREA_SEEDS, '?item') },
  { id: 'world:seeds', scope: 'world', limit: 100, inner: values(WORLD_SEEDS, '?item') },
  { id: 'korea:classes', scope: 'korea', limit: 1000, inner: `${values([...ART_CLASSES, ...EVENT_CLASSES, ...KOREA_ONLY_CLASSES], '?cls')}\n    ?item wdt:P31/wdt:P279* ?cls .\n    ${IN_KOREA}` },
  { id: 'korea:genres', scope: 'korea', limit: 300, inner: `${values(GENRES, '?g')}\n    ?item wdt:P136|wdt:P135 ?g .\n    ${IN_KOREA}` },
  { id: 'korea:festival-keywords', scope: 'korea', limit: 300, inner: `?item wdt:P31 wd:${FESTIVAL} ;\n          wdt:P17 wd:${KOREA_QID} ;\n          rdfs:label ?fl .\n    FILTER(LANG(?fl) = "ko" && REGEX(?fl, "${KOREA_FESTIVAL_KEYWORDS}"))\n    BIND("Festival" AS ?k)` },
  { id: 'world:classes-art', scope: 'world', limit: 1500, inner: `${values(ART_CLASSES, '?cls')}\n    ?item wdt:P31/wdt:P279* ?cls .` },
  { id: 'world:classes-events', scope: 'world', limit: 1500, inner: `${values(EVENT_CLASSES, '?cls')}\n    ?item wdt:P31/wdt:P279* ?cls .` },
  { id: 'world:genres', scope: 'world', limit: 1000, inner: `${values(GENRES, '?g')}\n    ?item wdt:P136|wdt:P135 ?g .` },
  { id: 'world:parts', scope: 'world', limit: 300, inner: `${values(PART_CLASSES, '?pcls')}\n    ?part wdt:P31/wdt:P279* ?pcls .\n    { ?item wdt:P527 ?part . } UNION { ?part wdt:P361 ?item . }` },
  { id: 'world:public-art', scope: 'world', limit: 500, inner: `?item wdt:P136 wd:${PUBLIC_ART} .\n    { VALUES ?lg { ${PUBLIC_ART_LIGHT_GENRES.map(q => 'wd:' + q).join(' ')} } ?item wdt:P136 ?lg . }\n    UNION { ?item wdt:P31/wdt:P279* wd:Q1823448 . }\n    BIND("Public Art" AS ?k)` },
  { id: 'world:lantern', scope: 'world', limit: 200, inner: `?item wdt:P31|wdt:P361 wd:${LANTERN_FESTIVAL} .\n    BIND("Festival" AS ?k)` },
  // Regex over the Korean labels of every item in South Korea: by far the most expensive branch, so it runs last and
  // on its own. Its timeout only loses the few places it alone would have found.
  {
    id: 'korea:name-keywords', scope: 'korea', limit: 300, expensive: true,
    inner: `?item wdt:P17 wd:${KOREA_QID} ;\n          rdfs:label ?nl .\n    FILTER(LANG(?nl) = "ko" && REGEX(?nl, "${KOREA_NAME_KEYWORDS}"))\n    BIND(IF(REGEX(?nl, "파사드|캔버스"), "Media Facade", IF(REGEX(?nl, "미디어 ?아트"), "Media Art", IF(REGEX(?nl, "축제|일루미네이션"), "Festival", "Nightscape"))) AS ?k)`,
  },
]

// One small query per branch. No wikibase:label service (too slow on large sets): labels come from rdfs:label.
// Country and admin labels are fetched inside their own OPTIONAL group so an unbound ?ctry/?adm never joins
// against every label in the graph. ?country is "Q…|label" so the QID and its label always come from the same row.
// Korea branches already restrict to South Korea, so their country is fixed (items with several P17 stay Korean).
/** @param {Branch} branch */
export function buildBranchQuery(branch) {
  return `${BRANCH_MARKER}${branch.id}
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
SELECT ?item
  (SAMPLE(?lko) AS ?label_ko) (SAMPLE(?len) AS ?label_en)
  (SAMPLE(?dko) AS ?desc_ko) (SAMPLE(?den) AS ?desc_en)
  (SAMPLE(?c) AS ?coord) (SAMPLE(?img) AS ?image)
  (SAMPLE(?ctryPair) AS ?country) (SAMPLE(?admLabel) AS ?admin) (SAMPLE(?web) AS ?site)
  (GROUP_CONCAT(DISTINCT ?k; separator="|") AS ?kind) (MAX(?sl) AS ?sitelinks)
WHERE {
  {
    SELECT DISTINCT ?item ?k WHERE {
    ${branch.inner}
    }
  }
  # coordinates: own P625, otherwise the P625 of its location (P276)
  { ?item wdt:P625 ?c . }
  UNION
  { ?item wdt:P276 ?loc . ?loc wdt:P625 ?c . FILTER NOT EXISTS { ?item wdt:P625 ?ownCoord . } }
  OPTIONAL { ?item wikibase:sitelinks ?sl . }
  OPTIONAL { ?item rdfs:label ?lko . FILTER(LANG(?lko) = "ko") }
  OPTIONAL { ?item rdfs:label ?len . FILTER(LANG(?len) = "en") }
  OPTIONAL { ?item schema:description ?dko . FILTER(LANG(?dko) = "ko") }
  OPTIONAL { ?item schema:description ?den . FILTER(LANG(?den) = "en") }
  OPTIONAL { ?item wdt:P18 ?img . }
  ${branch.scope === 'korea' ? `BIND(wd:${KOREA_QID} AS ?ctry)
  OPTIONAL { ?ctry rdfs:label ?cko . FILTER(LANG(?cko) = "ko") }
  OPTIONAL { ?ctry rdfs:label ?cen . FILTER(LANG(?cen) = "en") }` : `OPTIONAL {
    { ?item wdt:P17 ?ctry . } UNION { ?item wdt:P276/wdt:P17 ?ctry . FILTER NOT EXISTS { ?item wdt:P17 ?ownCountry . } }
    OPTIONAL { ?ctry rdfs:label ?cko . FILTER(LANG(?cko) = "ko") }
    OPTIONAL { ?ctry rdfs:label ?cen . FILTER(LANG(?cen) = "en") }
  }`}
  BIND(CONCAT(STRAFTER(STR(?ctry), "/entity/"), "|", COALESCE(?cko, ?cen, "")) AS ?ctryPair)
  OPTIONAL {
    { ?item wdt:P131 ?adm . } UNION { ?item wdt:P276 ?adm . FILTER NOT EXISTS { ?item wdt:P131 ?ownAdmin . } }
    OPTIONAL { ?adm rdfs:label ?ako . FILTER(LANG(?ako) = "ko") }
    OPTIONAL { ?adm rdfs:label ?aen . FILTER(LANG(?aen) = "en") }
  }
  BIND(COALESCE(?ako, ?aen) AS ?admLabel)
  OPTIONAL { ?item wdt:P856 ?web . }
}
GROUP BY ?item
ORDER BY DESC(?sitelinks)
LIMIT ${Math.max(1, Math.floor(branch.limit))}`
}

/** @param {string} query @returns {string|null} the branch id a query was built for */
export function branchIdOf(query) {
  const m = String(query || '').match(/^#AOL global-places branch=([a-z:-]+)/)
  return m ? m[1] : null
}

const qidOf = (/** @type {any} */ uri) => (String(uri || '').match(/\/entity\/(Q\d+)$/) || [])[1] || null
const clean = (/** @type {any} */ v, max = 300) => stripHtml(v).slice(0, max)

// WKT "Point(lon lat)": longitude comes FIRST. Coordinates on other globes (Moon, Mars …) carry a leading
// "<http://www.wikidata.org/entity/Q…>" and are rejected.
/** @param {any} wkt @returns {{lat: number, lon: number}|null} */
export function parseWktPoint(wkt) {
  const m = String(wkt || '').match(/^\s*Point\(\s*(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)\s*\)\s*$/i)
  if (!m) return null
  const lon = Number(m[1]), lat = Number(m[2])
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

/** @param {any} url @returns {string} */
export function httpsURL(url) {
  try { const u = new URL(String(url || '')); return u.protocol === 'https:' ? u.href : '' } catch { return '' }
}

/** @param {any} value @returns {Kind[]} known app categories, in priority order */
export function kindsOf(value) {
  const list = Array.isArray(value) ? value : String(value || '').split('|')
  const set = new Set(list.map(x => String(x).trim()))
  return CATEGORY_PRIORITY.filter(k => set.has(k))
}

/** @param {Kind[]} kinds @returns {Kind|null} */
export function primaryCategory(kinds) {
  return CATEGORY_PRIORITY.find(k => kinds.includes(k)) || null
}

// Parses one branch's SPARQL JSON. Rows without a QID, a usable coordinate or a known category are dropped.
/** @param {any} json @param {string} branchId @returns {{items: RawItem[], dropped: number}} */
export function parseBranch(json, branchId) {
  const rows = json?.results?.bindings
  if (!Array.isArray(rows)) throw Error('invalid_wdqs_payload')
  /** @type {RawItem[]} */
  const items = []
  let dropped = 0
  for (const r of rows) {
    const qid = qidOf(r.item?.value)
    const coord = parseWktPoint(r.coord?.value)
    const kinds = kindsOf(r.kind?.value)
    if (!qid || !coord || !kinds.length || REJECTED_QIDS.includes(qid)) { dropped++; continue }
    const pair = String(r.country?.value || '')
    const cut = pair.indexOf('|')
    const countryQid = /^Q\d+$/.test(cut >= 0 ? pair.slice(0, cut) : '') ? pair.slice(0, cut) : ''
    const sitelinks = Number(r.sitelinks?.value)
    items.push({
      qid,
      labelKo: clean(r.label_ko?.value), labelEn: clean(r.label_en?.value),
      descKo: clean(r.desc_ko?.value, 500), descEn: clean(r.desc_en?.value, 500),
      coord,
      image: (fileFromFilePath(r.image?.value) || '').slice(0, 240),
      countryQid,
      countryLabel: countryQid === KOREA_QID ? KOREA_LABEL : clean(cut >= 0 ? pair.slice(cut + 1) : '', 120),
      admin: clean(r.admin?.value, 120),
      website: httpsURL(r.site?.value),
      kinds,
      sitelinks: Number.isFinite(sitelinks) && sitelinks >= 0 ? Math.floor(sitelinks) : 0,
      branches: [branchId],
    })
  }
  return { items, dropped }
}

/** @param {RawItem} it @returns {GlobalPlace} */
export function toPlace(it) {
  const url = WIKIDATA_ITEM + it.qid
  return {
    place_id: 'WD-' + it.qid,
    name_kr: it.labelKo || it.labelEn || it.qid,
    name_en: it.labelEn || '',
    short_description: it.descKo || it.descEn || '',
    primary_category: /** @type {Kind} */ (primaryCategory(it.kinds)),
    categories: it.kinds,
    country: it.countryLabel,
    country_qid: it.countryQid,
    city: it.admin,
    latitude: it.coord.lat,
    longitude: it.coord.lon,
    coordinate_review_status: 'source',
    coordinate_source: 'wikidata',
    coordinate_source_url: url,
    image: it.image,
    website: it.website,
    wikidata: it.qid,
    origin: 'wikidata-sync',
    source_url: url,
    source_publisher: 'Wikidata',
    sitelinks: it.sitelinks,
    scope: it.countryQid === KOREA_QID ? 'korea' : 'world',
    branches: it.branches,
  }
}

// Merges branch results by QID: kinds and branch ids are unioned, the first non-empty value wins for every other
// field (branches are given in BRANCHES order, so curated seeds come first). Sorted by sitelinks, then name.
/** @param {RawItem[][]} lists @returns {GlobalPlace[]} */
export function mergeItems(lists) {
  /** @type {Map<string, RawItem>} */
  const byQid = new Map()
  for (const list of lists) for (const it of list) {
    const prev = byQid.get(it.qid)
    if (!prev) { byQid.set(it.qid, { ...it, kinds: [...it.kinds], branches: [...it.branches] }); continue }
    prev.kinds = kindsOf([...prev.kinds, ...it.kinds])
    for (const b of it.branches) if (!prev.branches.includes(b)) prev.branches.push(b)
    for (const k of /** @type {const} */ (['labelKo', 'labelEn', 'descKo', 'descEn', 'image', 'countryQid', 'countryLabel', 'admin', 'website'])) if (!prev[k] && it[k]) prev[k] = it[k]
    // An item that any branch places in South Korea is Korean (Korea branches pin the country; world ones sample one).
    if (it.countryQid === KOREA_QID && prev.countryQid !== KOREA_QID) { prev.countryQid = KOREA_QID; prev.countryLabel = KOREA_LABEL }
    prev.sitelinks = Math.max(prev.sitelinks, it.sitelinks)
  }
  return [...byQid.values()].map(toPlace).sort((a, b) => b.sitelinks - a.sitelinks || a.name_kr.localeCompare(b.name_kr))
}

// After a partial failure, keep the previous result's places that only failed branches could have returned,
// so one timeout does not make half of the catalogue disappear for six hours.
/** @param {GlobalPlace[]} previous @param {GlobalPlace[]} current @param {string[]} failedIds @returns {GlobalPlace[]} */
export function carryOver(previous, current, failedIds) {
  const failed = new Set(failedIds)
  if (!failed.size || !Array.isArray(previous)) return current
  const have = new Set(current.map(p => p.place_id))
  const kept = previous.filter(p => !have.has(p.place_id) && (p.branches || []).some(b => failed.has(b)))
  return kept.length ? [...current, ...kept].sort((a, b) => b.sitelinks - a.sitelinks || a.name_kr.localeCompare(b.name_kr)) : current
}

/**
 * @template T, R
 * @param {T[]} list @param {number} limit @param {(item: T) => Promise<R>} fn @returns {Promise<R[]>}
 */
async function mapLimited(list, limit, fn) {
  /** @type {R[]} */
  const out = new Array(list.length)
  let next = 0
  const worker = async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i]) } }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker))
  return out
}

// Runs run(signal) for at most ms milliseconds; an outer signal (the page is going away) stops it too.
/** @template T @param {(signal: AbortSignal) => Promise<T>} run @param {number} ms @param {AbortSignal} [outer] @returns {Promise<T>} */
function withTimeout(run, ms, outer) {
  const controller = new AbortController()
  /** @type {any} */
  let timer
  /** @type {() => void} */
  let onAbort = () => {}
  const stop = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Error('timeout')) }, ms)
    onAbort = () => { controller.abort(); reject(Error('aborted')) }
    outer?.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([run(controller.signal), stop]).finally(() => { clearTimeout(timer); outer?.removeEventListener('abort', onAbort) })
}

// One full discovery run. fetchJSON(url, init) must return parsed JSON or throw.
// Branches run two at a time, each with its own timeout. Throws only if EVERY branch fails. Aborting `signal`
// (e.g. the page is being closed) cancels the running branches and starts no new ones.
/**
 * @param {{fetchJSON: FetchJSON, now?: string, branches?: Branch[], concurrency?: number, timeoutMs?: number, signal?: AbortSignal}} options
 * @returns {Promise<{places: GlobalPlace[], branches: BranchResult[], stats: {fetchedAt: string, places: number, korea: number, world: number, branchesOk: number, branchesFailed: number, dropped: number}}>}
 */
export async function syncGlobal({ fetchJSON, now = new Date().toISOString(), branches = BRANCHES, concurrency = 2, timeoutMs = 60000, signal }) {
  const ordered = [...branches.filter(b => !b.expensive), ...branches.filter(b => b.expensive)]
  let dropped = 0
  const results = await mapLimited(ordered, concurrency, async branch => {
    const started = Date.now()
    try {
      if (signal?.aborted) throw Error('aborted')
      const json = await withTimeout(branchSignal => fetchJSON(WDQS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
        body: new URLSearchParams({ query: buildBranchQuery(branch), format: 'json' }).toString(),
        signal: branchSignal,
      }), timeoutMs, signal)
      const parsed = parseBranch(json, branch.id)
      dropped += parsed.dropped
      return { id: branch.id, ok: true, count: parsed.items.length, error: null, ms: Date.now() - started, items: parsed.items }
    } catch (e) {
      return { id: branch.id, ok: false, count: 0, error: String((/** @type {any} */ (e))?.message || e).slice(0, 200), ms: Date.now() - started, items: [] }
    }
  })
  /** @type {BranchResult[]} */
  const report = results.map(({ items, ...r }) => r)
  if (!results.some(r => r.ok)) throw Object.assign(Error('all_branches_failed'), { branches: report })
  const places = mergeItems(results.map(r => r.items))
  const korea = places.filter(p => p.scope === 'korea').length
  return {
    places,
    branches: report,
    stats: { fetchedAt: now, places: places.length, korea, world: places.length - korea, branchesOk: report.filter(r => r.ok).length, branchesFailed: report.filter(r => !r.ok).length, dropped },
  }
}

// Compact storage form (6000 places fit in well under 2 MB of localStorage): one array per place, derived fields
// (URLs, constants) are rebuilt by expandPlaces.
const CAT_CODE = new Map(CATEGORY_PRIORITY.map((k, i) => [k, i]))
/** @param {GlobalPlace[]} places @returns {any[][]} */
export function compactPlaces(places) {
  return places.map(p => [
    p.wikidata, p.name_kr === p.wikidata ? '' : p.name_kr, p.name_en, p.short_description,
    p.categories.map(k => CAT_CODE.get(k)).filter(x => x !== undefined).join(''),
    p.country_qid, p.country, p.city, Math.round(p.latitude * 1e5) / 1e5, Math.round(p.longitude * 1e5) / 1e5,
    p.image, p.website, p.sitelinks, (p.branches || []).join(' '),
  ])
}
/** @param {any} rows @returns {GlobalPlace[]} */
export function expandPlaces(rows) {
  if (!Array.isArray(rows)) return []
  /** @type {GlobalPlace[]} */
  const out = []
  for (const r of rows) {
    if (!Array.isArray(r) || !/^Q\d+$/.test(r[0]) || REJECTED_QIDS.includes(r[0])) continue
    const kinds = kindsOf([...String(r[4] || '')].map(c => CATEGORY_PRIORITY[Number(c)]))
    const coord = typeof r[8] === 'number' && typeof r[9] === 'number' && Math.abs(r[8]) <= 90 && Math.abs(r[9]) <= 180 ? { lat: r[8], lon: r[9] } : null
    if (!kinds.length || !coord) continue
    out.push(toPlace({
      qid: r[0], labelKo: String(r[1] || ''), labelEn: String(r[2] || ''), descKo: String(r[3] || ''), descEn: '', coord,
      image: String(r[10] || ''), countryQid: /^Q\d+$/.test(r[5]) ? r[5] : '', countryLabel: String(r[6] || ''), admin: String(r[7] || ''),
      website: httpsURL(r[11]), kinds, sitelinks: Number(r[12]) || 0, branches: String(r[13] || '').split(' ').filter(Boolean),
    }))
  }
  return out
}

// Keys used to hide a synced Korean place that duplicates a curated one (same name, or the curated project's
// host building), for when the live photo sync has not linked the curated place to a QID yet.
/** @param {any} name */
export const nameKey = name => String(name || '').normalize('NFKC').toLowerCase().replace(/[\s()（）\[\]·.,'"’\-–—/]+/g, '')
/** @param {{name_kr?: string, name_en?: string}[]} curated @returns {Set<string>} */
export function curatedNameKeys(curated) {
  const keys = new Set()
  for (const p of curated) for (const n of [p.name_kr, p.name_en]) for (const v of [...nameVariants(n), ...hostVariants(n)]) { const k = nameKey(v); if (k.length >= 2) keys.add(k) }
  return keys
}

// Lazy rights check for the P18 images of places on screen. Returns one verdict per file; cleared files carry an
// attributed media row (same shape as the live photo sync), rejected ones carry the reasons.
/**
 * @param {{place_id: string, wikidata: string, image: string}[]} items
 * @param {{fetchJSON: FetchJSON, now?: string, policy?: {krFopDisplay: boolean, maxImagesPerPlace: number}}} options
 * @returns {Promise<Map<string, {ok: boolean, reasons: string[], row: Record<string, any>|null}>>}
 */
export async function checkImages(items, { fetchJSON, now = new Date().toISOString(), policy = DEFAULT_POLICY }) {
  const files = [...new Set(items.map(x => x.image).filter(Boolean))]
  const pages = files.length ? await fetchCommonsPages(files, fetchJSON) : new Map()
  /** @type {Map<string, {ok: boolean, reasons: string[], row: Record<string, any>|null}>} */
  const out = new Map()
  for (const it of items) {
    if (!it.image || out.has(it.image)) continue
    const page = pages.get(it.image.replace(/_/g, ' ').trim())
    const ii = page?.imageinfo?.[0]
    if (!page || page.missing || !ii?.url) { out.set(it.image, { ok: false, reasons: ['missing'], row: null }); continue }
    const license = stripHtml(ii.extmetadata?.LicenseShortName?.value || ii.extmetadata?.UsageTerms?.value)
    const verdict = assessRights({ license, mime: ii.mime, templates: page.templates }, policy)
    if (!verdict.ok) { out.set(it.image, { ok: false, reasons: verdict.reasons, row: null }); continue }
    const row = toMediaRow(it.place_id, it.image.replace(/_/g, ' ').trim(), page, { qid: it.wikidata, krFop: verdict.krFop, now })
    row.caption = 'Wikidata 항목의 대표 사진(P18) · 촬영 당시 모습이며 현재 상태와 다를 수 있습니다'
    out.set(it.image, { ok: true, reasons: [], row })
  }
  return out
}
