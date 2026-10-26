#!/usr/bin/env node
// Static project pages for search engines and link previews (docs/UI_v018.md "Search engines and link previews").
//
// The app routes with the URL fragment (#place/<id>), which crawlers and link-preview scrapers (Naver, Kakao, Facebook,
// X) never see. This script turns a published dataset (docs/STATIC_ARCHIVE.md "Output": manifest.json, index.json and
// the shards) into plain, readable HTML. It writes:
//  - p/<dataset id>/index.html for every project of index.json: title, description, canonical, OG and Twitter meta,
//    JSON-LD (the project, a breadcrumb, and every photo as an ImageObject with creator, licence and credit), the
//    credited photo with its renditions, facts, sources, other projects of the same region, and a link into the app;
//  - p/index.html, every project grouped by Korean region, then by country (a page a crawler can follow);
//  - sitemap.xml: the site's own pages plus these;
//  - a <meta name="aol-static-pages"> marker in index.html. With it the app points canonical and share links at
//    p/<id>/; without it (no pages deployed) it never links there.
// It reads the dataset with the app's own readers (client/dataset-rows.mjs), so photos, tiers and renditions are the
// ones the app shows, and nothing the readers reject (non-https links, photos without a licence and an author) is
// printed. Pages are Korean with the names in other languages; no script runs on them.
//
// Module (pure, no network or files):
//   prerenderSite(datasetFiles, distTree, {siteURL}) → Map(path → string) of files to add to the tree (the deploy's
//     entry point: p/…, sitemap.xml, index.html);
//   prerender({manifest, index, shards}, {siteURL}) → {files, entries, count} (the pages and the sitemap entries).
// CLI: node scripts/prerender.mjs --dist=<built site> --data=<published dataset dir> [--site-url=https://…]
//   The site URL defaults to the canonical URL of <dist>/index.html (scripts/build.mjs writes SITE_URL there). A
//   dataset that is missing or does not parse leaves <dist> as it was (exit 0, with a warning): the site still deploys.
import path from 'node:path'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import T from '../site-public-cleared/archive-taxonomy.js'
import { fromIndex, fromShard } from '../client/dataset-rows.mjs'

