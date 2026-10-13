// Nationwide (South Korea) and worldwide discovery of light-related places from Wikidata, refreshed every 6 hours.
// Shared by the browser (client/global-places.js, no backend needed) and any later server sync function.
// Pure ESM with injected fetch: no DOM, runs unchanged in browsers, Deno and Node tests.
//
// Discovery is split into small, separate SPARQL "branches" (one per class family, genre list, seed list …) instead of
// one big UNION, so a slow or failing branch cannot take the others down: each branch has its own timeout and LIMIT,
// and results are merged by QID afterwards. Every class/genre QID below was verified on wikidata.org; look-alikes
// that were checked and rejected are listed in NEVER_QUERY_QIDS and must never appear in a query (a much shorter
// NEVER_SHOW_QIDS list holds the few items that are hidden even when a class query returns them).
// Images are NOT fetched here: the client checks each P18 file's rights lazily (checkImages) before showing it.

import { WDQS_URL, SYNC_INTERVAL_MS, SEOUL_QID, DEFAULT_POLICY, fileFromFilePath, fetchCommonsPages, assessRights, toMediaRow, stripHtml, nameVariants, hostVariants, placeQid } from './live-media.mjs'

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
 * @property {string} labelOther    label in another language ("mul", then ja/zh/de/fr/es) for items with neither
 * @property {string} descKo
 * @property {string} descEn
 * @property {{lat: number, lon: number}} coord
 * @property {string} image          Commons file name ('' when none)
 * @property {string} countryQid
 * @property {string} countryLabel
 * @property {string} cityQid        first city-level unit up the P131 chain ('' when none was found)
 * @property {string} city           its short name ("서울"), else the item's most specific admin unit
 * @property {string} district       the unit just below the city (e.g. "중구"), '' when none
 * @property {string} website        https only ('' when none)
 * @property {Kind[]} kinds
 * @property {number} sitelinks
 * @property {string[]} branches
 */
