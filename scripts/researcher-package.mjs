#!/usr/bin/env node
// The approved-researcher package (v2.0, docs/RESEARCH_DATA.md "v2.0 researcher package"). Not the public package:
// scripts/research-package.mjs builds that one at every deploy (data/research/<version>/, open to everyone, unchanged).
// This one adds, on top of the public records, the archive's quality and verification layer that the public files do
// not carry in analysis-ready form: per-project image status and the reason a photo is missing, candidate counts,
// broken-link counts from the latest link check, derived research variables (decade, official-source flag, source
// kinds, artwork vs context image counts) and a versioned data dictionary. Its values come from the published dataset
// and the data branch's admin-data/; no value gets a licence condition its source does not have (Wikidata CC0 stays
// CC0). Files are written locally; uploading to the private bucket research-datasets is an operator step.
//   node scripts/researcher-package.mjs --data=<data branch checkout> --out=<dir> --version=2.0.0 [--dataset=aol-research]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { xlsx } from './xlsx.mjs'

const require = createRequire(import.meta.url)
const ART = require('../site-public-cleared/art-photo-policy.js')
const SITE = 'https://remona8787.github.io'
const LICENCE = 'CC BY 4.0 (편집·파생 변수) · 각 값은 원출처의 라이선스(Wikidata CC0 등)를 따름'
const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/'

const join = (a) => (Array.isArray(a) ? a.filter((x) => x !== null && x !== undefined && x !== '').join('; ') : '')
const firstYear = (p) => [p.year_installed, p.year_completed, p.year_operating_since, p.start_date && Number(String(p.start_date).slice(0, 4))].map(Number).find((n) => Number.isFinite(n) && n > 1800) ?? null
const ARTWORK = new Set(['project_media', 'project_installation'])
const OFFICIAL_KINDS = new Set(['official', 'public_agency', 'organizer', 'artist', 'venue', 'producer'])

