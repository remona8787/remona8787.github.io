// Writes the recorded-shape fixtures of the pipeline tests (tests/fixtures/pipeline/README.md):
//   wikidata/entities/<QID>.json   wbgetentities entity objects (labels, descriptions, claims, sitelinks)
//   wikidata/sparql/*.json         SPARQL JSON results of the class count and instance queries
//   commons/categories.json        category pages (pageprops, categoryinfo, coordinates) and their members
//   commons/files.json             file pages (imageinfo with extmetadata, templates) and their thumbnail fixture
//   commons/search.json            category and file name search results
//   wikipedia/<lang>.json          full-text search results and page details (pageprops, extracts, coordinates)
//   web/gdelt.json, web/feed.xml   a GDELT DOC ArtList answer and an RSS feed
//   links.json, overpass.json      link check and Overpass answers
//   thumbs/*.jpg                   330 px thumbnails generated with sharp (night LED facade, projection, daytime…)
// The world below is TEST DATA: well-known projects with fixture values (coordinates, years, files) that are not
// verified facts; QIDs Q99000xxxx do not exist on Wikidata. Run: node tests/fixtures/pipeline/make-fixtures.mjs
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { loadSharp } from '../../../pipeline/lib/visual.mjs'

const OUT = import.meta.dirname
const md5 = (s) => createHash('md5').update(s).digest('hex')
const sha1 = (s) => createHash('sha1').update(s).digest('hex')
const json = (v) => JSON.stringify(v, null, 1) + '\n'

