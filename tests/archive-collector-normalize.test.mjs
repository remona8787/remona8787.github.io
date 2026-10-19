// Archive normalization, dedupe keys and reliability (normalize.mjs, gazetteer.mjs, dedupe.mjs, reliability.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  canonicalUrl, cleanTitle, cleanExcerpt, detectLanguage, languageCode, detectLocation, buildAliasIndex, matchAlias, extractName, REGION_BY_ISO,
} from '../edge-functions/_shared/archive/normalize.mjs'
import { COUNTRY_LIST, CITY_LIST } from '../edge-functions/_shared/archive/gazetteer.mjs'
import { titleTokens, jaccard, storyKey, normalizedName, clusterStories } from '../edge-functions/_shared/archive/dedupe.mjs'
import { sourceKindFor, reliability, confidence, registrableDomain, BASE } from '../edge-functions/_shared/archive/reliability.mjs'

const require = createRequire(import.meta.url)
const taxonomy = require('../site-public-cleared/archive-taxonomy.js')

test('canonical URL: lower-case host, no www., no utm_*/fbclid/gclid, no fragment; other parameters kept', () => {
  assert.equal(canonicalUrl('HTTPS://WWW.Dezeen.com/2026/10/x/?utm_source=rss&utm_medium=feed&id=3&fbclid=abc&gclid=1#comments'), 'https://dezeen.com/2026/10/x/?id=3')
  assert.equal(canonicalUrl('http://example.org:80/a?b=2&a=1'), 'http://example.org/a?b=2&a=1')
  assert.equal(canonicalUrl('https://news.example/a?utm_campaign=x'), 'https://news.example/a')
  assert.equal(canonicalUrl('ftp://example.org/'), null)
  assert.equal(canonicalUrl('not a url'), null)
  assert.equal(canonicalUrl('https://example.org/' + 'a'.repeat(2100)), null)
})

test('title cleaning: HTML, entities and the site-name suffix', () => {
  assert.equal(cleanTitle('A new <em>media facade</em> in Seoul | Dezeen'), 'A new media facade in Seoul')
  assert.equal(cleanTitle('Media facade lights up - designboom | architecture &amp; design magazine', { url: 'https://www.designboom.com/x' }), 'Media facade lights up')
  assert.equal(cleanTitle('[포토] 롯데타워 미디어파사드 - 연합뉴스'), '롯데타워 미디어파사드')
  assert.equal(cleanTitle('Tower glows – The Fixture Times', { publisher: 'The Fixture Times' }), 'Tower glows')
  assert.equal(cleanTitle('Seoul - Media facade season opens'), 'Seoul - Media facade season opens', 'an unknown last segment stays')
  assert.equal(cleanTitle('Dezeen'), 'Dezeen', 'the only segment stays')
  assert.ok([...cleanTitle('x'.repeat(800))].length <= 500)
  const ex = cleanExcerpt('<p>' + 'word '.repeat(200) + '</p>')
  assert.ok(ex && [...ex].length <= 300 && ex.endsWith('…'))
  assert.equal(cleanExcerpt('<p></p>'), null)
})

test('language: source tags and GDELT names first, then detection by script (Latin by stop words, else null)', () => {
  assert.equal(languageCode('en-GB'), 'en')
  assert.equal(languageCode('Korean'), 'ko')
  assert.equal(languageCode('Portuguese'), 'pt')
  assert.equal(languageCode(''), null)
  const samples = { ko: '롯데월드타워 미디어파사드 공개', ja: '東京都庁のプロジェクションマッピング', zh: '上海中心大厦媒体立面', ru: 'Медиафасад на здании', ar: 'واجهة إعلامية جديدة', en: 'The new tower and the plaza', de: 'Die neue Fassade und der Platz', fr: 'La nouvelle façade et les lumières', es: 'La fachada del edificio y los jardines', it: 'Il palazzo della città e la facciata', pt: 'A fachada do prédio e da praça não', nl: 'De gevel van het gebouw en een plein', pl: 'Fasada budynku w centrum i na placu', tr: 'Yeni medya cephesi ve ışık' }
  for (const [lang, text] of Object.entries(samples)) assert.equal(detectLanguage(text), lang, text)
  assert.equal(detectLanguage('LED'), null)
  assert.equal(detectLanguage(''), null)
})

test('the gazetteer region map is the taxonomy\'s, and every gazetteer country has a region', () => {
  assert.deepEqual(REGION_BY_ISO, taxonomy.regionByIso)
  for (const p of [...COUNTRY_LIST, ...CITY_LIST]) assert.ok(taxonomy.regionOf(p.iso2), p.iso2 + ' ' + p.names[0])
  assert.ok(COUNTRY_LIST.length >= 80 && CITY_LIST.length >= 150, `${COUNTRY_LIST.length} countries, ${CITY_LIST.length} cities`)
})