/**
 * @typedef {object} GlobalPlace
 * @property {string} place_id               "WD-Q…"
 * @property {string} name_kr                Korean label, else English, else "mul"/ja/zh/de/fr/es (items with none are dropped)
 * @property {string} name_en
 * @property {string} short_description
 * @property {Kind} primary_category
 * @property {Kind[]} categories
 * @property {string} country
 * @property {string} country_qid
 * @property {string} city                   first city-level unit up the item's P131 chain (or its P276 location's): "서울",
 *                                           "부산", "리옹" …; the item's own admin unit when no city-level unit is found
 * @property {string} city_qid
 * @property {string} district               the unit just below that city ("중구"), '' when none
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
// City-level administrative unit classes (P31 values), each verified on wikidata.org. The city of a place is the
// first unit up its P131 chain (at most three steps) that is an instance of one of these; matched with plain wdt:P31
// (no P279* walk), so the check costs a few index lookups per place. The Korean classes (KOREA_CITY_CLASSES) win over
// the generic ones anywhere in the walk: a Seoul district that an editor also typed "big city" by its population
// must not become the city of the places in it.
/** @type {[string, string][]} */
export const CITY_CLASSES = [
  ['Q7574799', 'Special City of Korea (Seoul)'],
  ['Q29045219', 'special city of South Korea (redirected to Q7574799; until every statement is updated)'],
  ['Q482821', 'metropolitan city of South Korea'],
  ['Q16181672', 'special autonomous city in South Korea (Sejong)'],
  ['Q29045252', 'city of South Korea'],
  ['Q12624746', 'administrative city in South Korea (Jeju, Seogwipo)'],
  ['Q515', 'city'],
  ['Q1549591', 'big city'],
  ['Q200250', 'metropolis'],
  ['Q15284', 'municipality'],
  ['Q494721', 'city of Japan'],
  ['Q5327704', 'special ward of Japan'],
  ['Q484170', 'commune of France'],
  ['Q1093829', 'city in the United States'],
  ['Q262166', 'municipality in Germany'],
]
export const KOREA_CITY_CLASSES = ['Q7574799', 'Q29045219', 'Q482821', 'Q16181672', 'Q29045252', 'Q12624746']
// Items with neither a Korean nor an English label are named by their first label in these languages.
export const FALLBACK_LABEL_LANGS = ['mul', 'ja', 'zh', 'de', 'fr', 'es']
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
// Checked and rejected as query seeds or classes (wrong concept, redirect, duplicate or unverified). Never query
// these; tests check every branch query against this list. Being on it does NOT hide an item that a class or genre
// query returns on its own (e.g. Q109905495, an observation deck in Busan, is merely unverified as a seed).
export const NEVER_QUERY_QIDS = [
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
  'Q7937831', // Vivid: a Birmingham arts centre, not Vivid Sydney
  'Q55736992', // only uses a Gwangan Bridge photo
  'Q104383619', // unlabeled duplicate of teamLab Borderless
  'Q109905495', // BUSAN X the SKY: description unverified as a seed
]
// Never shown, even when a query returns them: a duplicate of an item that is shown, and look-alikes that are not
// light places at all but share a famous light place's name.
export const NEVER_SHOW_QIDS = [
  'Q104383619', // unlabeled duplicate of teamLab Borderless (Q104235671)
  'Q10957', // Lumière Festival (film), mistaken for the Fête des Lumières (Q4167)
  'Q1189512', // Illumination (animation studio)
  'Q7765824', // The Sphere (rental network), mistaken for Sphere in Las Vegas (Q60749353)
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

const CITY_IN = `(${CITY_CLASSES.map(([q]) => 'wd:' + q).join(', ')})`
const KOREA_CITY_IN = `(${KOREA_CITY_CLASSES.map(q => 'wd:' + q).join(', ')})`
const labelsOf = (/** @type {string} */ v, indent = '      ') =>
  `OPTIONAL { ?${v} rdfs:label ?${v}ko . FILTER(LANG(?${v}ko) = "ko") }\n${indent}OPTIONAL { ?${v} rdfs:label ?${v}en . FILTER(LANG(?${v}en) = "en") }`
const entityPair = (/** @type {string} */ v, /** @type {string} */ name) => `CONCAT(STRAFTER(STR(?${v}), "/entity/"), "|", ${name})`

// One small query per branch. No wikibase:label service (too slow on large sets): labels come from rdfs:label, one
// OPTIONAL per language (each binds at most one value, so rows never multiply).
// Country, city and district labels are fetched inside their own OPTIONAL groups so an unbound unit never joins
// against every label in the graph. ?country and ?city are "Q…|label" so a QID and its label come from the same row.
// Korea branches already restrict to South Korea, so their country is fixed (items with several P17 stay Korean).
// City: up to three P131 steps (item → district → city, or item → dong → district → city) to the first unit whose P31
// is in CITY_CLASSES (a Korean class anywhere in the walk beats a generic one); the unit just below it is the district.
// Each row ranks its match (6–4: Korean class at step 1–3, 3–1: generic class at step 1–3, 0: none) and the ?city and
// ?district columns lead with that digit, ?district also with the city's QID, so MAX over an item's rows picks the best
// city and the district of that same city (parseBranch strips the prefixes). Without a city-level unit the item's own
// admin unit is reported as the district and parseBranch uses it as the city, like before.
/** @param {Branch} branch */
export function buildBranchQuery(branch) {
  return `${BRANCH_MARKER}${branch.id}
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
SELECT ?item
  (SAMPLE(?lko) AS ?label_ko) (SAMPLE(?len) AS ?label_en) (SAMPLE(?lother) AS ?label_other)
  (SAMPLE(?dko) AS ?desc_ko) (SAMPLE(?den) AS ?desc_en)
  (SAMPLE(?c) AS ?coord) (SAMPLE(?img) AS ?image)
  (SAMPLE(?ctryPair) AS ?country) (MAX(?cityKey) AS ?city) (MAX(?districtKey) AS ?district) (SAMPLE(?web) AS ?site)
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
${FALLBACK_LABEL_LANGS.map(l => `  OPTIONAL { ?item rdfs:label ?l_${l} . FILTER(LANG(?l_${l}) = "${l}") }`).join('\n')}
  BIND(COALESCE(${FALLBACK_LABEL_LANGS.map(l => '?l_' + l).join(', ')}) AS ?lother)
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
    { ?item wdt:P131 ?a1 . BIND(true AS ?viaAdmin) } UNION { ?item wdt:P276 ?a1 . FILTER NOT EXISTS { ?item wdt:P131 ?ownAdmin . } }
    ${labelsOf('a1', '    ')}
    OPTIONAL { ?a1 wdt:P31 ?t1 . FILTER(?t1 IN ${CITY_IN}) }
    OPTIONAL {
      ?a1 wdt:P131 ?a2 . ?a2 wdt:P31 ?t2 . FILTER(?t2 IN ${CITY_IN})
      ${labelsOf('a2')}
    }
    OPTIONAL {
      ?a1 wdt:P131 ?m2 . ?m2 wdt:P131 ?a3 . ?a3 wdt:P31 ?t3 . FILTER(?t3 IN ${CITY_IN})
      ${labelsOf('m2')}
      ${labelsOf('a3')}
    }
  }
  BIND(COALESCE(?a1ko, ?a1en, "") AS ?a1name)
  BIND(IF(BOUND(?t1) && ?t1 IN ${KOREA_CITY_IN}, 6, IF(BOUND(?t2) && ?t2 IN ${KOREA_CITY_IN}, 5,
       IF(BOUND(?t3) && ?t3 IN ${KOREA_CITY_IN}, 4, IF(BOUND(?t1), 3, IF(BOUND(?t2), 2, IF(BOUND(?t3), 1, 0)))))) AS ?cityRank)
  BIND(IF(?cityRank IN (6, 3), 1, IF(?cityRank IN (5, 2), 2, IF(?cityRank IN (4, 1), 3, 0))) AS ?cityStep)
  BIND(IF(?cityStep = 1, ${entityPair('a1', '?a1name')},
       IF(?cityStep = 2, ${entityPair('a2', 'COALESCE(?a2ko, ?a2en, "")')},
       IF(?cityStep = 3, ${entityPair('a3', 'COALESCE(?a3ko, ?a3en, "")')}, ""))) AS ?cityPair)
  BIND(IF(?cityStep = 1, "", IF(?cityStep = 2, IF(BOUND(?viaAdmin), ?a1name, ""),
       IF(?cityStep = 3, COALESCE(?m2ko, ?m2en, ""), IF(BOUND(?viaAdmin), ?a1name, "")))) AS ?districtName)
  BIND(CONCAT(STR(?cityRank), ?cityPair) AS ?cityKey)
  BIND(CONCAT(STR(?cityRank), STRBEFORE(?cityPair, "|"), "|", ?districtName) AS ?districtKey)
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

// The curated catalogue (and everyday Korean) names Korean special/metropolitan cities without their status suffix:
// "서울특별시" → "서울", "부산광역시" → "부산", "세종특별자치시" → "세종". Other names are kept as they are.
/** @param {string} qid @param {string} label */
export function cityName(qid, label) {
  if (qid === SEOUL_QID) return '서울'
  const m = String(label || '').match(/^(.{2,}?)(특별시|광역시|특별자치시)$/)
  return m ? m[1] : String(label || '')
}

/** @param {any} pair "Q…|label" @returns {[string, string]} [qid or '', label] */
const splitPair = (pair, max = 120) => {
  const s = String(pair || ''), cut = s.indexOf('|')
  const q = cut >= 0 ? s.slice(0, cut) : ''
  return [/^Q\d+$/.test(q) ? q : '', clean(cut >= 0 ? s.slice(cut + 1) : '', max)]
}

// ?city is "<rank>Q…|label" (just "0" when the walk found no city-level unit) and ?district is "<rank>Q…|name" with the
// same rank and city QID ("0|name of the item's own admin unit" without a city): see buildBranchQuery.
/** @param {any} r one result row @returns {{cityQid: string, city: string, district: string}} */
function cityOf(r) {
  const c = /^(\d)(.*)$/s.exec(String(r.city?.value ?? '0')) || ['', '0', '']
  const d = /^(\d)([^|]*)\|(.*)$/s.exec(String(r.district?.value ?? ''))
  let [cityQid, cityLabel] = splitPair(c[2])
  let city = cityName(cityQid, cityLabel)
  // The district must come from the same row of the walk as the city (same rank, same city QID).
  let district = d && d[1] === c[1] && d[2] === c[2].split('|')[0] ? clean(d[3], 120) : ''
  if (!city) { city = district; district = ''; cityQid = '' } // no (named) city-level unit: the item's own admin unit
  if (district === city) district = ''
  return { cityQid, city, district }
}

// Parses one branch's SPARQL JSON. Rows without a QID, a usable coordinate, a known category or any label are dropped
// (a bare QID is never shown as a name), and so are the few NEVER_SHOW_QIDS.
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
    const labelKo = clean(r.label_ko?.value), labelEn = clean(r.label_en?.value), labelOther = clean(r.label_other?.value)
    if (!qid || !coord || !kinds.length || !(labelKo || labelEn || labelOther) || NEVER_SHOW_QIDS.includes(qid)) { dropped++; continue }
    const [countryQid, countryLabel] = splitPair(r.country?.value)
    const { cityQid, city, district } = cityOf(r)
    const sitelinks = Number(r.sitelinks?.value)
    items.push({
      qid,
      labelKo, labelEn, labelOther,
      descKo: clean(r.desc_ko?.value, 500), descEn: clean(r.desc_en?.value, 500),
      coord,
      image: (fileFromFilePath(r.image?.value) || '').slice(0, 240),
      countryQid,
      countryLabel: countryQid === KOREA_QID ? KOREA_LABEL : countryLabel,
      cityQid, city, district,
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
    name_kr: it.labelKo || it.labelEn || it.labelOther,
    name_en: it.labelEn || '',
    short_description: it.descKo || it.descEn || '',
    primary_category: /** @type {Kind} */ (primaryCategory(it.kinds)),
    categories: it.kinds,
    country: it.countryLabel,
    country_qid: it.countryQid,
    city: it.city,
    city_qid: it.cityQid,
    district: it.district,
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
    for (const k of /** @type {const} */ (['labelKo', 'labelEn', 'labelOther', 'descKo', 'descEn', 'image', 'countryQid', 'countryLabel', 'website'])) if (!prev[k] && it[k]) prev[k] = it[k]
    // City, its QID and the district travel together (they come from one P131 walk).
    if (!prev.city && it.city) { prev.city = it.city; prev.cityQid = it.cityQid; prev.district = it.district }
    else if (prev.city === it.city && !prev.district && it.district) prev.district = it.district
    // An item that any branch places in South Korea is Korean (Korea branches pin the country; world ones sample one).
    if (it.countryQid === KOREA_QID && prev.countryQid !== KOREA_QID) { prev.countryQid = KOREA_QID; prev.countryLabel = KOREA_LABEL }
    prev.sitelinks = Math.max(prev.sitelinks, it.sitelinks)
  }
  return [...byQid.values()].map(toPlace).sort(bySitelinks)
}
/** @param {GlobalPlace} a @param {GlobalPlace} b */
const bySitelinks = (a, b) => b.sitelinks - a.sitelinks || a.name_kr.localeCompare(b.name_kr)

// After a partial failure, keep the previous result's places that only failed branches could have returned,
// so one timeout does not make half of the catalogue disappear for six hours.
/** @param {GlobalPlace[]} previous @param {GlobalPlace[]} current @param {string[]} failedIds @returns {GlobalPlace[]} */
export function carryOver(previous, current, failedIds) {
  const failed = new Set(failedIds)
  if (!failed.size || !Array.isArray(previous)) return current
  const have = new Set(current.map(p => p.place_id))
  const kept = previous.filter(p => !have.has(p.place_id) && (p.branches || []).some(b => failed.has(b)))
  return kept.length ? [...current, ...kept].sort(bySitelinks) : current
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

// Compact storage form: one array per place; derived fields (URLs, constants) are rebuilt by expandPlaces, branch
// ids are stored as indexes into a table kept next to the rows.
// [qid, name_kr, name_en (1 = same as name_kr), description, category codes, country QID, country, city, lat, lon,
//  image, website, sitelinks, branch indexes, district, city QID]
export const BRANCH_IDS = BRANCHES.map(b => b.id)
const CAT_CODE = new Map(CATEGORY_PRIORITY.map((k, i) => [k, i]))
/** @param {string} text @param {number} max */
const shorten = (text, max) => max === Infinity || text.length <= max ? text : max <= 1 ? '' : text.slice(0, max - 1).trimEnd() + '…'
/** @param {GlobalPlace[]} places @param {{branchIds?: string[], descMax?: number}} [options] @returns {any[][]} */
export function compactPlaces(places, { branchIds = BRANCH_IDS, descMax = Infinity } = {}) {
  const index = new Map(branchIds.map((id, i) => [id, i]))
  return places.map(p => [
    p.wikidata, p.name_kr, p.name_en && p.name_en === p.name_kr ? 1 : p.name_en, shorten(p.short_description || '', descMax),
    p.categories.map(k => CAT_CODE.get(k)).filter(x => x !== undefined).join(''),
    p.country_qid, p.country, p.city, Math.round(p.latitude * 1e5) / 1e5, Math.round(p.longitude * 1e5) / 1e5,
    p.image, p.website, p.sitelinks, (p.branches || []).map(b => index.get(b)).filter(i => i !== undefined).join(' '),
    p.district || '', p.city_qid || '',
  ])
}
/** @param {any} rows @param {string[]} [branchIds] @returns {GlobalPlace[]} sorted most-linked first */
export function expandPlaces(rows, branchIds = BRANCH_IDS) {
  if (!Array.isArray(rows)) return []
  const ids = Array.isArray(branchIds) ? branchIds : BRANCH_IDS
  /** @type {GlobalPlace[]} */
  const out = []
  for (const r of rows) {
    if (!Array.isArray(r) || !/^Q\d+$/.test(r[0]) || NEVER_SHOW_QIDS.includes(r[0])) continue
    const kinds = kindsOf([...String(r[4] || '')].map(c => CATEGORY_PRIORITY[Number(c)]))
    const coord = typeof r[8] === 'number' && typeof r[9] === 'number' && Math.abs(r[8]) <= 90 && Math.abs(r[9]) <= 180 ? { lat: r[8], lon: r[9] } : null
    const name = String(r[1] || '').trim()
    if (!kinds.length || !coord || !name) continue
    out.push(toPlace({
      qid: r[0], labelKo: name, labelEn: r[2] === 1 ? name : String(r[2] || ''), labelOther: '', descKo: String(r[3] || ''), descEn: '', coord,
      image: String(r[10] || ''), countryQid: /^Q\d+$/.test(r[5]) ? r[5] : '', countryLabel: String(r[6] || ''),
      city: String(r[7] || ''), district: String(r[14] || ''), cityQid: /^Q\d+$/.test(r[15]) ? r[15] : '',
      website: httpsURL(r[11]), kinds, sitelinks: Number(r[12]) || 0,
      branches: String(r[13] ?? '').split(' ').filter(Boolean).map(i => ids[Number(i)]).filter(Boolean),
    }))
  }
  return out.sort(bySitelinks)
}

// Packs places for browser storage within maxChars. What must survive goes first: every place the user has saved,
// planned or recorded (keepIds), then every place in South Korea, then the rest by sitelinks. When everything does
// not fit, descriptions are shortened (then left out) before any place is dropped; truncated says places were dropped.
/**
 * @param {GlobalPlace[]} places @param {{maxChars: number, keepIds?: Set<string>}} options
 * @returns {{rows: any[][], branchIds: string[], truncated: boolean, shortened: boolean}}
 */
export function packPlaces(places, { maxChars, keepIds = new Set() }) {
  const rank = (/** @type {GlobalPlace} */ p) => keepIds.has(p.place_id) ? 2 : p.scope === 'korea' ? 1 : 0
  const ordered = [...places].sort((a, b) => rank(b) - rank(a) || bySitelinks(a, b))
  const branchIds = [...new Set([...BRANCH_IDS, ...places.flatMap(p => p.branches || [])])]
  /** @type {any[][]} */
  let rows = []
  /** @type {number[]} */
  let sizes = []
  for (const descMax of [Infinity, 60, 0]) {
    rows = compactPlaces(ordered, { branchIds, descMax })
    sizes = rows.map(r => JSON.stringify(r).length + 1)
    if (sizes.reduce((a, b) => a + b, 0) <= maxChars) return { rows, branchIds, truncated: false, shortened: descMax !== Infinity }
  }
  let total = 0, n = 0
  while (n < rows.length && total + sizes[n] <= maxChars) total += sizes[n++]
  return { rows: rows.slice(0, n), branchIds, truncated: true, shortened: true }
}

// Hiding a synced place that duplicates a curated one: by QID first (the curated seed's verified "wikidata", which
// covers host buildings such as 반포대교 for 반포대교 달빛무지개분수), then, for Korean places, by name or the curated
// project's host-building name.
/** @param {any} name */
export const nameKey = name => String(name || '').normalize('NFKC').toLowerCase().replace(/[\s()（）\[\]·.,'"’\-–—/]+/g, '')
/** @param {{name_kr?: string, name_en?: string}[]} curated @returns {Set<string>} */
export function curatedNameKeys(curated) {
  const keys = new Set()
  for (const p of curated) for (const n of [p.name_kr, p.name_en]) for (const v of [...nameVariants(n), ...hostVariants(n)]) { const k = nameKey(v); if (k.length >= 2) keys.add(k) }
  return keys
}
/** @param {{name_kr?: string, name_en?: string, wikidata?: string}[]} curated @returns {{qids: Set<string>, names: Set<string>}} */
export function curatedIndex(curated) {
  return { qids: new Set(curated.map(placeQid).filter(q => q !== null)), names: curatedNameKeys(curated) }
}
/** @param {{wikidata?: string, scope?: string, name_kr?: string, name_en?: string}} p @param {{qids: Set<string>, names: Set<string>}} index */
export function isCuratedDuplicate(p, index) {
  if (p?.wikidata && index.qids.has(p.wikidata)) return true
  if (p?.scope !== 'korea') return false
  return index.names.has(nameKey(p.name_kr)) || (!!p.name_en && index.names.has(nameKey(p.name_en)))
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
    const verdict = assessRights({ license, mime: ii.mime, templates: page.templates, templatesComplete: page.templatesComplete !== false }, policy)
    if (!verdict.ok) { out.set(it.image, { ok: false, reasons: verdict.reasons, row: null }); continue }
    const row = toMediaRow(it.place_id, it.image.replace(/_/g, ' ').trim(), page, { qid: it.wikidata, krFop: verdict.krFop, now })
    row.caption = 'Wikidata 항목의 대표 사진(P18) · 촬영 당시 모습이며 현재 상태와 다를 수 있습니다'
    out.set(it.image, { ok: true, reasons: [], row })
  }
  return out
}
