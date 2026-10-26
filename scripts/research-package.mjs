#!/usr/bin/env node
// The public research dataset (docs/RESEARCH_DATA.md §1 '공개', §6): a versioned, citable package of the published
// archive, written next to the dataset at deploy time.
//
// From a published dataset (manifest.json, index.json and the shards) it writes, under data/research/<version>/:
//  - projects.csv, projects.json, projects.geojson: one row per project with the factual fields (names, type,
//    location, years, status, identifiers, provenance) and counts of sources and images;
//  - sources.csv: every source link of every project; images.csv: the metadata and licence of every published image
//    (not the image files);
//  - datapackage.json: a Frictionless-style descriptor (id, version, created, data as of, counts, countries and
//    regions, licences, sources, every resource with its bytes, SHA-256 and field schema = the data dictionary);
//  - README.md (Korean: contents, missing values, terms of use, citation), CITATION.txt and, when the previous
//    dataset is given, CHANGELOG.md (added, removed and changed projects);
// and data/research/latest.json, which names the current version and the checksum of each file.
// The version is the dataset's build id, so a version names exactly one dataset; earlier versions stay in the
// history of the site's main branch. Editorial summaries (summary_ko/summary_en) are left out until the operator sets
// their terms of use; images are listed with their own licence and author, never copied.
// Pure and deterministic: the same dataset gives byte-identical files (no clock, no network, no file access).
//
// Module: researchPackage(datasetFiles, {previous, siteURL}) → Map(path → string)
// CLI: node scripts/research-package.mjs --data=<published dataset dir> --out=<dir for data/research> [--previous=<dir>]
import path from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const SHARD = /^projects\/[a-z0-9_-]+\.json$/
const DATASET_ID = 'light-architecture-archive'
const TITLE = '빛의 건축 미디어파사드·미디어아트 아카이브 공개 데이터셋'
const str = (/** @type {any} */ v) => typeof v === 'string' ? v : Buffer.isBuffer(v) ? v.toString('utf8') : String(v ?? '')
const sha256 = (/** @type {string} */ s) => createHash('sha256').update(s, 'utf8').digest('hex')