test('location: city decides the country; title before excerpt; overlapping names keep the longer one', () => {
  assert.deepEqual(detectLocation("Seoul's Lotte World Tower unveils a media facade"), { country_iso2: 'KR', city: 'Seoul', region: 'east_asia', matched: ['Seoul'] })
  assert.equal(detectLocation('서울 롯데월드타워 미디어파사드').city, 'Seoul')
  assert.equal(detectLocation('부산 해운대 미디어파사드').city, 'Busan')
  assert.deepEqual([detectLocation('東京都庁舎にプロジェクションマッピング').city, detectLocation('東京都庁舎にプロジェクションマッピング').country_iso2], ['Tokyo', 'JP'])
  assert.equal(detectLocation('上海中心大厦灯光秀').city, 'Shanghai')
  assert.equal(detectLocation('Fasada medialna w Warszawie').city, 'Warsaw')
  assert.equal(detectLocation('Медиафасад в Москве').city, 'Moscow')
  assert.equal(detectLocation('واجهة إعلامية في دبي').city, 'Dubai')
  assert.equal(detectLocation('İstanbul’da medya cephesi').city, 'Istanbul')
  assert.equal(detectLocation('North Korea shows an LED tower').country_iso2, 'KP')
  assert.equal(detectLocation('A media facade opens', 'The project in Linz, Austria').city, 'Linz')
  assert.equal(detectLocation('Korean artist shows a media facade').country_iso2, null, 'an adjective is not a place')
  // Common words that are also place names were left out of the gazetteer.
  assert.equal(detectLocation('인도 위에 설치된 미디어폴').country_iso2, null)
  assert.equal(detectLocation('Nice lighting for the plaza').country_iso2, null)
  assert.equal(detectLocation('스위스 취리히 미디어파사드').city, 'Zurich')
})

test('known-project aliases: longest alias wins, ties between projects and short or place-only aliases never match', () => {
  const index = buildAliasIndex([
    { project_id: '00000000-0000-4000-8000-000000000001', names: ['롯데월드타워 미디어파사드', '롯데월드타워', 'Lotte World Tower'], wikidata_qid: 'Q1000001' },
    { id: '00000000-0000-4000-8000-000000000002', name_original: 'Kunsthaus Graz', name_en: 'Kunsthaus Graz', aliases: ['BIX', 'Graz'] },
    { project_id: '00000000-0000-4000-8000-000000000003', names: ['Tower One'] },
    { project_id: '00000000-0000-4000-8000-000000000004', names: ['Tower One'] },
  ])
  assert.deepEqual(matchAlias('롯데월드타워 미디어파사드에 가을 영상', index), { project_id: '00000000-0000-4000-8000-000000000001', alias: '롯데월드타워 미디어파사드', name: '롯데월드타워 미디어파사드', wikidata_qid: 'Q1000001' })
  assert.equal(matchAlias("Lotte World Tower's LED skin", index)?.project_id, '00000000-0000-4000-8000-000000000001')
  assert.equal(matchAlias('The BIX facade of the Kunsthaus Graz', index)?.project_id, '00000000-0000-4000-8000-000000000002')
  assert.equal(matchAlias('Graz light festival', index), null, 'a place name alone is not a project alias')
  assert.equal(matchAlias('Tower One lights up', index), null, 'two projects share the alias: ambiguous')
  assert.equal(matchAlias('anything', null), null)
})

test('detected names from titles (a hint for editors), null when the title names none', () => {
  assert.equal(extractName('Lotte World Tower unveils new media facade'), 'Lotte World Tower')
  assert.equal(extractName("Seoul's Lotte World Tower unveils new media facade"), 'Lotte World Tower')
  assert.equal(extractName('Media facade for the Burj Khalifa'), 'Burj Khalifa')
  assert.equal(extractName('서울 롯데월드타워, 새 미디어파사드 공개'), '롯데월드타워')
  assert.equal(extractName('東京都庁のプロジェクションマッピング'), '東京都庁')
  assert.equal(extractName('上海中心大厦灯光秀'), '上海中心大厦')
  assert.equal(extractName("미디어파사드 '서울라이트' 개막"), '서울라이트')
  assert.equal(extractName('LED screen rental for events'), null)
  assert.equal(extractName('Band announces projection mapping concert tour'), null, 'a capitalised first word is not a name')
  assert.equal(extractName('서울 미디어파사드 축제'), null, 'a city is not a project name')
})