// [name, type, description, origin] — the column order of every file.
export const DICTIONARY = [
  ['project_id', 'string', '아카이브 고유 ID. 공개 페이지 주소 /p/<id>/와 같고 버전이 바뀌어도 유지된다.', 'archive'],
  ['url', 'string', '공개 상세 페이지 주소', 'archive'],
  ['name_ko', 'string', '국문명', 'source/editorial'],
  ['name_en', 'string', '영문명', 'source/editorial'],
  ['name_original', 'string', '원어명', 'source'],
  ['name_original_lang', 'string', '원어명의 언어 코드', 'source'],
  ['country_iso2', 'string', '국가 (ISO 3166-1 alpha-2)', 'source'],
  ['world_region', 'string', '세계 권역 (아카이브 분류)', 'derived'],
  ['city', 'string', '도시 (영문 또는 원어)', 'source'],
  ['city_ko', 'string', '도시 (국문)', 'source/derived'],
  ['kr_division', 'string', '국내 광역 시·도 (국내 사례만)', 'derived'],
  ['district', 'string', '시·군·구', 'source/derived'],
  ['lat', 'number', '위도 (WGS84)', 'source'],
  ['lng', 'number', '경도 (WGS84)', 'source'],
  ['location_precision', 'string', '좌표 정밀도', 'derived'],
  ['project_type', 'string', '프로젝트 유형', 'editorial'],
  ['kind', 'string', '기록 종류', 'editorial'],
  ['year_installed', 'integer', '설치 연도', 'source'],
  ['year_completed', 'integer', '완공 연도', 'source'],
  ['year_operating_since', 'integer', '운영 시작 연도', 'source'],
  ['year_ended', 'integer', '운영 종료 연도', 'source'],
  ['start_date', 'date', '시작일 (행사·전시)', 'source'],
  ['end_date', 'date', '종료일 (행사·전시)', 'source'],
  ['decade', 'integer', '처음 알려진 연도의 10년 단위', 'derived'],
  ['status', 'string', '운영 상태', 'source/editorial'],
  ['creators', 'string', '작가·건축가·제작사 "이름 (역할)", 세미콜론 구분', 'source'],
  ['creator_wikidata', 'string', '작가·제작사 Wikidata ID, 세미콜론 구분', 'source'],
  ['technologies', 'string', '사용 기술, 세미콜론 구분', 'source/editorial'],
  ['official_url', 'string', '공식 웹사이트', 'source'],
  ['wikidata', 'string', 'Wikidata 항목 ID', 'source'],
  ['commons_category', 'string', 'Wikimedia Commons 분류', 'source'],
  ['source_count', 'integer', '연결된 출처 수', 'derived'],
  ['source_kinds', 'string', '출처 종류, 세미콜론 구분', 'derived'],
  ['has_official_source', 'boolean', '공식 웹사이트 또는 공공기관·주최 측 출처가 있는가', 'derived'],
  ['record_origin', 'string', '기록의 출발점 (curated, wikidata, registry 등)', 'archive'],
  ['added_at', 'date', '처음 수록된 날', 'archive'],
  ['confidence_coordinates', 'string', '좌표의 근거 수준', 'editorial'],
  ['confidence_dates', 'string', '연도·기간의 근거 수준', 'editorial'],
  ['confidence_artist', 'string', '작가 정보의 근거 수준', 'editorial'],
  ['confidence_architect', 'string', '건축가 정보의 근거 수준', 'editorial'],
  ['confidence_project_type', 'string', '유형 분류의 근거 수준', 'editorial'],
  ['image_count', 'integer', '공개 이미지 수 (권리 확인된 것만)', 'derived'],
  ['image_count_artwork', 'integer', '작품이 작동하는 모습의 이미지 수', 'derived'],
  ['image_count_context', 'integer', '건물·행사 맥락 이미지 수', 'derived'],
  ['image_status', 'string', 'representative · artwork_below_bar · context_only · other_only · none', 'derived'],
  ['image_missing_reason', 'string', '대표 이미지가 없는 까닭 (no_candidate, refused:<사유>, context_only 등)', 'quality'],
  ['image_candidates', 'integer', '최근 수집에서 검토한 이미지 후보 수 (대표 이미지가 없을 때)', 'quality'],
  ['rep_image_license', 'string', '대표 이미지 라이선스', 'source'],
  ['rep_image_author', 'string', '대표 이미지 저작자', 'source'],
  ['rep_image_page', 'string', '대표 이미지 출처 페이지', 'source'],
  ['rep_image_provider', 'string', '대표 이미지 제공처', 'source'],
  ['rep_image_width', 'integer', '대표 이미지 원본 가로 픽셀', 'source'],
  ['broken_link_count', 'integer', '최근 점검에서 응답하지 않은 출처·공식 링크 수', 'quality'],
  ['data_as_of', 'date', '기준일 (공개 데이터 생성일)', 'archive'],
  ['build_id', 'string', '원본 공개 데이터 빌드 ID', 'archive'],
].map(([name, type, description_ko, origin]) => ({ name, type, description_ko, origin }))

function imageStatus(p) {
  const imgs = Array.isArray(p.images) ? p.images : []
  if (ART.representativeOf(p)) return 'representative'
  if (!imgs.length) return 'none'
  const kinds = imgs.map((i) => ART.kindOf(i))
  if (imgs.some((i) => { const c = ART.classify(i); return c.visual?.ok && c.identity?.ok })) return 'artwork_below_bar'
  if (kinds.every((k) => k === 'architecture_context')) return 'context_only'
  return 'other_only'
}