// The data dictionary: [name, type, Korean title, description]. Order = column order of projects.csv.
export const PROJECT_FIELDS = /** @type {const} */ ([
  ['id', 'string', 'ID', '아카이브 프로젝트 ID. Wikidata 항목이면 QID, 편집부 수록이면 SEOUL001 형식, Commons 분류 기반이면 CAT-…'],
  ['name_ko', 'string', '한국어 이름', '없으면 빈 값'],
  ['name_en', 'string', '영어 이름', '없으면 빈 값'],
  ['name_original', 'string', '원어 이름', ''],
  ['name_original_lang', 'string', '원어 언어', 'ISO 639-1'],
  ['project_type', 'string', '유형', 'archive-taxonomy.js의 project_type 키 (media_facade, projection_mapping, light_art …)'],
  ['country_iso2', 'string', '국가', 'ISO 3166-1 alpha-2'],
  ['region', 'string', '세계 권역', ''],
  ['kr_region', 'string', '국내 권역', '국내 8개 권역 키 (seoul, gyeonggi_incheon …). 국외는 빈 값'],
  ['city', 'string', '도시(영문)', ''],
  ['city_ko', 'string', '시·군(한국어)', '출처의 행정구역 이름에서만 채움. 추정하지 않음'],
  ['district', 'string', '구·군', '출처의 행정구역 이름에서만 채움'],
  ['address', 'string', '주소', '출처에 있는 경우만'],
  ['lat', 'number', '위도', 'WGS84. 좌표가 없으면 빈 값'],
  ['lng', 'number', '경도', 'WGS84'],
  ['location_precision', 'string', '위치 정밀도', 'exact, approximate, city 등'],
  ['operating_status', 'string', '운영 상태', '출처에 근거한 값만. 모르면 빈 값'],
  ['year_installed', 'integer', '설치 연도', ''],
  ['year_completed', 'integer', '완공 연도', ''],
  ['year_operating_since', 'integer', '운영 시작 연도', ''],
  ['year_ended', 'integer', '종료 연도', ''],
  ['installation_method', 'string', '설치 방식', ''],
  ['envelope_type', 'string', '외피 유형', ''],
  ['technologies', 'string', '기술', '세미콜론(;)으로 구분'],
  ['spatial_context', 'string', '공간 맥락', '세미콜론(;)으로 구분'],
  ['content_types', 'string', '콘텐츠 유형', '세미콜론(;)으로 구분'],
  ['wikidata', 'string', 'Wikidata', 'QID'],
  ['commons_category', 'string', 'Commons 분류', ''],
  ['official_url', 'string', '공식 URL', ''],
  ['record_origin', 'string', '레코드 출처', 'wikidata, commons, curated, wikipedia …'],
  ['added_at', 'datetime', '처음 수록', 'ISO 8601'],
  ['source_count', 'integer', '출처 수', 'sources.csv의 행 수'],
  ['image_count', 'integer', '공개 이미지 수', 'images.csv의 행 수'],
  ['has_valid_image', 'boolean', '대표 이미지 있음', '프로젝트 사진(project_media, project_installation) 또는 건축 맥락 사진이 카드·대표로 지정됨'],
  ['field_sources', 'string', '필드별 출처', 'JSON 객체: 필드 이름 → 출처 ID (sources.csv의 source_id)'],
])
export const SOURCE_FIELDS = /** @type {const} */ ([
  ['project_id', 'string', '프로젝트 ID', ''], ['source_id', 'string', '출처 ID', ''], ['kind', 'string', '종류', 'wikidata, wikipedia, official, public_agency, news …'],
  ['title', 'string', '제목', ''], ['publisher', 'string', '발행처', ''], ['url', 'string', 'URL', ''],
])
export const IMAGE_FIELDS = /** @type {const} */ ([
  ['project_id', 'string', '프로젝트 ID', ''], ['image_id', 'string', '이미지 ID', ''], ['kind', 'string', '이미지 역할', 'project_media, project_installation, architecture_context, technical_documentation, event_documentation'],
  ['role', 'string', '화면 역할', 'hero, featured, card, gallery, context'], ['title', 'string', '제목', 'Commons 파일 이름 또는 제공처 제목'],
  ['provider', 'string', '제공처', ''], ['author', 'string', '저작자', ''], ['license', 'string', '라이선스', ''], ['license_url', 'string', '라이선스 URL', ''],
  ['commercial_use', 'boolean', '상업적 이용 가능', '라이선스 기준. 공공누리 2·4유형과 NC는 false'], ['width', 'integer', '너비(px)', '원본'], ['height', 'integer', '높이(px)', '원본'],
  ['page', 'string', '원본 페이지', '저작자·라이선스를 확인할 수 있는 페이지'],
])

const VALID_CARD_KINDS = new Set(['project_media', 'project_installation', 'architecture_context'])
const list = (/** @type {any} */ v) => Array.isArray(v) ? v.filter((x) => x != null && x !== '').map(String) : []
const num = (/** @type {any} */ v) => typeof v === 'number' && Number.isFinite(v) ? v : null
const int = (/** @type {any} */ v) => Number.isInteger(v) ? v : null