test('dedupe keys: tokens, Jaccard, stable story_key, normalized_name', () => {
  assert.deepEqual([...titleTokens('The new Media Façade of the Tower')].sort(), ['facade', 'media', 'tower'])
  assert.deepEqual([...titleTokens('미디어파사드를 공개')].sort(), ['공개', '미디어파사드'])
  assert.ok(titleTokens('上海中心大厦').has('上海'))
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1)
  assert.equal(jaccard(new Set(), new Set()), 0)
  assert.equal(storyKey('Media facade of the tower'), storyKey('The tower: media facade'))
  assert.match(storyKey('x'), /^st:[0-9a-f]{16}$/)
  assert.equal(normalizedName('롯데월드타워 미디어파사드'), normalizedName('롯데월드타워'))
  assert.equal(normalizedName('Kunsthaus  Graz'), 'kunsthausgraz')
  assert.equal(normalizedName('Zürich Tower (Main)'), 'zürichtowermain', 'like archive_norm_name: diacritics kept, punctuation gone')
  assert.equal(normalizedName('Media Facade'), null)
  assert.equal(normalizedName(null), null)
})

test('story clustering: Jaccard ≥ 0.6 within 14 days, the earliest item names the story', () => {
  const items = [
    { title: '롯데월드타워 미디어파사드 가을 콘텐츠 첫 공개', published_at: '2026-10-15T09:30:00Z' },
    { title: '롯데월드타워 미디어파사드 가을 콘텐츠 공개', published_at: '2026-10-15T08:30:00Z' },
    { title: 'Kunsthaus Graz media facade reopens', published_at: '2026-10-15T08:00:00Z' },
    { title: '롯데월드타워 미디어파사드 가을 콘텐츠 공개', published_at: '2026-09-01T08:30:00Z' },
    { title: 'Kunsthaus Graz BIX media facade is repaired after storm damage', published_at: '2026-10-16T08:00:00Z' },
  ]
  const { story_keys, clusters } = clusterStories(items)
  assert.equal(story_keys[0], story_keys[1])
  assert.equal(story_keys[0], storyKey(items[1].title), 'the earliest member names the story')
  // Six weeks apart: not in the cluster. Its key is the same by construction (identical title tokens); the SQL
  // applies the 14-day window with the dates when it compares stored story keys.
  assert.equal(story_keys[3], story_keys[1])
  assert.notEqual(story_keys[2], story_keys[4], 'Jaccard 4/10 < 0.6')
  assert.deepEqual(clusters.map((c) => c.members), [[0, 1]])
})

test('reliability: base by kind, +10 per further domain up to +20, −30 when broken; confidence formula', () => {
  assert.deepEqual(BASE, { official: 90, public_agency: 85, academic: 85, wikidata: 70, specialist_media: 70, news: 55, search_result: 40, blog: 30 })
  assert.equal(reliability('news'), 55)
  assert.equal(reliability('news', { independentDomains: 2 }), 65)
  assert.equal(reliability('news', { independentDomains: 5 }), 75)
  assert.equal(reliability('blog', { broken: true }), 0)
  assert.equal(reliability('official', { independentDomains: 3 }), 100)
  assert.equal(confidence(80, 55), 70)
  assert.equal(confidence(61, 70), 65)
})

test('source kind from the domain (publishers, agencies, universities, official sites), else from the provider', () => {
  const cases = [
    ['https://www.dezeen.com/2026/x', 'rss', 'specialist_media'], ['https://www.archdaily.com/1/x', 'brave', 'specialist_media'],
    ['https://www.yna.co.kr/view/1', 'gdelt', 'news'], ['https://n.news.naver.com/mnews/article/001/1', 'naver_news', 'news'],
    ['https://blog.naver.com/a/1', 'naver_blog', 'blog'], ['https://fixture.tistory.com/12', 'brave', 'blog'],
    ['https://news.seoul.go.kr/culture/1', 'gdelt', 'public_agency'], ['https://www.mcst.go.kr/x', 'gdelt', 'public_agency'],
    ['https://www.gov.uk/x', 'brave', 'public_agency'], ['https://www.culture.gouv.fr/x', 'brave', 'public_agency'],
    ['https://archi.snu.ac.kr/x', 'brave', 'academic'], ['https://www.mit.edu/x', 'brave', 'academic'], ['https://www.ucl.ac.uk/x', 'brave', 'academic'],
    ['https://mediaarchitecture.org/x', 'rss', 'academic'], ['https://www.vividsydney.com/event', 'brave', 'official'],
    ['https://unknown.example/x', 'brave', 'search_result'], ['https://unknown.example/x', 'gdelt', 'news'], ['https://unknown.example/x', 'rss', 'specialist_media'],
  ]
  for (const [url, provider, kind] of cases) assert.equal(sourceKindFor(url, provider), kind, url)
  assert.equal(registrableDomain('news.naver.com'), 'naver.com')
  assert.equal(registrableDomain('www.yna.co.kr'), 'yna.co.kr')
  assert.equal(registrableDomain('a.b.example.com'), 'example.com')
})
