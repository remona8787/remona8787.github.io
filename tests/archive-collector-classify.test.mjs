// Archive classifier (edge-functions/_shared/archive/classify.mjs): labels and statuses on realistic positive and
// negative examples in all 14 supported languages, precision on a mixed set, the projection-mapping context rule,
// explainable reasons, language gating, keyword merging and the version string.
import test from 'node:test'
import assert from 'node:assert/strict'
import { classify, compileKeywords, defaultKeywords, positiveMatch, statusForScore, CLASSIFIER_VERSION, LABELS } from '../edge-functions/_shared/archive/classify.mjs'
import { SEED_KEYWORDS } from '../edge-functions/_shared/archive/seed-rules.mjs'
import { CASES } from './fixtures/archive/classifier-cases.mjs'

const LANGS = ['ko', 'en', 'ja', 'zh', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'tr']
const run = (/** @type {typeof CASES[number]} */ c) => classify({ title: c.title, excerpt: c.excerpt, language: c.lang })

test('every supported language has seeded terms of all three polarities and positive and negative test cases', () => {
  for (const lang of LANGS) {
    for (const polarity of ['positive', 'context', 'negative']) assert.ok(SEED_KEYWORDS.some((k) => k.language === lang && k.polarity === polarity), `${lang} ${polarity}`)
    assert.ok(CASES.filter((c) => c.lang === lang && c.relevant).length >= 2, `${lang}: two positive cases`)
    assert.ok(CASES.filter((c) => c.lang === lang && !c.relevant).length >= 2, `${lang}: two negative cases`)
  }
})

test('each case gets its expected label; relevant cases are reviewable, the others auto-ignored', () => {
  for (const c of CASES) {
    const r = run(c)
    assert.equal(r.label, c.label, `${c.lang}: ${c.title}\n${r.reasons.join('\n')}`)
    const status = statusForScore(r.score)
    if (c.relevant) assert.notEqual(status, 'auto_ignored', `${c.lang} positive scored ${r.score}: ${c.title}`)
    else assert.equal(status, 'auto_ignored', `${c.lang} negative scored ${r.score}: ${c.title}`)
  }
})

test('precision and recall on the mixed set (ads, vendors, rentals, jobs, real estate, renovations, concerts, real projects)', () => {
  let tp = 0, fp = 0, fn = 0
  for (const c of CASES) {
    const reviewable = statusForScore(run(c).score) !== 'auto_ignored'
    if (reviewable && c.relevant) tp++
    else if (reviewable) fp++
    else if (c.relevant) fn++
  }
  const precision = tp / (tp + fp), recall = tp / (tp + fn)
  assert.ok(precision >= 0.95, 'precision ' + precision)
  assert.ok(recall >= 0.95, 'recall ' + recall)
  // Strong project stories reach the review queue (≥ 60), not just "uncertain".
  for (const c of CASES.filter((x) => x.relevant && x.label === 'facade_project' && /tower|타워|大厦|grattacielo|wieżowcu|небоскреба|gökdelen/i.test(x.title))) {
    assert.ok(run(c).score >= 60, `${c.lang}: ${c.title} → ${run(c).score}`)
  }
})

test('"projection mapping" scores only with a building/facade/architecture context', () => {
  const stage = classify({ title: 'Projection mapping concert lights up the stadium', excerpt: 'A live show with projection mapping on stage.', language: 'en' })
  assert.equal(stage.score < 35, true)
  assert.ok(stage.reasons.some((r) => /no building\/facade context/.test(r)), stage.reasons.join('\n'))
  const building = classify({ title: 'Projection mapping on the city hall building', language: 'en' })
  assert.ok(building.score >= 60, String(building.score))
  assert.equal(building.label, 'facade_project')
  const ja = classify({ title: 'ライブでプロジェクションマッピング', language: 'ja' })
  const jaBuilding = classify({ title: '駅舎の外壁にプロジェクションマッピング', language: 'ja' })
  assert.ok(ja.score < 35 && jaBuilding.score >= 35, `${ja.score} ${jaBuilding.score}`)
})

test('the output is explainable and bounded: score 0..100, a known label, ≤ 20 reasons, the version', () => {
  const r = classify({ title: 'Media facade media facade LED facade digital facade interactive facade facade projection on the tower building skyscraper landmark', excerpt: 'unveiled installed festival night skyline pixels', language: 'en' })
  assert.ok(r.score >= 0 && r.score <= 100)
  assert.ok(LABELS.includes(r.label))
  assert.ok(r.reasons.length <= 20)
  assert.match(r.reasons[0], /^score \d+ = positive \d+ \+ context \d+/)
  assert.match(r.reasons[1], /^label /)
  assert.ok(r.reasons.some((x) => x.includes('(capped)')), 'per-category cap is reported')
  assert.equal(r.version, CLASSIFIER_VERSION)
  assert.deepEqual(classify({ title: '' }), { score: 0, label: 'irrelevant', reasons: ['score 0 = positive 0 + context 0 + title 0 − negative 0', 'label irrelevant: no positive term'], version: CLASSIFIER_VERSION })
})