/** A CSV cell (RFC 4180). Text that a spreadsheet would run as a formula gets a leading apostrophe. */
function cell(/** @type {any} */ v, /** @type {string} */ type) {
  if (v == null || v === '') return ''
  let s = type === 'boolean' ? (v ? 'true' : 'false') : String(v)
  if (type === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
const csv = (/** @type {readonly (readonly string[])[]} */ fields, /** @type {Record<string, any>[]} */ rows) =>
  [fields.map((f) => f[0]).join(','), ...rows.map((r) => fields.map(([k, t]) => cell(r[k], t)).join(','))].join('\r\n') + '\r\n'

function projectRow(/** @type {any} */ p) {
  const images = Array.isArray(p.images) ? p.images : []
  return {
    id: p.id, name_ko: p.name_ko, name_en: p.name_en, name_original: p.name_original, name_original_lang: p.name_original_lang,
    project_type: p.project_type, country_iso2: p.country_iso2, region: p.region, kr_region: p.kr_region, city: p.city, city_ko: p.city_ko,
    district: p.district, address: p.address, lat: num(p.lat), lng: num(p.lng), location_precision: p.location_precision,
    operating_status: p.operating_status, year_installed: int(p.year_installed), year_completed: int(p.year_completed),
    year_operating_since: int(p.year_operating_since), year_ended: int(p.year_ended), installation_method: p.installation_method,
    envelope_type: p.envelope_type, technologies: list(p.technologies).join(';'), spatial_context: list(p.spatial_context).join(';'),
    content_types: list(p.content_types).join(';'), wikidata: p.wikidata, commons_category: p.commons_category, official_url: p.official_url,
    record_origin: p.record_origin, added_at: p.added_at, source_count: Array.isArray(p.sources) ? p.sources.length : 0, image_count: images.length,
    has_valid_image: images.some((i) => ['hero', 'featured', 'card'].includes(i?.role) && VALID_CARD_KINDS.has(i?.kind ?? 'project_media')),
    field_sources: p.field_sources && typeof p.field_sources === 'object' ? JSON.stringify(p.field_sources) : '',
  }
}

/** Parses a published dataset (Map of relative path → Buffer|string) into its records, in index order. */
export function readDataset(/** @type {Map<string, any>} */ files) {
  const json = (/** @type {string} */ k) => { if (!files.has(k)) throw Error(k + ': missing'); return JSON.parse(str(files.get(k))) }
  const manifest = json('manifest.json'), index = json('index.json')
  if (!Array.isArray(index?.fields) || !Array.isArray(index?.rows)) throw Error('index.json: no fields/rows')
  const byId = new Map()
  for (const f of Array.isArray(manifest?.files?.shards) ? manifest.files.shards : []) {
    if (typeof f !== 'string' || !SHARD.test(f) || !files.has(f)) continue
    for (const p of json(f)?.projects || []) if (p?.id) byId.set(p.id, p)
  }
  const at = index.fields.indexOf('id')
  const records = index.rows.map((/** @type {any[]} */ r) => byId.get(r[at])).filter(Boolean)
  return { manifest, records }
}

/**
 * @param {Map<string, any>} datasetFiles the published dataset
 * @param {{previous?: Map<string, any> | null, siteURL?: string}} [o] previous: the dataset deployed before (CHANGELOG)
 * @returns {Map<string, string>} files to add to the site tree (data/research/…)
 */
export function researchPackage(datasetFiles, { previous = null, siteURL = 'https://remona8787.github.io' } = {}) {
  const { manifest, records } = readDataset(datasetFiles)
  const version = String(manifest.build_id || '')
  if (!/^[0-9A-Za-z-]{6,80}$/.test(version)) throw Error('manifest.json: no usable build_id')
  const site = siteURL.replace(/\/+$/, '')
  const base = `data/research/${version}/`
  const created = manifest.generated_at || null
  const asOf = created ? created.slice(0, 10) : null
  const rows = records.map(projectRow)
  const sources = records.flatMap((p) => (Array.isArray(p.sources) ? p.sources : []).map((s) => ({ project_id: p.id, source_id: s.id, kind: s.kind, title: s.title, publisher: s.publisher, url: s.url })))
  const images = records.flatMap((p) => (Array.isArray(p.images) ? p.images : []).map((i) => ({
    project_id: p.id, image_id: i.id, kind: i.kind, role: i.role, title: i.title, provider: i.provider, author: i.author, license: i.license, license_url: i.license_url,
    commercial_use: typeof i.commercial_use === 'boolean' ? i.commercial_use : null, width: int(i.width), height: int(i.height), page: i.page,
  })))
  const count = (/** @type {string} */ k) => Object.fromEntries([...rows.reduce((m, r) => (r[k] && m.set(r[k], (m.get(r[k]) || 0) + 1), m), new Map())].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))))
  const geo = { type: 'FeatureCollection', features: rows.filter((r) => r.lat != null && r.lng != null).map((r) => ({
    type: 'Feature', id: r.id, geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: { id: r.id, name_ko: r.name_ko, name_en: r.name_en, project_type: r.project_type, country_iso2: r.country_iso2, kr_region: r.kr_region, city: r.city, location_precision: r.location_precision, wikidata: r.wikidata },
  })) }
  const citation = `빛의 건축 (Architecture of Light). (${asOf?.slice(0, 4) || 'n.d.'}). ${TITLE} (버전 ${version}, 데이터 기준일 ${asOf || '미상'}). ${site}/${base}`
  const data = new Map([
    ['projects.csv', csv(PROJECT_FIELDS, rows)],
    ['projects.json', JSON.stringify({ dataset: DATASET_ID, version, data_as_of: asOf, projects: rows.map((r) => ({ ...r, field_sources: r.field_sources ? JSON.parse(r.field_sources) : {} })) }, null, 1) + '\n'],
    ['projects.geojson', JSON.stringify(geo) + '\n'],
    ['sources.csv', csv(SOURCE_FIELDS, sources)],
    ['images.csv', csv(IMAGE_FIELDS, images)],
    ['CITATION.txt', citation + '\n'],
  ])
  let changes = null
  if (previous) {
    try {
      const prev = readDataset(previous), before = new Map(prev.records.map((p) => [p.id, JSON.stringify(projectRow(p))])), now = new Map(rows.map((r) => [r.id, JSON.stringify(r)]))
      changes = { from: String(prev.manifest.build_id || ''), added: [...now.keys()].filter((k) => !before.has(k)), removed: [...before.keys()].filter((k) => !now.has(k)), changed: [...now.keys()].filter((k) => before.has(k) && before.get(k) !== now.get(k)) }
      data.set('CHANGELOG.md', `# 변경 내역\n\n이전 버전 ${changes.from} → 이번 버전 ${version}\n\n- 추가 ${changes.added.length}건${changes.added.length ? ': ' + changes.added.join(', ') : ''}\n- 삭제 ${changes.removed.length}건${changes.removed.length ? ': ' + changes.removed.join(', ') : ''}\n- 변경 ${changes.changed.length}건${changes.changed.length ? ': ' + changes.changed.join(', ') : ''}\n\n변경은 projects.csv의 열 값 기준입니다. 이전 버전 파일은 사이트 저장소(main 브랜치)의 기록에 남아 있습니다.\n`)
    } catch { changes = null }
  }
  const schema = (/** @type {readonly (readonly string[])[]} */ fields) => ({ fields: fields.map(([name, type, title, description]) => ({ name, type, title, ...(description ? { description } : {}) })) })
  const resource = (/** @type {string} */ name, /** @type {string} */ file, /** @type {string} */ format, /** @type {string} */ mediatype, /** @type {any} */ fields) => {
    const body = /** @type {string} */ (data.get(file))
    return { name, path: file, format, mediatype, encoding: 'utf-8', bytes: Buffer.byteLength(body), hash: 'sha256:' + sha256(body), ...(fields ? { schema: schema(fields) } : {}) }
  }
  const descriptor = {
    profile: 'tabular-data-package', id: `${DATASET_ID}@${version}`, name: DATASET_ID, title: TITLE, version, created, data_as_of: asOf,
    homepage: site + '/', description: '미디어파사드·건축 미디어아트·빛 설치 작품의 사실 정보(이름, 유형, 위치, 연도, 운영 상태, 식별자, 출처)와 공개 이미지의 저작권 정보. 편집부 해설문과 이미지 파일은 포함하지 않습니다.',
    counts: { projects: rows.length, with_coordinates: geo.features.length, sources: sources.length, images: images.length, by_country: count('country_iso2'), by_kr_region: count('kr_region'), by_type: count('project_type') },
    licenses: [{ name: 'CC0-1.0', path: 'https://creativecommons.org/publicdomain/zero/1.0/', title: 'Wikidata에서 온 사실 정보' }, { name: 'other', title: '그 밖의 출처: sources.csv의 각 출처 조건, 이미지는 images.csv의 각 라이선스' }],
    sources: [{ title: 'Wikidata', path: 'https://www.wikidata.org/' }, { title: 'Wikimedia Commons', path: 'https://commons.wikimedia.org/' }, { title: 'Wikipedia', path: 'https://www.wikipedia.org/' }, { title: '빛의 건축 편집부 수록 레코드', path: site + '/' }],
    citation, ...(changes ? { changes: { from: changes.from, added: changes.added.length, removed: changes.removed.length, changed: changes.changed.length } } : {}),
    resources: [
      resource('projects', 'projects.csv', 'csv', 'text/csv', PROJECT_FIELDS), resource('projects-json', 'projects.json', 'json', 'application/json', null),
      resource('projects-geojson', 'projects.geojson', 'geojson', 'application/geo+json', null), resource('sources', 'sources.csv', 'csv', 'text/csv', SOURCE_FIELDS),
      resource('images', 'images.csv', 'csv', 'text/csv', IMAGE_FIELDS), resource('citation', 'CITATION.txt', 'txt', 'text/plain', null),
      ...(data.has('CHANGELOG.md') ? [resource('changelog', 'CHANGELOG.md', 'md', 'text/markdown', null)] : []),
    ],
  }
  data.set('datapackage.json', JSON.stringify(descriptor, null, 1) + '\n')
  const dict = (/** @type {string} */ file, /** @type {readonly (readonly string[])[]} */ fields) => `### ${file}\n\n| 열 | 형식 | 이름 | 설명 |\n|---|---|---|---|\n${fields.map(([n, t, ti, d]) => `| \`${n}\` | ${t} | ${ti} | ${d || ''} |`).join('\n')}\n`
  data.set('README.md', `# ${TITLE}