function rowOf(p, ctx) {
  const imgs = Array.isArray(p.images) ? p.images : []
  const rep = ART.representativeOf(p)
  const kinds = imgs.map((i) => ART.kindOf(i))
  const sources = Array.isArray(p.sources) ? p.sources : []
  const fy = firstYear(p)
  const fc = p.field_confidence || {}
  const status = imageStatus(p)
  const miss = ctx.missing?.get(p.id)
  const reason = status === 'representative' ? null
    : status === 'context_only' ? 'context_only'
    : status === 'other_only' ? 'no_artwork_image'
    : status === 'artwork_below_bar' ? 'artwork_below_bar'
    : miss?.candidates ? 'refused:' + (Object.entries(miss.refused || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown')
    : 'no_candidate'
  return {
    project_id: p.id, url: `${SITE}/p/${p.id}/`,
    name_ko: p.name_ko ?? null, name_en: p.name_en ?? null, name_original: p.name_original ?? null, name_original_lang: p.name_original_lang ?? null,
    country_iso2: p.country_iso2 ?? null, world_region: p.region ?? null, city: p.city ?? null, city_ko: p.city_ko ?? null, kr_division: p.kr_division ?? null, district: p.district ?? null,
    lat: Number.isFinite(p.lat) ? p.lat : null, lng: Number.isFinite(p.lng) ? p.lng : null, location_precision: p.location_precision ?? null,
    project_type: p.project_type ?? null, kind: p.kind ?? null,
    year_installed: p.year_installed ?? null, year_completed: p.year_completed ?? null, year_operating_since: p.year_operating_since ?? null, year_ended: p.year_ended ?? null,
    start_date: p.start_date ?? null, end_date: p.end_date ?? null, decade: fy ? Math.floor(fy / 10) * 10 : null,
    status: p.operating_status || p.status || null,
    creators: join((p.credits || []).map((c) => `${c.name || c.name_en}${c.role ? ` (${c.role})` : ''}`)),
    creator_wikidata: join((p.credits || []).map((c) => c.wikidata_qid)),
    technologies: join(p.technologies),
    official_url: p.official_url ?? null, wikidata: p.wikidata ?? null, commons_category: p.commons_category ?? null,
    source_count: sources.length, source_kinds: join([...new Set(sources.map((s) => s.kind).filter(Boolean))].sort()),
    has_official_source: !!p.official_url || sources.some((s) => OFFICIAL_KINDS.has(s.kind)),
    record_origin: p.record_origin ?? null, added_at: p.added_at ?? null,
    confidence_coordinates: fc.coordinates ?? null, confidence_dates: fc.dates ?? null, confidence_artist: fc.artist ?? null, confidence_architect: fc.architect ?? null, confidence_project_type: fc.project_type ?? null,
    image_count: imgs.length, image_count_artwork: kinds.filter((k) => ARTWORK.has(k)).length, image_count_context: kinds.filter((k) => k === 'architecture_context' || k === 'event_documentation').length,
    image_status: status, image_missing_reason: reason, image_candidates: status === 'representative' ? null : (miss?.candidates ?? null),
    rep_image_license: rep?.license ?? null, rep_image_author: rep?.author ?? null, rep_image_page: rep?.page ?? null, rep_image_provider: rep?.provider ?? null, rep_image_width: rep?.width ?? null,
    broken_link_count: ctx.broken ? (ctx.broken.get(p.id) || 0) : null,
    data_as_of: ctx.asOf, build_id: ctx.buildId,
  }
}

// CSV: UTF-8 with BOM, RFC 4180 quoting, and an apostrophe before text that would start a formula (CSV injection).
export function csvCell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function build({ data, out, version, dataset = 'aol-research' }) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error('version must be x.y.z')
  const siteData = path.join(data, 'site-data')
  const manifest = JSON.parse(await readFile(path.join(siteData, 'manifest.json'), 'utf8'))
  const records = []
  for (const s of manifest.files.shards) records.push(...(JSON.parse(await readFile(path.join(siteData, s), 'utf8')).projects || []))
  records.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  let broken = null, missing = null
  try {
    const q = JSON.parse(await readFile(path.join(data, 'admin-data/quality.json'), 'utf8'))
    broken = new Map(); missing = new Map((q.missing_images || []).map((m) => [m.id, m]))
    for (const b of q.broken_links || []) broken.set(b.project, (broken.get(b.project) || 0) + 1)
  } catch {}
  const asOf = String(manifest.generated_at || '').slice(0, 10)
  const ctx = { asOf, buildId: manifest.build_id, broken, missing }
  const rows = records.map((p) => rowOf(p, ctx))
  const cols = DICTIONARY.map((d) => d.name)
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) throw new Error('column not in the dictionary: ' + k)
  const dir = path.join(out, dataset, version)
  await mkdir(dir, { recursive: true })
  const base = `${dataset}-${version}`
  const files = {}
  files[`${base}.csv`] = Buffer.from('﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n', 'utf8')
  files[`${base}.json`] = Buffer.from(JSON.stringify({ dataset, version, data_as_of: asOf, build_id: manifest.build_id, licence: LICENCE, licence_url: LICENCE_URL, columns: cols, records: rows }, null, 1))
  files[`${base}.geojson`] = Buffer.from(JSON.stringify({ type: 'FeatureCollection', name: base, features: rows.filter((r) => r.lat !== null && r.lng !== null).map((r) => ({ type: 'Feature', id: r.project_id, geometry: { type: 'Point', coordinates: [r.lng, r.lat] }, properties: Object.fromEntries(cols.filter((c) => c !== 'lat' && c !== 'lng').map((c) => [c, r[c]])) })) }))
  const fields = DICTIONARY.map((d) => [d.name, d.type])
  files[`${base}.xlsx`] = xlsx([
    { name: 'projects', fields, rows },
    { name: 'dictionary', fields: [['name', 'string'], ['type', 'string'], ['description_ko', 'string'], ['origin', 'string']], rows: DICTIONARY },
  ])
  files['data-dictionary.json'] = Buffer.from(JSON.stringify({ dataset, version, columns: DICTIONARY }, null, 1))
  files['data-dictionary.md'] = Buffer.from(`# ${dataset} ${version} 데이터 사전\n\n기준일 ${asOf} · 원본 빌드 ${manifest.build_id} · ${rows.length}건\n\n| 열 | 형식 | 설명 | 값의 출처 |\n|---|---|---|---|\n${DICTIONARY.map((d) => `| \`${d.name}\` | ${d.type} | ${d.description_ko} | ${d.origin} |`).join('\n')}\n\n값의 출처: source = 원출처(Wikidata, 공식 웹사이트, 공공기관 등), editorial = 아카이브 편집, derived = 다른 값에서 계산, quality = 수집기의 품질 점검(admin-data/quality.json), archive = 아카이브 식별 정보.\n`)
  const sha256 = {}
  for (const [name, buf] of Object.entries(files)) { await writeFile(path.join(dir, name), buf); sha256[name] = createHash('sha256').update(buf).digest('hex') }
  const formats = ['csv', 'json', 'geojson', 'xlsx']
  const citation = `빛의 건축 (Architecture of Light). (${asOf.slice(0, 4)}). ${dataset} v${version} [Data set]. ${SITE}/#data`
  const m = {
    dataset, version, data_as_of: asOf, build_id: manifest.build_id, record_count: rows.length, with_coordinates: rows.filter((r) => r.lat !== null).length,
    formats, licence: LICENCE, licence_url: LICENCE_URL, citation, sha256, storage_prefix: `${dataset}/${version}`,
    // Registers the version (operator, Supabase SQL editor) after the files are uploaded to research-datasets/<storage_prefix>/.
    catalog_sql: `insert into public.research_dataset_versions(dataset_id,version,data_as_of,record_count,formats,storage_prefix,sha256,citation) values('${dataset}','${version}','${asOf}',${rows.length},array[${formats.map((f) => `'${f}'`).join(',')}],'${dataset}/${version}','${JSON.stringify(Object.fromEntries(formats.map((f) => [f, sha256[`${base}.${f}`]])))}','${citation.replace(/'/g, "''")}') on conflict do nothing;`,
  }
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 1))
  return { dir, manifest: m }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d
  const r = await build({ data: arg('data', '../data'), out: arg('out', 'researcher-package'), version: arg('version', '2.0.0'), dataset: arg('dataset', 'aol-research') })
  console.log(`[researcher-package] ${r.manifest.record_count} records → ${r.dir}`)
  for (const [f, h] of Object.entries(r.manifest.sha256)) console.log(`  ${f}  ${h.slice(0, 16)}…`)
}