// ---------------------------------------------------------------- Wikidata
const ITEM = (q) => ({ value: { 'entity-type': 'item', 'numeric-id': Number(q.slice(1)), id: q }, type: 'wikibase-entityid' })
const stmt = (subject, pid, datavalue, datatype, rank = 'normal') => ({ mainsnak: { snaktype: 'value', property: pid, hash: md5(subject + pid + JSON.stringify(datavalue)).slice(0, 40), datavalue, datatype }, type: 'statement', id: `${subject}$${md5(subject + pid + JSON.stringify(datavalue)).slice(0, 8)}-0000-0000-0000-000000000000`, rank })
const claimMakers = {
  item: (s, pid, q) => stmt(s, pid, ITEM(q), 'wikibase-item'),
  coord: (s, pid, [lat, lng]) => stmt(s, pid, { value: { latitude: lat, longitude: lng, altitude: null, precision: 0.0001, globe: 'http://www.wikidata.org/entity/Q2' }, type: 'globecoordinate' }, 'globe-coordinate'),
  year: (s, pid, y) => stmt(s, pid, { value: { time: `+${y}-00-00T00:00:00Z`, timezone: 0, before: 0, after: 0, precision: 9, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' }, type: 'time' }, 'time'),
  url: (s, pid, u) => stmt(s, pid, { value: u, type: 'string' }, 'url'),
  string: (s, pid, v) => stmt(s, pid, { value: v, type: 'string' }, 'string'),
  media: (s, pid, v) => stmt(s, pid, { value: v, type: 'string' }, 'commonsMedia'),
  id: (s, pid, v) => stmt(s, pid, { value: v, type: 'string' }, 'external-id'),
  mono: (s, pid, [text, language]) => stmt(s, pid, { value: { text, language }, type: 'monolingualtext' }, 'monolingualtext'),
}
const KIND = { P31: 'item', P279: 'item', P17: 'item', P131: 'item', P276: 'item', P84: 'item', P170: 'item', P137: 'item', P301: 'item', P5817: 'item', P625: 'coord', P571: 'year', P580: 'year', P582: 'year', P856: 'url', P373: 'string', P18: 'media', P297: 'id', P1705: 'mono', P1448: 'mono' }
const WIKI_HOST = { enwiki: 'en.wikipedia.org', kowiki: 'ko.wikipedia.org', dewiki: 'de.wikipedia.org', frwiki: 'fr.wikipedia.org', cswiki: 'cs.wikipedia.org', commonswiki: 'commons.wikimedia.org' }

function entity(id, { labels = {}, descriptions = {}, claims = {}, sitelinks = {} }) {
  const c = {}
  for (const [pid, values] of Object.entries(claims)) c[pid] = [].concat(values).map((v) => claimMakers[KIND[pid]](id, pid, v))
  const lab = (o) => Object.fromEntries(Object.entries(o).map(([l, v]) => [l, { language: l, value: v }]))
  return {
    pageid: Number(id.slice(1)) % 1e8, ns: 0, title: id, lastrevid: 2400000000 + (Number(id.slice(1)) % 1e6), modified: '2026-10-01T12:00:00Z', type: 'item', id,
    labels: lab(labels), descriptions: lab(descriptions), aliases: {}, claims: c,
    sitelinks: Object.fromEntries(Object.entries(sitelinks).map(([w, t]) => [w, { site: w, title: t, badges: [], url: `https://${WIKI_HOST[w]}/wiki/${encodeURIComponent(t.replace(/ /g, '_')).replace(/%3A/g, ':')}` }])),
  }
}

const E = []
const add = (id, o) => E.push(entity(id, o))
// Classes and kinds (aux).
for (const [q, en, ko] of [
  ['Q1823448', 'light installation', '빛 설치 미술'], ['Q124414048', 'lights festival', '빛 축제'], ['Q776483', 'projection mapping', '프로젝션 매핑'],
  ['Q17158007', 'media facade', '미디어 파사드'], ['Q1421557', 'light art', '빛 예술'], ['Q378604', 'new media art', '뉴미디어 아트'],
  ['Q60744298', 'drone display', null], ['Q4830453', 'business', '기업'], ['Q5', 'human', '사람'], ['Q4167836', 'Wikimedia category', '위키미디어 분류'],
  ['Q515', 'city', '도시'], ['Q5119', 'capital city', '수도'], ['Q1549591', 'big city', '대도시'], ['Q484170', 'commune of France', '프랑스의 코뮌'],
  ['Q1093829', 'city of the United States', '미국의 시'], ['Q6256', 'country', '국가'], ['Q3624078', 'sovereign state', '주권 국가'],
  ['Q41176', 'building', '건축물'], ['Q11303', 'skyscraper', '마천루'], ['Q11315', 'shopping center', '쇼핑 센터'], ['Q132241', 'festival', '축제'],
  ['Q12518', 'tower', '탑'], ['Q99000401', 'autonomous district of Seoul', '서울특별시의 자치구'], ['Q99000402', 'states and territories of Australia', null],
  ['Q968159', 'art movement', '예술 사조'], ['Q183061', 'façade', '파사드'],
]) add(q, { labels: { en, ...(ko ? { ko } : {}) } })
// Countries.
for (const [q, en, ko, iso] of [['Q30', 'United States', '미국', 'US'], ['Q142', 'France', '프랑스', 'FR'], ['Q183', 'Germany', '독일', 'DE'], ['Q213', 'Czech Republic', '체코', 'CZ'],
  ['Q884', 'South Korea', '대한민국', 'KR'], ['Q408', 'Australia', '오스트레일리아', 'AU'], ['Q40', 'Austria', '오스트리아', 'AT'], ['Q55', 'Netherlands', '네덜란드', 'NL']]) {
  add(q, { labels: { en, ko }, claims: { P31: ['Q6256', 'Q3624078'], P297: iso } })
}
// Cities and areas.
for (const [q, en, ko, cls, country, parent] of [
  ['Q62', 'San Francisco', '샌프란시스코', 'Q1093829', 'Q30'], ['Q65', 'Los Angeles', '로스앤젤레스', 'Q1093829', 'Q30'], ['Q60', 'New York City', '뉴욕', 'Q1093829', 'Q30'],
  ['Q456', 'Lyon', '리옹', 'Q484170', 'Q142'], ['Q64', 'Berlin', '베를린', 'Q5119', 'Q183'], ['Q1040', 'Karlsruhe', '카를스루에', 'Q1549591', 'Q183'],
  ['Q1085', 'Prague', '프라하', 'Q5119', 'Q213'], ['Q8684', 'Seoul', '서울', 'Q5119', 'Q884'], ['Q1741', 'Vienna', '빈', 'Q5119', 'Q40'],
  ['Q99000301', 'Cheonan', '천안시', 'Q515', 'Q884'], ['Q99000302', 'Songpa District', '송파구', 'Q99000401', 'Q884', 'Q8684'],
  ['Q99000303', 'Jung District', '중구', 'Q99000401', 'Q884', 'Q8684'], ['Q3235', 'Northern Territory', '노던 준주', 'Q99000402', 'Q408'],
]) add(q, { labels: { en, ko }, claims: { P31: cls, P17: country, ...(parent ? { P131: parent } : {}) } })
// People (fixture ids).
add('Q99000201', { labels: { en: 'Leo Villareal' }, claims: { P31: 'Q5' } })
add('Q99000202', { labels: { en: 'Bruce Munro' }, claims: { P31: 'Q5' } })
add('Q99000203', { labels: { en: 'UNStudio' }, claims: { P31: 'Q4830453' } })
// Projects.
add('Q7715933', { labels: { en: 'The Bay Lights', fr: 'The Bay Lights' }, descriptions: { en: 'light installation on the San Francisco–Oakland Bay Bridge' },
  claims: { P31: 'Q1823448', P17: 'Q30', P131: 'Q62', P625: [[37.7985, -122.3778]], P571: 2013, P170: 'Q99000201', P856: 'https://thebaylights.org/', P373: 'The Bay Lights', P18: 'The Bay Lights at night 2013.jpg' },
  sitelinks: { enwiki: 'The Bay Lights', commonswiki: 'Category:The Bay Lights' } })
add('Q4167', { labels: { en: 'Festival of Lights', fr: 'Fête des Lumières', ko: '리옹 빛의 축제' }, descriptions: { en: 'celebration on December 8 in Lyon, France' },
  claims: { P31: 'Q124414048', P17: 'Q142', P131: 'Q456', P625: [[45.764, 4.8357]], P571: 1999, P856: 'https://www.fetedeslumieres.lyon.fr/', P373: 'Fête des Lumières', P1705: [['Fête des Lumières', 'fr']] },
  sitelinks: { enwiki: 'Festival of Lights (Lyon)', frwiki: 'Fête des Lumières', commonswiki: 'Category:Fête des Lumières' } })
add('Q15140473', { labels: { en: 'Signal Festival', cs: 'Signal Festival' }, descriptions: { en: 'annual outdoor festival of videomapping in Prague' },
  claims: { P31: ['Q124414048', 'Q132241'], P17: 'Q213', P131: 'Q1085', P625: [[50.087, 14.4208]], P571: 2013, P856: 'https://www.signalfestival.com/' },
  sitelinks: { enwiki: 'Signal Festival', cswiki: 'Signal Festival' } })
add('Q18391691', { labels: { en: 'Signal Festival' }, descriptions: { en: 'festival in Prague' },
  claims: { P31: 'Q132241', P17: 'Q213', P131: 'Q1085', P625: [[50.0872, 14.421]], P373: 'Signal Festival' }, sitelinks: { commonswiki: 'Category:Signal Festival' } })
add('Q56089114', { labels: { en: 'Schlosslichtspiele Karlsruhe', de: 'Schlosslichtspiele Karlsruhe' },
  claims: { P31: 'Q132241', P17: 'Q183', P131: 'Q1040', P625: [[49.0135, 8.4044]], P571: 2015, P373: 'Schlosslichtspiele Karlsruhe' }, sitelinks: { commonswiki: 'Category:Schlosslichtspiele Karlsruhe' } })
add('Q125715', { labels: { en: 'Festival of Lights', de: 'Festival of Lights' }, descriptions: { en: 'annual event' },
  claims: { P31: 'Q124414048', P17: 'Q183', P131: 'Q64', P625: [[52.5163, 13.3777]], P571: 2005, P373: 'Festival of Lights (Berlin)' }, sitelinks: { commonswiki: 'Category:Festival of Lights (Berlin)' } })
add('Q5447104', { labels: { en: 'Field of Light' }, descriptions: { en: 'light installation by Bruce Munro' },
  claims: { P31: 'Q1823448', P17: 'Q408', P131: 'Q3235', P625: [[-25.3444, 131.0369]], P571: 2016, P170: 'Q99000202', P18: 'Field of Light Uluru 2016.jpg', P373: 'Field of Light' } })
add('Q7899954', { labels: { en: 'Urban Light', ko: '어반 라이트' }, descriptions: { en: '2008 installation by Chris Burden' },
  claims: { P31: 'Q1823448', P17: 'Q30', P131: 'Q65', P625: [[34.0629, -118.3593]], P571: 2008, P18: 'Urban Light LACMA daytime.jpg', P373: 'Urban Light' } })
add('Q2001578', { labels: { en: 'Tribute in Light' }, descriptions: { en: 'art installation in New York City' },
  claims: { P31: 'Q1823448', P17: 'Q30', P131: 'Q60', P625: [[40.7115, -74.0134]], P571: 2002, P18: 'Tribute in Light 2011.jpg', P373: 'Tribute in Light' } })
add('Q494895', { labels: { en: 'Lotte World Tower', ko: '롯데월드타워' }, descriptions: { en: 'skyscraper in Seoul, South Korea' },
  claims: { P31: 'Q11303', P17: 'Q884', P131: 'Q99000302', P625: [[37.5125, 127.1025]], P571: 2017, P373: 'Lotte World Tower', P18: 'Lotte World Tower daytime 2017.jpg' },
  sitelinks: { kowiki: '롯데월드타워', enwiki: 'Lotte World Tower', commonswiki: 'Category:Lotte World Tower' } })
add('Q5295847', { labels: { en: 'Dongdaemun Design Plaza', ko: '동대문디자인플라자' }, descriptions: { en: 'building in Seoul' },
  claims: { P31: 'Q41176', P17: 'Q884', P131: 'Q99000303', P625: [[37.5665, 127.0095]], P571: 2014 }, sitelinks: { kowiki: '동대문디자인플라자', enwiki: 'Dongdaemun Design Plaza' } })
add('Q99000101', { labels: { en: 'Galleria Centercity', ko: '갤러리아 센터시티' }, descriptions: { en: 'department store in Cheonan' },
  claims: { P31: 'Q11315', P17: 'Q884', P131: 'Q99000301', P625: [[36.8188, 127.1559]], P571: 2010, P84: 'Q99000203', P856: 'https://centercity.example/' },
  sitelinks: { enwiki: 'Galleria Centercity', kowiki: '갤러리아 센터시티' } })
add('Q99000103', { labels: { en: 'Uniqa Tower', de: 'Uniqa Tower' }, descriptions: { en: 'office building in Vienna' },
  claims: { P31: 'Q11303', P17: 'Q40', P131: 'Q1741', P625: [[48.2117, 16.38]], P571: 2004, P18: 'Uniqa Tower Medienfassade Nacht.jpg', P373: 'Uniqa Tower' },
  sitelinks: { enwiki: 'Uniqa Tower', dewiki: 'Uniqa Tower', commonswiki: 'Category:Uniqa Tower' } })
add('Q99000104', { labels: { en: 'ExampleLED' }, descriptions: { en: 'LED manufacturer' }, claims: { P31: 'Q4830453', P17: 'Q183' }, sitelinks: { enwiki: 'ExampleLED' } })
add('Q99000105', { labels: { en: 'Fixture Artist B' }, claims: { P31: 'Q5' }, sitelinks: { enwiki: 'Fixture Artist B' } })
add('Q99000106', { labels: { en: 'Fixture Net Artwork' }, claims: { P31: 'Q378604', P17: 'Q183' } })
add('Q99000107', { labels: { en: 'Fixture Drone Show' }, claims: { P31: 'Q60744298', P17: 'Q884', P131: 'Q8684', P625: [[37.52, 126.93]] } })
add('Q99000108', { labels: { en: 'Fixture Neon Sign' }, claims: { P31: 'Q1823448', P17: 'Q30', P131: 'Q60', P625: [[40.758, -73.9855]] } })
add('Q6703289', { labels: { en: 'Lumino Kinetic art' }, claims: { P31: 'Q968159' } })
add('Q8590079', { labels: { en: 'Category:Light art' }, claims: { P31: 'Q4167836', P301: 'Q1421557' } })

// SPARQL answers (class discovery counts and instances), shaped like query.wikidata.org results.
const INT = (n) => ({ datatype: 'http://www.w3.org/2001/XMLSchema#integer', type: 'literal', value: String(n) })
const COUNTS = { Q17158007: [0, 0], Q4287692: [0, 0], Q776483: [1, 1], Q1421557: [14, 8], Q1823448: [138, 94], Q29885984: [26, 9], Q1798004: [0, 0], Q124414048: [23, 3],
  Q126682969: [0, 0], Q126682939: [0, 0], Q1136999: [0, 0], Q63442021: [5, 1], Q110409771: [0, 0], Q115452528: [0, 0], Q378604: [265, 4], Q860372: [0, 0], Q550484: [0, 0],
  Q20437094: [0, 0], Q380051: [0, 0], Q926949: [0, 0], Q110775916: [26875, 30], Q116262603: [0, 0] }
const INSTANCES = { Q1823448: ['Q7715933', 'Q5447104', 'Q7899954', 'Q2001578', 'Q99000108'], Q1421557: ['Q7715933', 'Q99000107'], Q124414048: ['Q4167', 'Q15140473', 'Q125715'], Q378604: ['Q99000106'] }

// ---------------------------------------------------------------- Commons
const thumbUrl = (file, w) => { const f = file.replace(/ /g, '_'), h = md5(f); return `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(f)}/${w}px-${encodeURIComponent(f)}` }
const fileUrl = (file) => { const f = file.replace(/ /g, '_'), h = md5(f); return `https://upload.wikimedia.org/wikipedia/commons/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(f)}` }
const filePage = (file) => 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_'))
let pageid = 90000000
const META = (value, source = 'commons-desc-page') => ({ value, source, hidden: '' })
const LIC = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0', 'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0', 'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0',
  CC0: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en', 'CC BY-NC-SA 2.0': 'https://creativecommons.org/licenses/by-nc-sa/2.0/',
}
// [file, thumbnail kind, width, height, licence, author, categories, description, extra templates]
const FILES = [
  ['The Bay Lights at night 2013.jpg', 'night_led', 4000, 2667, 'CC BY-SA 4.0', 'Fixture Photographer 1', ['The Bay Lights'], 'The Bay Lights LED installation on the Bay Bridge at night'],
  ['Bay Bridge from Embarcadero daytime.jpg', 'day', 3600, 2400, 'CC BY 2.0', 'Fixture Photographer 2', ['The Bay Lights'], 'The western span of the Bay Bridge seen from the Embarcadero'],
  ['The Bay Lights reflection night.jpg', 'night_led2', 3000, 2000, 'CC BY-SA 4.0', 'Fixture Photographer 3', ['The Bay Lights at night'], 'LED patterns reflected in the bay'],
  ['The Bay Lights map.png', 'day', 1200, 800, 'CC BY-SA 4.0', 'Fixture Mapper', ['The Bay Lights'], 'Map'],
  ['Fete des Lumieres 2015 Cathedrale Saint-Jean projection.jpg', 'night_projection', 4200, 2800, 'CC BY-SA 3.0', 'Fixture Photographer 4', ['Fête des Lumières 2015'], 'Projection mapping on the cathedral during the Fête des Lumières'],
  ['Fete des Lumieres Place des Terreaux.jpg', 'night_projection2', 3000, 2000, 'CC BY-SA 4.0', 'Fixture Photographer 5', ['Fête des Lumières'], 'Light show on the Place des Terreaux', ['Template:NoFoP-France']],
  ['Lyon Fete des lumieres crowd.jpg', 'night_projection2', 3000, 2000, 'CC BY-NC-SA 2.0', 'Fixture Photographer 6', ['Fête des Lumières'], 'Crowd at the festival'],
  ['Schlosslichtspiele 2018 Karlsruhe Schloss projection.jpg', 'night_projection', 5000, 3333, 'CC BY-SA 4.0', 'Fixture Photographer 7', ['Schlosslichtspiele Karlsruhe'], 'Projection mapping on Karlsruhe Palace'],
  ['Signal festival 2019 projection.jpg', 'night_projection2', 2400, 1600, 'CC BY-SA 4.0', 'Fixture Photographer 8', ['Signal Festival'], 'Videomapping at Signal Festival'],
  ['Field of Light Uluru 2016.jpg', 'night_field', 4000, 2667, 'CC BY 2.0', 'Fixture Photographer 9', ['Field of Light'], 'Field of Light at dusk'],
  ['Urban Light LACMA daytime.jpg', 'day', 4000, 2667, 'CC BY-SA 4.0', 'Fixture Photographer 10', ['Urban Light'], 'Urban Light street lamps in daylight'],
  ['Tribute in Light 2011.jpg', 'dark_only', 3000, 2000, 'CC0', 'Fixture Photographer 11', ['Tribute in Light'], 'Two beams of light into the night sky'],
  ['Lotte World Tower daytime 2017.jpg', 'day', 3000, 4500, 'CC BY-SA 4.0', 'Fixture Photographer 12', ['Lotte World Tower'], 'Lotte World Tower in daylight'],
  ['Lotte World Tower interior lobby.jpg', 'interior', 3000, 2000, 'CC BY-SA 4.0', 'Fixture Photographer 13', ['Lotte World Tower'], 'Interior of the lobby'],
  ['Lotte World Tower media facade at night.jpg', 'night_led', 3200, 4800, 'CC BY-SA 4.0', 'Fixture Photographer 14', ['Lotte World Tower at night'], '롯데월드타워 미디어파사드 야경', ['Template:NoFoP-South Korea', 'Template:NoFoP-South Korea/layout']],
  ['Uniqa Tower Medienfassade Nacht.jpg', 'night_led2', 2800, 4200, 'CC BY-SA 3.0', 'Fixture Photographer 15', ['Uniqa Tower'], 'Medienfassade des Uniqa Towers bei Nacht'],
  ['Uniqa Tower media facade colourful day.jpg', 'colourful_day', 3000, 2000, 'CC BY-SA 4.0', 'Fixture Photographer 16', ['Uniqa Tower'], 'Uniqa Tower on a sunny day'],
  ['Festival of Lights Berlin 2013 Brandenburg Gate.jpg', 'night_projection', 3000, 2000, 'CC BY-SA 3.0', 'Fixture Photographer 17', ['Festival of Lights (Berlin, 2013)'], 'Projection on the Brandenburg Gate'],
  ['Bradford Garden of Light lanterns.jpg', 'night_dim', 2000, 1333, 'CC BY-SA 4.0', 'Fixture Photographer 18', ['Bradford Garden of Light'], 'Garden of light'],
]
const COMMON_TEMPLATES = ['Template:Information', 'Template:Own', 'Template:Self', 'Template:Cc-by-sa-4.0', 'Template:Location', 'Template:Taken on', 'Template:Lang', 'Template:Description']
const files = FILES.map(([file, kind, width, height, license, author, cats, description, extraTemplates = []]) => ({
  thumb: `thumbs/${kind}.jpg`,
  page: {
    pageid: ++pageid, ns: 6, title: 'File:' + file,
    imageinfo: [{
      timestamp: '2024-05-01T20:00:00Z', size: width * height / 4, width, height, sha1: sha1(file),
      thumburl: thumbUrl(file, 330), thumbwidth: 330, thumbheight: Math.round(330 * height / width),
      url: fileUrl(file), descriptionurl: filePage(file), descriptionshorturl: `https://commons.wikimedia.org/w/index.php?curid=${pageid}`,
      extmetadata: {
        DateTime: META('2024-05-01 20:00:00', 'mediawiki-metadata'), ObjectName: META(file.replace(/\.[a-z]+$/i, ''), 'mediawiki-metadata'),
        Categories: META(cats.join('|'), 'commons-categories'), ImageDescription: META(description),
        DateTimeOriginal: META('2019-12-08 21:00:00'), Credit: META('<span class="int-own-work" lang="en">Own work</span>'),
        Artist: META(`<a href="//commons.wikimedia.org/wiki/User:${author.replace(/ /g, '_')}" title="User:${author}">${author}</a>`),
        LicenseShortName: META(license), UsageTerms: META(license === 'CC0' ? 'Creative Commons Zero, Public Domain Dedication' : 'Creative Commons ' + license.replace('CC ', '')),
        LicenseUrl: META(LIC[license]), Copyrighted: META(license === 'CC0' ? 'False' : 'True'), Restrictions: META(''), License: META(license.toLowerCase().replace(/ /g, '-')),
      },
      mime: /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', mediatype: 'BITMAP',
    }],
    templates: [...COMMON_TEMPLATES, ...extraTemplates].map((title) => ({ ns: 10, title })),
  },
}))
const fileTitles = (...names) => names.map((n) => 'File:' + n)

// [title, qid, coordinates, subcats, files]
const CATS = [
  ['Category:Projection mapping', 'Q776483', null, ['Category:Projection mapping in Prague', 'Category:Projection mapping in Europe', 'Category:Schlosslichtspiele Karlsruhe', 'Category:Projection mapping in the Quartier des Spectacles'], []],
  ['Category:Projection mapping in Prague', null, null, ['Category:Signal Festival'], []],
  ['Category:Projection mapping in Europe', null, null, [], []],
  ['Category:Projection mapping in the Quartier des Spectacles', null, null, [], []],
  ['Category:Signal Festival', 'Q18391691', [50.0872, 14.421], [], fileTitles('Signal festival 2019 projection.jpg')],
  ['Category:Schlosslichtspiele Karlsruhe', 'Q56089114', null, [], fileTitles('Schlosslichtspiele 2018 Karlsruhe Schloss projection.jpg')],
  ['Category:Light art', 'Q8590079', null, ['Category:Light artists', 'Category:Light art in Karlsruhe', 'Category:Field of Light', 'Category:Urban Light', 'Category:Tribute in Light', 'Category:The Bay Lights', 'Category:Lumino Kinetic art', 'Category:Bradford Garden of Light'], []],
  ['Category:Light artists', 'Q8590080', null, [], []],
  ['Category:Light art in Karlsruhe', null, null, ['Category:Schlosslichtspiele Karlsruhe'], []],
  ['Category:Field of Light', 'Q5447104', null, [], fileTitles('Field of Light Uluru 2016.jpg')],
  ['Category:Urban Light', 'Q7899954', null, [], fileTitles('Urban Light LACMA daytime.jpg')],
  ['Category:Tribute in Light', 'Q2001578', null, [], fileTitles('Tribute in Light 2011.jpg')],
  ['Category:The Bay Lights', 'Q7715933', null, ['Category:The Bay Lights at night'], fileTitles('The Bay Lights at night 2013.jpg', 'Bay Bridge from Embarcadero daytime.jpg', 'The Bay Lights map.png')],
  ['Category:The Bay Lights at night', null, null, [], fileTitles('The Bay Lights reflection night.jpg')],
  ['Category:Lumino Kinetic art', 'Q6703289', null, [], []],
  ['Category:Bradford Garden of Light', null, null, [], fileTitles('Bradford Garden of Light lanterns.jpg')],
  ['Category:Festivals of lights', 'Q53170938', null, ['Category:Fête des Lumières', 'Category:Festival of Lights (Berlin)'], []],
  ['Category:Fête des Lumières', 'Q4167', null, ['Category:Fête des Lumières 2015'], fileTitles('Fete des Lumieres Place des Terreaux.jpg', 'Lyon Fete des lumieres crowd.jpg')],
  ['Category:Fête des Lumières 2015', null, null, [], fileTitles('Fete des Lumieres 2015 Cathedrale Saint-Jean projection.jpg')],
  ['Category:Festival of Lights (Berlin)', 'Q125715', null, ['Category:Festival of Lights (Berlin, 2013)'], []],
  ['Category:Festival of Lights (Berlin, 2013)', null, null, [], fileTitles('Festival of Lights Berlin 2013 Brandenburg Gate.jpg')],
  ['Category:Media Facade', null, null, [], []],
  ['Category:Facades', 'Q8952318', null, [], []],
  ['Category:Illuminated buildings by city', 'Q116262580', null, ['Category:Illuminated buildings in Seoul'], []],
  ['Category:Illuminated buildings in Seoul', null, null, ['Category:Lotte World Tower at night'], []],
  ['Category:Lotte World Tower at night', null, null, [], fileTitles('Lotte World Tower media facade at night.jpg')],
  ['Category:Lotte World Tower', 'Q494895', [37.5125, 127.1025], ['Category:Lotte World Tower at night'], fileTitles('Lotte World Tower daytime 2017.jpg', 'Lotte World Tower interior lobby.jpg')],
  ['Category:Uniqa Tower', 'Q99000103', [48.2117, 16.38], [], fileTitles('Uniqa Tower Medienfassade Nacht.jpg', 'Uniqa Tower media facade colourful day.jpg')],
]
const categories = CATS.map(([title, qid, coord, subcats, members]) => ({
  page: {
    pageid: ++pageid, ns: 14, title,
    ...(qid ? { pageprops: { wikibase_item: qid } } : {}),
    categoryinfo: { size: subcats.length + members.length, pages: 0, files: members.length, subcats: subcats.length, hidden: false },
    ...(coord ? { coordinates: [{ lat: coord[0], lon: coord[1], primary: '', globe: 'earth' }] } : {}),
  },
  members: [
    ...subcats.map((t, i) => ({ pageid: 0, ns: 14, title: t, type: 'subcat', timestamp: `2025-0${1 + (i % 9)}-01T00:00:00Z` })),
    ...members.map((t, i) => ({ pageid: 0, ns: 6, title: t, type: 'file', timestamp: `2025-0${1 + (i % 9)}-15T00:00:00Z` })),
  ],
}))
const search = {
  category: { 'media facade': ['Category:Media Facade', 'Category:Facades'], 'projection mapping': ['Category:Projection mapping', 'Category:Projection mapping in Prague'], 'light festival': ['Category:Festivals of lights'] },
  file: { 'media facade': [{ title: 'File:Uniqa Tower media facade colourful day.jpg', categories: ['Category:Uniqa Tower'] }] },
}

// ---------------------------------------------------------------- Wikipedia
const SM = (s, term) => s.replace(new RegExp(term, 'i'), (m) => m.split(' ').map((w) => `<span class="searchmatch">${w}</span>`).join(' '))
const wikis = {
  en: {
    search: { 'media facade': [
      ['Galleria Centercity', 'Galleria Centercity … its glass media facade of 22,000 LED pixels'],
      ['Media facade', 'A media facade is a facade of a building used as a display'],
      ['ExampleLED', 'ExampleLED supplies media facade systems'],
      ['Cheonan', 'the media facade of the Galleria Centercity department store'],
      ['Fixture Artist B', 'known for media facade works'],
      ['Uniqa Tower', 'The building has a media facade of LEDs'],
      ['List of tallest buildings in Fixtureland', 'several towers carry a media facade'],
    ] },
    pages: [
      ['Galleria Centercity', 'Q99000101', 'Galleria Centercity is a department store in Cheonan, South Korea. Its curved glass facade is a media facade of 22,000 LED pixels designed by UNStudio, completed in 2010.', [36.8188, 127.1559]],
      ['Media facade', 'Q17158007', 'A media facade is a facade of a building used as a large display. Media facades use LED technology.', null],
      ['ExampleLED', 'Q99000104', 'ExampleLED is a company that manufactures media facade systems and LED screens. It was founded in 2001 by two engineers.', null],
      ['Cheonan', 'Q99000301', 'Cheonan is a city in South Chungcheong Province, South Korea. The Galleria Centercity department store with its media facade is a landmark of the city.', [36.8151, 127.1139]],
      ['Fixture Artist B', 'Q99000105', 'Fixture Artist B is a German artist known for media facade works on buildings.', null],
      ['Uniqa Tower', 'Q99000103', 'The Uniqa Tower is a 75 m office building in Vienna, Austria. Its glass skin carries a media facade of 40,000 LEDs that shows animations at night.', [48.2117, 16.38]],
      ['List of tallest buildings in Fixtureland', 'Q99000109', 'This list ranks the tallest buildings in Fixtureland by height.', null],
    ],
  },
  ko: {
    search: { '미디어파사드': [['롯데월드타워', '외벽에 미디어파사드가 설치되어']] },
    pages: [['롯데월드타워', 'Q494895', '롯데월드타워는 서울특별시 송파구에 있는 초고층 빌딩이다. 외벽 상부에 미디어파사드가 설치되어 있어 야간에 영상을 상영한다.', [37.5125, 127.1025]]],
  },
  de: {
    search: { 'Medienfassade': [['Uniqa Tower', 'Die Medienfassade des Gebäudes']] },
    pages: [['Uniqa Tower', 'Q99000103', 'Der Uniqa Tower ist ein Hochhaus in Wien. Die Medienfassade des Gebäudes besteht aus LED-Leuchten hinter der Glashaut.', [48.2117, 16.38]]],
  },
}
const wikiOut = {}
for (const [lang, w] of Object.entries(wikis)) {
  wikiOut[lang] = {
    search: Object.fromEntries(Object.entries(w.search).map(([term, hits]) => [term, hits.map(([title, snippet], i) => ({ ns: 0, title, pageid: 7000000 + i + lang.charCodeAt(0) * 1000, size: 4000 + i * 100, wordcount: 600 + i * 20, snippet: SM(snippet, term), titlesnippet: '', timestamp: '2026-09-30T10:00:00Z' }))])),
    pages: w.pages.map(([title, qid, extract, coord], i) => ({ pageid: 7000000 + i + lang.charCodeAt(0) * 1000, ns: 0, title, pageprops: { wikibase_item: qid }, extract, ...(coord ? { coordinates: [{ lat: coord[0], lon: coord[1], primary: true, globe: 'earth' }] } : {}) })),
  }
}

// ---------------------------------------------------------------- web, links, Overpass
const gdelt = { articles: [
  { url: 'https://news.fixture.example/2026/10/seoul-city-hall-media-facade', url_mobile: '', title: 'Seoul unveils a new media facade on the city hall building', seendate: '20261018T101500Z', socialimage: '', domain: 'news.fixture.example', language: 'English', sourcecountry: 'South Korea' },
  { url: 'https://rent.fixture.example/led-screen-rental-prices', url_mobile: '', title: 'LED screen rental prices for events: get a quote today', seendate: '20261017T080000Z', socialimage: '', domain: 'rent.fixture.example', language: 'English', sourcecountry: 'United States' },
] }
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Fixture design feed</title><link>https://www.dezeen.com/</link><description>fixture</description>
<item><title>Projection mapping festival lights up a historic facade in Porto</title><link>https://www.dezeen.com/2026/10/15/projection-mapping-festival-porto/</link><pubDate>Wed, 15 Oct 2026 09:00:00 +0000</pubDate><description>A week-long projection mapping festival turned the facade of a historic building in Porto into a canvas.</description></item>
<item><title>Ten minimalist kitchens</title><link>https://www.dezeen.com/2026/10/14/minimalist-kitchens/</link><pubDate>Tue, 14 Oct 2026 09:00:00 +0000</pubDate><description>Kitchens.</description></item>
</channel></rss>
`
const links = {
  default: { status: 200, robots: 'User-agent: *\nAllow: /\n' },
  hosts: {
    'centercity.example': { status: 404, robots: '' },
    'www.signalfestival.com': { status: 200, robots: 'User-agent: *\nDisallow: /\n' },
  },
}
const overpass = { version: 0.6, generator: 'Overpass API fixture', osm3s: { timestamp_osm_base: '2026-10-20T00:00:00Z', copyright: 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.' }, elements: [
  { type: 'way', id: 100000001, center: { lat: 37.7986, lon: -122.3779 }, tags: { wikidata: 'Q7715933', name: 'The Bay Lights' } },
  { type: 'node', id: 100000002, lat: 34.1, lon: -118.31, tags: { wikidata: 'Q7899954', name: 'Urban Light' } },
] }

// ---------------------------------------------------------------- thumbnails
const W = 330, H = 220
const svg = {
  night_led: () => building('#04060c', '#15171d', grid(['#ff2a6d', '#05d9e8', '#ffb400', '#7b2cff'], 0.62)),
  night_led2: () => building('#020308', '#101218', grid(['#00e5ff', '#ff00a8', '#00ff6a'], 0.5)),
  night_projection: () => building('#05050a', '#1a1a22', `<path d="M110 60 L220 60 L230 200 L100 200 Z" fill="url(#g)"/><circle cx="165" cy="120" r="34" fill="#ffe600"/><rect x="120" y="150" width="90" height="30" fill="#ff3b30"/>`, `<linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ff0080"/><stop offset="0.5" stop-color="#8000ff"/><stop offset="1" stop-color="#00c8ff"/></linearGradient>`),
  night_projection2: () => building('#06040a', '#16141c', `<rect x="95" y="70" width="140" height="120" fill="url(#g)"/><rect x="125" y="95" width="80" height="40" fill="#00ffa0"/>`, `<linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff5a00"/><stop offset="1" stop-color="#ff00c8"/></linearGradient>`),
  night_field: () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#070512"/>${Array.from({ length: 160 }, (_, i) => `<circle cx="${(i * 37) % W}" cy="${110 + ((i * 53) % 110)}" r="3.4" fill="${['#ff3df2', '#3dd6ff', '#ffe23d', '#7dff3d'][i % 4]}"/>`).join('')}</svg>`,
  day: () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="s" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#9ec9ef"/><stop offset="1" stop-color="#e4f0fa"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#s)"/><rect x="100" y="40" width="130" height="180" fill="#c9c9c6"/>${Array.from({ length: 30 }, (_, i) => `<rect x="${108 + (i % 6) * 20}" y="${50 + Math.floor(i / 6) * 32}" width="12" height="20" fill="#8f9aa3"/>`).join('')}<rect y="200" width="${W}" height="20" fill="#b8b2a6"/></svg>`,
  colourful_day: () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#f4f6ff"/>${Array.from({ length: 11 }, (_, i) => `<rect x="${i * 30}" y="30" width="15" height="190" fill="${['#ff3b6b', '#ffd400', '#00c2ff', '#ff8a00'][i % 4]}"/>`).join('')}</svg>`,
  dark_only: () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#040406"/><rect x="140" y="0" width="8" height="${H}" fill="#9a9aa4"/><rect x="180" y="0" width="8" height="${H}" fill="#9a9aa4"/><rect y="200" width="${W}" height="20" fill="#0c0c10"/></svg>`,
  night_dim: () => building('#0a0a10', '#1c1c22', Array.from({ length: 12 }, (_, i) => `<rect x="${112 + (i % 4) * 28}" y="${70 + Math.floor(i / 4) * 40}" width="10" height="14" fill="#8a7a5a"/>`).join('')),
  interior: () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#9a8f80"/><rect x="20" y="20" width="290" height="120" fill="#d8d0c0"/><rect x="0" y="160" width="${W}" height="60" fill="#5b5248"/></svg>`,
}
function grid(colors, share) {
  const out = []
  for (let y = 50; y < 200; y += 12) for (let x = 104; x < 228; x += 12) { const i = (x * 7 + y * 13) % 100; if (i / 100 < share) out.push(`<rect x="${x}" y="${y}" width="9" height="9" fill="${colors[(x + y) % colors.length]}"/>`) }
  return out.join('')
}
function building(sky, body, facade, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}</defs><rect width="${W}" height="${H}" fill="${sky}"/><rect x="95" y="40" width="140" height="180" fill="${body}"/>${facade}<rect y="205" width="${W}" height="15" fill="#08080a"/></svg>`
}

// ---------------------------------------------------------------- write
await rm(path.join(OUT, 'wikidata'), { recursive: true, force: true })
await mkdir(path.join(OUT, 'wikidata/entities'), { recursive: true })
await mkdir(path.join(OUT, 'wikidata/sparql'), { recursive: true })
for (const e of E) await writeFile(path.join(OUT, 'wikidata/entities', e.id + '.json'), json(e))
for (const [q, [n, c]] of Object.entries(COUNTS)) await writeFile(path.join(OUT, 'wikidata/sparql', `class-count-${q}.json`), json({ head: { vars: ['instances', 'with_coords'] }, results: { bindings: [{ instances: INT(n), with_coords: INT(c) }] } }))
for (const [q, list] of Object.entries(INSTANCES)) await writeFile(path.join(OUT, 'wikidata/sparql', `class-instances-${q}.json`), json({ head: { vars: ['item'] }, results: { bindings: list.map((x) => ({ item: { type: 'uri', value: 'http://www.wikidata.org/entity/' + x } })) } }))
await mkdir(path.join(OUT, 'commons'), { recursive: true })
await writeFile(path.join(OUT, 'commons/categories.json'), json(categories))
await writeFile(path.join(OUT, 'commons/files.json'), json(files))
await writeFile(path.join(OUT, 'commons/search.json'), json(search))
await mkdir(path.join(OUT, 'wikipedia'), { recursive: true })
for (const [lang, w] of Object.entries(wikiOut)) await writeFile(path.join(OUT, 'wikipedia', lang + '.json'), json(w))
await mkdir(path.join(OUT, 'web'), { recursive: true })
await writeFile(path.join(OUT, 'web/gdelt.json'), json(gdelt))
await writeFile(path.join(OUT, 'web/feed.xml'), feed)
await writeFile(path.join(OUT, 'links.json'), json(links))
await writeFile(path.join(OUT, 'overpass.json'), json(overpass))
const sharp = await loadSharp()
await rm(path.join(OUT, 'thumbs'), { recursive: true, force: true })
await mkdir(path.join(OUT, 'thumbs'), { recursive: true })
for (const [kind, make] of Object.entries(svg)) await writeFile(path.join(OUT, 'thumbs', kind + '.jpg'), await sharp(Buffer.from(make())).jpeg({ quality: 82 }).toBuffer())
console.log(`fixtures: ${E.length} entities, ${categories.length} categories, ${files.length} files, ${Object.keys(svg).length} thumbnails`)