test('deterministic: the same input gives the same result', () => {
  const a = classify({ title: CASES[0].title, excerpt: CASES[0].excerpt, language: 'en' })
  const b = classify({ title: CASES[0].title, excerpt: CASES[0].excerpt, language: 'en' })
  assert.deepEqual(a, b)
})

test('Korean terms match with particles and without spaces; Latin text glued to Hangul still matches', () => {
  assert.ok(positiveMatch({ title: '롯데월드타워의 미디어파사드를 보다' }))
  assert.ok(positiveMatch({ title: '미디어 파사드 점등' }))
  assert.ok(positiveMatch({ title: 'LED파사드가 설치된 건물' }))
  assert.equal(positiveMatch({ title: '가을 단풍 여행지 추천' }), false)
})

test('Latin terms of another language count only for that language (or unknown); English terms count everywhere', () => {
  // "cena" is a price in Polish and a dinner in Spanish.
  const es = classify({ title: 'Fachada multimedia del edificio se estrena con una cena de gala', language: 'es' })
  assert.ok(!es.reasons.some((r) => r.includes('"cena"')), es.reasons.join('\n'))
  const pl = classify({ title: 'Fasada medialna, cena za metr', language: 'pl' })
  assert.ok(pl.reasons.some((r) => r.includes('"cena"')))
  assert.ok(classify({ title: '新しいmedia facade', language: 'ja' }).score > 0)
})

test('keyword lists from the database: seed list keeps the base version, a changed list gets its own version and categories', () => {
  assert.equal(compileKeywords(SEED_KEYWORDS.map((k) => ({ term: k.term, language: k.language, polarity: k.polarity, weight: k.weight, enabled: true }))).version, CLASSIFIER_VERSION)
  const custom = compileKeywords([...SEED_KEYWORDS, { term: 'lumen tower', language: 'en', polarity: 'positive', weight: 50 }])
  assert.match(custom.version, new RegExp('^' + CLASSIFIER_VERSION.replace(/\./g, '\\.') + '\\+kw\\.[0-9a-f]{8}$'))
  assert.ok(classify({ title: 'The lumen tower opens', language: 'en' }, custom).score >= 50)
  // A disabled keyword is left out; a seeded term loaded without category gets the seed's category back.
  const off = compileKeywords(SEED_KEYWORDS.map((k) => k.term === 'projection mapping' && k.language === 'en' ? { ...k, enabled: false, category: undefined } : { ...k, category: undefined }))
  const t = off.terms.find((x) => x.term === 'projection mapping')
  assert.ok(t && !t.languages.has('en'), 'the English row is disabled; other languages still carry the term')
  assert.equal(defaultKeywords().terms.find((x) => x.term === 'media facade*')?.category, 'facade')
  assert.equal(compileKeywords([{ term: 'x', language: 'en', polarity: 'positive', weight: 0 }, { term: '', language: 'en', polarity: 'negative', weight: 10 }]).terms.length, 0)
})

test('status thresholds follow the spec and the settings row', () => {
  assert.deepEqual([statusForScore(60), statusForScore(59), statusForScore(35), statusForScore(34)], ['needs_review', 'uncertain', 'uncertain', 'auto_ignored'])
  assert.equal(statusForScore(50, { review_threshold: 50 }), 'needs_review')
  assert.equal(statusForScore(40, { auto_ignore_below: 45 }), 'auto_ignored')
})

test('seed keywords are unique by (term, language) and use the documented vocabularies', () => {
  const seen = new Set()
  for (const k of SEED_KEYWORDS) {
    const key = k.term + '|' + k.language
    assert.ok(!seen.has(key), 'duplicate ' + key)
    seen.add(key)
    assert.ok(LANGS.includes(k.language), k.language)
    assert.ok(['positive', 'context', 'negative'].includes(k.polarity))
    assert.ok(Number.isInteger(k.weight) && k.weight > 0 && k.weight <= 100)
    const cats = { positive: ['facade', 'projection', 'event', 'screen', 'art', 'lighting'], context: ['arch', 'context'], negative: ['ad', 'rental', 'vendor', 'real_estate', 'job'] }[k.polarity]
    assert.ok(cats.includes(k.category), `${k.term}: ${k.category}`)
  }
})