const SITE_NAME = '빛의 건축'
const E = (/** @type {any} */ v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c)
// JSON inside <script type="application/ld+json">: no "</script>" and no HTML comment can close it.
const J = (/** @type {any} */ v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
const clip = (/** @type {string} */ s, n) => s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s
const KR_ORDER = T.krRegions.map((/** @type {any[]} */ r) => r[0])
// Korean sections of the app (catalog.js sectionOf): façades and screens, everything else is media art and exhibitions.
const FACADE_TYPES = new Set(['media_facade', 'projection_mapping', 'urban_screen', 'media_wall'])

/** @param {any} p */
const cityOf = p => p.city_ko || p.city || ''
/** @param {any} p */
function placeLine(p) {
  const city = cityOf(p)
  if (p.country_iso2 === 'KR') return [city, p.district && p.district !== city ? p.district : ''].filter(Boolean).join(' ') || (p.kr_region ? T.krRegionLabel(p.kr_region, 'ko') : '대한민국')
  return [city, p.country].filter(Boolean).join(', ')
}
/** @param {any} p */
const typeLabel = p => p.project_type ? T.label('project_type', p.project_type, 'ko') : ''
/** @param {any} p */
const yearOf = p => p.year_installed || p.year_completed || p.year_operating_since || null
/** @param {any} p */
function sectionOf(p) {
  if (p.country_iso2 !== 'KR') return { key: 'world', label: '세계 미디어파사드', route: 'world' }
  return FACADE_TYPES.has(p.project_type) ? { key: 'korea', label: '국내 미디어파사드', route: 'korea' } : { key: 'programs', label: '국내 미디어아트·전시', route: 'programs' }
}
/** @param {any} p */
function groupOf(p) {
  if (p.country_iso2 === 'KR') return p.kr_region ? { id: 'kr-' + p.kr_region, label: T.krRegionLabel(p.kr_region, 'ko') } : { id: 'kr-unknown', label: '국내 · 지역 미확인' }
  return { id: 'c-' + (p.country_iso2 || 'xx').toLowerCase(), label: p.country || '나라 미확인' }
}
/** The description: the record's own summary, else a plain statement of what the record holds (never invented facts). @param {any} p @param {number} photos */
function description(p, photos) {
  const own = p.summary_ko || p.summary_en
  if (own) return clip(own, 160)
  const what = [typeLabel(p) || '빛의 건축 프로젝트', yearOf(p) ? yearOf(p) + '년' : ''].filter(Boolean).join(' · ')
  return clip(`${placeLine(p)}의 ${what}. ${photos ? '저작자와 라이선스를 밝힌 사진, ' : ''}위치와 출처를 빛의 건축 아카이브에 기록했어요.`, 160)
}
/** A rendition near the wanted width (the smallest at least that wide, else the largest). @param {any} m @param {number} want */
function near(m, want) {
  const s = Array.isArray(m.sizes) && m.sizes.length ? m.sizes : [[m.width || 0, m.display_url]]
  return s.find((/** @type {[number,string]} */ x) => x[0] >= want) || s[s.length - 1]
}
/** @param {any} m */
const credit = m => [m.creator || m.attribution, m.license_code].filter(Boolean).join(' · ')
/** @param {any} m */
const providerName = m => ({ commons: 'Wikimedia Commons', openverse: 'Openverse', flickr: 'Flickr', tourapi: '한국관광공사 TourAPI', kto_photo: '한국관광공사 포토코리아', unsplash: 'Unsplash', pexels: 'Pexels', official: '공식 자료', editor: '편집팀' })[m.image_provider] || ''

/** One photo: srcset of its renditions, never shown wider than its largest one. @param {any} m @param {string} alt @param {string} sizes @param {boolean} first */
function img(m, alt, sizes, first) {
  const s = Array.isArray(m.sizes) && m.sizes.length ? m.sizes : null
  const src = s ? near(m, 960)[1] : m.display_url
  const w = s ? s[s.length - 1][0] : m.width, h = w && m.width && m.height ? Math.round(w * m.height / m.width) : null
  return `<img src="${E(src)}"${s && s.length > 1 ? ` srcset="${E(s.map(x => `${x[1]} ${x[0]}w`).join(', '))}" sizes="${E(sizes)}"` : ''}${w && h ? ` width="${w}" height="${h}"` : ''} alt="${E(alt)}" decoding="async"${first ? ' fetchpriority="high"' : ' loading="lazy"'}>`
}
/** @param {any} m */
function figcaption(m) {
  const lic = m.license_url ? `<a href="${E(m.license_url)}" rel="license noopener" target="_blank">${E(m.license_code)}</a>` : E(m.license_code)
  const bits = [`© ${E(m.creator || m.attribution)}`, lic, providerName(m) ? E(providerName(m)) : '', m.rights_holder ? `권리자 ${E(m.rights_holder)}` : '', m.source_url ? `<a href="${E(m.source_url)}" rel="noopener" target="_blank">원본 보기</a>` : '']
  return `<figcaption>${bits.filter(Boolean).join(' · ')}</figcaption>`
}

const HEAD = (/** @type {string} */ up) => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#1C1F4A" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0D0F26" media="(prefers-color-scheme: dark)"><link rel="icon" href="${up}assets/favicon.svg" type="image/svg+xml"><link rel="icon" href="${up}assets/favicon.png" sizes="48x48" type="image/png"><link rel="apple-touch-icon" href="${up}assets/apple-touch-icon.png"><link rel="stylesheet" href="${up}assets/fonts/pretendard/pretendardvariable-dynamic-subset.css"><link rel="stylesheet" href="${up}styles.css">`
const BAR = (/** @type {string} */ up, /** @type {string} */ back, /** @type {string} */ backLabel) => `<a class="skip" href="#content">본문으로</a><header class="static-bar"><div class="static-bar-inner"><a class="static-brand" href="${up}" aria-label="빛의 건축 홈"><img class="logo-light" src="${up}assets/logo-ko-light-compact.svg" alt="" width="118" height="32"><img class="logo-dark" src="${up}assets/logo-ko-dark-compact.svg" alt="" width="118" height="32"></a><a class="static-back" href="${E(back)}"><svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"/></svg><span>${E(backLabel)}</span></a></div></header>`
const FOOT = (/** @type {string} */ up) => `<footer class="static-footer"><nav aria-label="안내"><a href="${up}p/">프로젝트 목록</a><a href="${up}about.html">서비스 소개</a><a href="${up}privacy.html">개인정보 처리방침</a><a href="${up}terms.html">이용 안내</a><a href="${up}support.html">지원 및 문의</a><a href="${up}partner.html">파트너·후원</a></nav><p>사진마다 저작자와 라이선스를 밝혀요. 운영 정보는 방문 전 공식 안내를 확인하세요.</p><p>© 빛의 건축 · Architecture of Light</p></footer>`

/** @param {any} p @param {any[]} media @param {any[]} related @param {string} site */
function projectPage(p, media, related, site) {
  const id = p.dataset_id, url = `${site}/p/${encodeURIComponent(id)}/`, up = '../../', app = `${up}#place/${encodeURIComponent(id)}`
  const name = p.name_kr, others = [p.name_en, p.name_original].filter(n => n && n !== name).filter((n, i, a) => a.indexOf(n) === i)
  const line = placeLine(p), type = typeLabel(p), year = yearOf(p), sec = sectionOf(p), grp = groupOf(p)
  const shown = media.filter(m => !m.context).concat(media.filter(m => m.context)).slice(0, 7)
  const lead = shown[0] || null, desc = description(p, shown.length)
  const title = `${name}${line ? ' · ' + line : ''} · ${SITE_NAME}`
  const og = lead ? near(lead, 1200) : null
  const ogImage = og ? og[1] : `${site}/assets/og-image.png`
  const alt = (/** @type {any} */ m) => `${name}${m.context ? ' 건축 맥락 사진' : ''}${m.creator ? ', 사진 ' + m.creator : ''}`
  const facts = [
    ['유형', type], ['위치', line], ['주소', p.address],
    ['건물', p.building_name], ['연도', year ? `${year}년${p.year_ended ? ` – ${p.year_ended}년` : ''}` : ''],
    ['운영', p.operating_status ? T.label('operating_status', p.operating_status, 'ko') : ''],
    ...(p.credits || []).slice(0, 8).map((/** @type {any} */ c) => [T.label('credit_role', c.role, 'ko') || '참여', c.name]),
  ].filter(f => f[1])
  const official = p.official_url ? `<a href="${E(p.official_url)}" rel="noopener" target="_blank">공식 사이트</a>` : ''
  const sources = (p.sources || []).slice(0, 12)
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CreativeWork', '@id': url + '#project', url, name, inLanguage: 'ko',
        ...(others.length ? { alternateName: others } : {}), description: desc,
        ...(type ? { genre: type } : {}), ...(year ? { dateCreated: String(year) } : {}),
        ...(p.credits?.length ? { creator: p.credits.slice(0, 8).map((/** @type {any} */ c) => ({ '@type': 'Thing', name: c.name })) } : {}),
        contentLocation: {
          '@type': 'Place', name: p.building_name || line || name,
          address: { '@type': 'PostalAddress', addressCountry: p.country_iso2 || undefined, addressLocality: cityOf(p) || undefined, streetAddress: p.address || undefined },
          ...(p.latitude !== null && p.longitude !== null ? { geo: { '@type': 'GeoCoordinates', latitude: p.latitude, longitude: p.longitude } } : {}),
        },
        sameAs: [p.wikidata ? 'https://www.wikidata.org/wiki/' + p.wikidata : null, p.official_url].filter(Boolean),
        image: shown.map(m => ({
          '@type': 'ImageObject', contentUrl: near(m, 1920)[1], ...(m.width && m.height ? { width: m.width, height: m.height } : {}),
          creator: { '@type': 'Person', name: m.creator || m.attribution }, creditText: m.attribution || credit(m), copyrightNotice: m.creator || m.attribution,
          ...(m.license_url ? { license: m.license_url } : {}), ...(m.source_url ? { acquireLicensePage: m.source_url } : {}),
        })),
      },
      {
        '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: site + '/' },
          { '@type': 'ListItem', position: 2, name: '프로젝트 목록', item: site + '/p/' },
          { '@type': 'ListItem', position: 3, name: grp.label, item: `${site}/p/#${grp.id}` },
          { '@type': 'ListItem', position: 4, name, item: url },
        ],
      },
    ],
  }
  const gallery = shown.slice(1)
  return `<!doctype html><html lang="ko"><head>${HEAD(up)}<title>${E(title)}</title><meta name="description" content="${E(desc)}"><link rel="canonical" href="${E(url)}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="article"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:locale" content="ko_KR"><meta property="og:title" content="${E(name + (line ? ' · ' + line : ''))}"><meta property="og:description" content="${E(desc)}"><meta property="og:url" content="${E(url)}"><meta property="og:image" content="${E(ogImage)}">${og && lead.width && lead.height ? `<meta property="og:image:width" content="${og[0]}"><meta property="og:image:height" content="${Math.round(og[0] * lead.height / lead.width)}">` : og ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'}<meta property="og:image:alt" content="${E(lead ? alt(lead) : '빛의 건축 로고')}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${E(name)}"><meta name="twitter:description" content="${E(desc)}"><meta name="twitter:image" content="${E(ogImage)}"><script type="application/ld+json">${J(ld)}</script></head><body>${BAR(up, app, '앱에서 보기')}<main class="legal project-page" id="content"><article class="legal-article">`
    + `<nav class="crumbs" aria-label="위치"><a href="${up}">홈</a><span aria-hidden="true">›</span><a href="${up}p/">프로젝트 목록</a><span aria-hidden="true">›</span><a href="${up}p/#${E(grp.id)}">${E(grp.label)}</a></nav>`
    + `<p class="eyebrow">${E([sec.label, p.country_iso2 === 'KR' ? (p.kr_region ? T.krRegionLabel(p.kr_region, 'ko') : '') : p.country].filter(Boolean).join(' · '))}</p><h1>${E(name)}</h1>${others.length ? `<p class="alt-names">${others.map(n => `<span lang="${n === p.name_en ? 'en' : E(p.name_original_lang || '')}">${E(n)}</span>`).join(' · ')}</p>` : ''}`
    + (lead ? `<figure class="project-photo${lead.context ? ' is-context' : ''}">${img(lead, alt(lead), '(min-width: 832px) 790px, calc(100vw - 32px)', true)}${figcaption(lead)}</figure>` : '')
    + (p.summary_ko ? `<p class="lead">${E(p.summary_ko)}</p>` : p.summary_en ? `<p class="lead" lang="en">${E(p.summary_en)}</p>` : '')
    + (facts.length ? `<dl class="project-facts">${facts.map(f => `<dt>${E(f[0])}</dt><dd>${E(f[1])}</dd>`).join('')}</dl>` : '')
    + `<p class="project-actions"><a class="button" href="${E(app)}">빛의 건축에서 자세히 보기</a>${official}</p>`
    + (gallery.length ? `<h2>사진</h2><ul class="project-gallery">${gallery.map(m => `<li><figure>${img(m, alt(m), '(min-width: 832px) 380px, calc(100vw - 32px)', false)}${figcaption(m)}</figure></li>`).join('')}</ul>` : '')
    + (sources.length ? `<h2>출처</h2><ul class="project-sources">${sources.map((/** @type {any} */ s) => `<li><a href="${E(s.url)}" rel="noopener" target="_blank">${E(s.title || s.publisher || new URL(s.url).hostname)}</a>${s.publisher && s.title && s.publisher !== s.title ? ` · ${E(s.publisher)}` : ''}</li>`).join('')}</ul>` : '')
    + (related.length ? `<h2>${E(grp.label)}의 다른 프로젝트</h2><ul class="project-related">${related.map(r => `<li><a href="${up}p/${encodeURIComponent(r.dataset_id)}/">${E(r.name_kr)}</a> <span>${E([typeLabel(r), yearOf(r)].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>` : '')
    + `</article></main>${FOOT(up)}</body></html>`
}

/** @param {any[]} places @param {string} site */
function listPage(places, site) {
  const up = '../', url = site + '/p/'
  /** @type {Map<string, {id: string, label: string, items: any[]}>} */ const groups = new Map()
  const kr = places.filter(p => p.country_iso2 === 'KR'), world = places.filter(p => p.country_iso2 !== 'KR')
  for (const key of [...KR_ORDER, null]) {
    const items = kr.filter(p => (p.kr_region || null) === key)
    if (items.length) { const g = groupOf(items[0]); groups.set(g.id, { ...g, items }) }
  }
  const byCountry = new Map()
  for (const p of world) { const g = groupOf(p); if (!byCountry.has(g.id)) byCountry.set(g.id, { ...g, items: [] }); byCountry.get(g.id).items.push(p) }
  const countries = [...byCountry.values()].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'ko'))
  const sort = (/** @type {any[]} */ xs) => [...xs].sort((a, b) => a.name_kr.localeCompare(b.name_kr, 'ko'))
  const list = (/** @type {any} */ g) => `<section class="project-group" id="${E(g.id)}"><h3>${E(g.label)} <span class="count">${g.items.length}</span></h3><ul>${sort(g.items).map(p => `<li><a href="./${encodeURIComponent(p.dataset_id)}/">${E(p.name_kr)}</a> <span>${E([p.country_iso2 === 'KR' ? placeLine(p) : cityOf(p), typeLabel(p), yearOf(p)].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul></section>`
  const desc = `빛의 건축 아카이브의 프로젝트 ${places.length}곳: 국내 ${kr.length}곳을 지역별로, 세계 ${world.length}곳을 나라별로 모았어요.`
  return `<!doctype html><html lang="ko"><head>${HEAD(up)}<title>프로젝트 목록 · ${SITE_NAME}</title><meta name="description" content="${E(desc)}"><link rel="canonical" href="${E(url)}"><meta property="og:type" content="website"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:locale" content="ko_KR"><meta property="og:title" content="프로젝트 목록 · ${SITE_NAME}"><meta property="og:description" content="${E(desc)}"><meta property="og:url" content="${E(url)}"><meta property="og:image" content="${E(site)}/assets/og-image.png"><meta name="twitter:card" content="summary_large_image"></head><body>${BAR(up, up, '앱으로 돌아가기')}<main class="legal project-page project-index" id="content"><article class="legal-article"><p class="eyebrow">빛의 건축 아카이브</p><h1>프로젝트 목록</h1><p class="lead">${E(desc)}</p>`
    + `<h2>국내</h2>${[...groups.values()].map(list).join('')}`
    + (countries.length ? `<h2>세계</h2>${countries.map(list).join('')}` : '')
    + `</article></main>${FOOT(up)}</body></html>`
}

/**
 * @param {{manifest?: any, index: any, shards: Record<string, any>}} dataset
 * @param {{siteURL: string}} o
 */
export function prerender(dataset, { siteURL }) {
  const site = String(siteURL || '').replace(/\/+$/, '')
  if (!/^https:\/\/[^/]+$/.test(site)) throw Error('siteURL must be an https site root, e.g. https://remona8787.github.io')
  const places = fromIndex(dataset.index, { publicURL: site })
  /** @type {Map<string, any>} */ const full = new Map(), cityKo = new Map()
  for (const json of Object.values(dataset.shards || {})) {
    try { for (const [k, v] of fromShard(json, { publicURL: site })) full.set(k, v) } catch { /* a bad shard: its projects get their compact page */ }
    // The Korean city name (city_ko) is a record field the app's place does not keep.
    for (const r of Array.isArray(json?.projects) ? json.projects : []) if (typeof r?.city_ko === 'string' && r.city_ko.trim() && r.city_ko.length <= 60) cityKo.set('AR-' + r.id, r.city_ko.trim())
  }
  // A project of index.json with its full record when its shard has it.
  const all = places.map(p => { const f = full.get(p.place_id), city_ko = cityKo.get(p.place_id) || null; return f ? { place: { ...p, ...f.place, kr_region: f.place.kr_region ?? p.kr_region, thumb: p.thumb, city_ko }, media: f.media.filter(Boolean) } : { place: { ...p, city_ko }, media: [] } })
  /** @type {Map<string, string>} */ const files = new Map()
  for (const { place, media } of all) {
    const g = groupOf(place).id
    const related = all.filter(x => x.place !== place && groupOf(x.place).id === g).map(x => x.place)
      .sort((a, b) => (b.thumb ? 1 : 0) - (a.thumb ? 1 : 0) || a.name_kr.localeCompare(b.name_kr, 'ko')).slice(0, 8)
    files.set(`p/${place.dataset_id}/index.html`, projectPage(place, media, related, site))
  }
  files.set('p/index.html', listPage(all.map(x => x.place), site))
  const day = (/** @type {any} */ t) => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null
  const entries = [{ loc: site + '/p/', lastmod: day(dataset.manifest?.generated_at) }, ...all.map(x => ({ loc: `${site}/p/${encodeURIComponent(x.place.dataset_id)}/`, lastmod: day(x.place.created_at) }))]
  return { files, entries, count: all.length }
}

/** sitemap.xml: the given one's <url> entries (the site's own pages) plus the project pages. @param {string} existing @param {{loc: string, lastmod: string|null}[]} entries */
export function sitemapWith(existing, entries) {
  const own = [...String(existing || '').matchAll(/<url>[\s\S]*?<\/url>/g)].map(m => m[0]).filter(u => !/<loc>[^<]*\/p\//.test(u))
  const add = entries.map(e => `<url><loc>${E(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...own, ...add].join('\n')}\n</urlset>\n`
}

export const MARKER = '<meta name="aol-static-pages" content="p/">'
/** index.html with the marker that lets the app link to p/<id>/. @param {string} html */
export const withMarker = html => html.includes(MARKER) ? html : html.replace('</head>', MARKER + '</head>')

const SHARD = /^projects\/[A-Za-z0-9_-]{1,40}\.json$/
const str = (/** @type {any} */ v) => v == null ? '' : typeof v === 'string' ? v : new TextDecoder().decode(v)
/** The site root named by the canonical link of index.html. @param {string} html */
export const canonicalSite = html => (/<link rel="canonical" href="(https:\/\/[^/"]+)\/?"/.exec(html) || [])[1] || null

/**
 * The deploy's entry point (pipeline/deploy.mjs), pure: the dataset files it publishes (a Map of 'manifest.json',
 * 'index.json' and 'projects/<shard>.json' to Buffer or string, as loadDataset returns them) and the built site's tree
 * (a Map of relative path to Buffer or string) → the files to add or replace in the tree: p/…, sitemap.xml (the
 * site's own entries kept) and index.html (with the marker). siteURL defaults to the canonical URL of index.html.
 * Throws on a dataset that does not parse; the deploy then publishes the site without p/.
 * @param {Map<string, any>} datasetFiles @param {Map<string, any>} distTree @param {{siteURL?: string}} [o]
 * @returns {Map<string, string>}
 */
export function prerenderSite(datasetFiles, distTree, { siteURL } = {}) {
  const json = (/** @type {string} */ k) => { if (!datasetFiles.has(k)) throw Error(k + ': missing'); return JSON.parse(str(datasetFiles.get(k))) }
  const manifest = json('manifest.json'), index = json('index.json'), shards = /** @type {Record<string, any>} */ ({})
  for (const f of Array.isArray(manifest?.files?.shards) ? manifest.files.shards : []) if (typeof f === 'string' && SHARD.test(f) && datasetFiles.has(f)) shards[f.slice(9, -5)] = json(f)
  const indexHTML = str(distTree.get('index.html'))
  const site = siteURL || canonicalSite(indexHTML)
  if (!site) throw Error('no site URL: pass siteURL or give index.html a canonical link')
  const { files, entries } = prerender({ manifest, index, shards }, { siteURL: site })
  files.set('sitemap.xml', sitemapWith(str(distTree.get('sitemap.xml')), entries))
  if (indexHTML) files.set('index.html', withMarker(indexHTML))
  return files
}

async function main() {
  const arg = (/** @type {string} */ k) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3)
  const dist = path.resolve(arg('dist') || 'dist'), data = arg('data') ? path.resolve(/** @type {string} */ (arg('data'))) : path.join(dist, 'data')
  const tree = new Map()
  for (const f of ['index.html', 'sitemap.xml']) if (existsSync(path.join(dist, f))) tree.set(f, await readFile(path.join(dist, f), 'utf8'))
  let files
  try {
    const datasetFiles = new Map()
    for (const f of ['manifest.json', 'index.json']) if (existsSync(path.join(data, f))) datasetFiles.set(f, await readFile(path.join(data, f), 'utf8'))
    const shards = datasetFiles.has('manifest.json') ? JSON.parse(datasetFiles.get('manifest.json'))?.files?.shards : []
    for (const f of Array.isArray(shards) ? shards : []) if (typeof f === 'string' && SHARD.test(f) && existsSync(path.join(data, f))) datasetFiles.set(f, await readFile(path.join(data, f), 'utf8'))
    files = prerenderSite(datasetFiles, tree, { siteURL: arg('site-url') || process.env.SITE_URL || undefined })
  } catch (e) {
    console.warn(`::warning title=No project pages::the dataset in ${data} could not be used (${/** @type {Error} */ (e).message}); the site deploys without p/.`)
    return
  }
  await rm(path.join(dist, 'p'), { recursive: true, force: true })
  for (const [rel, text] of files) { const file = path.join(dist, rel); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text) }
  console.log(`Project pages: ${[...files.keys()].filter(k => /^p\/[^/]+\/index\.html$/.test(k)).length} in ${path.join(dist, 'p')}/, sitemap.xml and index.html updated`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