- 데이터셋 ID: \`${DATASET_ID}\` · 버전: \`${version}\` (수집 빌드 ID와 같음)
- 생성: ${created || '미상'} · 데이터 기준일: ${asOf || '미상'}
- 프로젝트 ${rows.length}건 (좌표 있음 ${geo.features.length}건) · 출처 ${sources.length}건 · 이미지 정보 ${images.length}건
- 국가 ${Object.keys(descriptor.counts.by_country).length}곳 · 국내 권역 ${Object.entries(descriptor.counts.by_kr_region).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'}

## 파일

projects.csv · projects.json · projects.geojson · sources.csv · images.csv · datapackage.json(필드 정의와 체크섬) · CITATION.txt${data.has('CHANGELOG.md') ? ' · CHANGELOG.md' : ''}

## 결측치와 검증 상태

- 빈 값은 '출처에서 확인하지 못함'을 뜻합니다. 추정한 값으로 채우지 않습니다.
- 필드별 출처는 \`field_sources\`에 있습니다. 출처 ID는 sources.csv의 \`source_id\`입니다.
- 이미지는 자동 규칙(동일성·관련성·권리)을 통과한 것만 실립니다. 사람의 육안 검수를 거쳤다는 뜻은 아닙니다.
- 편집부 해설문(summary)은 이용 조건이 정해질 때까지 이 데이터셋에 넣지 않습니다.
- CSV에서 \`=\`, \`+\`, \`-\`, \`@\`로 시작하는 텍스트는 스프레드시트가 수식으로 실행하지 않도록 앞에 \`'\`를 붙였습니다.

## 이용 조건

- Wikidata에서 온 사실 정보는 CC0 1.0입니다.
- 그 밖의 정보는 sources.csv에 적힌 각 출처의 조건을 따릅니다.
- 이미지는 이 데이터셋에 들어 있지 않습니다. 쓰려면 images.csv의 원본 페이지에서 저작자와 라이선스를 확인하고 그 조건을 지켜야 합니다. \`commercial_use\`가 false인 이미지는 상업적으로 이용할 수 없습니다.
- 이 데이터셋에 대해 독점적 권리를 주장하지 않습니다.

## 인용

${citation}

## 필드 정의 (데이터 사전)

${dict('projects.csv', PROJECT_FIELDS)}
${dict('sources.csv', SOURCE_FIELDS)}
${dict('images.csv', IMAGE_FIELDS)}`)
  const out = new Map()
  for (const [f, body] of data) out.set(base + f, body)
  out.set('data/research/latest.json', JSON.stringify({
    dataset: DATASET_ID, title: TITLE, version, created, data_as_of: asOf, path: base, citation,
    counts: { projects: rows.length, sources: sources.length, images: images.length },
    files: Object.fromEntries([...data].map(([f, body]) => [f, { bytes: Buffer.byteLength(body), sha256: sha256(body) }])),
  }, null, 1) + '\n')
  return out
}

async function loadDir(/** @type {string} */ dir) {
  const files = new Map()
  for (const f of ['manifest.json', 'index.json']) if (existsSync(path.join(dir, f))) files.set(f, await readFile(path.join(dir, f), 'utf8'))
  const shards = files.has('manifest.json') ? JSON.parse(files.get('manifest.json'))?.files?.shards : []
  for (const f of Array.isArray(shards) ? shards : []) if (typeof f === 'string' && SHARD.test(f) && existsSync(path.join(dir, f))) files.set(f, await readFile(path.join(dir, f), 'utf8'))
  return files
}

async function main() {
  const arg = (/** @type {string} */ k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
  const data = path.resolve(arg('data') || 'dist/data'), out = path.resolve(arg('out') || 'dist'), prev = arg('previous')
  const files = researchPackage(await loadDir(data), { previous: prev ? await loadDir(path.resolve(prev)) : null, siteURL: arg('site-url') || process.env.SITE_URL || undefined })
  for (const [f, body] of files) { await mkdir(path.dirname(path.join(out, f)), { recursive: true }); await writeFile(path.join(out, f), body) }
  console.log(`research package: ${files.size} files under ${path.relative(process.cwd(), out) || '.'}/data/research/`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1) })
