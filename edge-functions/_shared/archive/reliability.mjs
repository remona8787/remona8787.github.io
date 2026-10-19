// Source reliability (docs/ARCHIVE_SPEC.md §3 "Reliability"): a base score by source kind, +10 for each further
// independent domain reporting the same candidate (at most +20), −30 for a broken link; and the candidate
// confidence round(0.6 × classifier score + 0.4 × best source reliability).
// The source kind comes from the publisher's domain where it is known (agencies, universities, official sites,
// specialist media, news), otherwise from the provider (a NAVER blog result is a blog, a Brave result a search result).

export const BASE = /** @type {const} */ ({ official: 90, public_agency: 85, academic: 85, wikidata: 70, specialist_media: 70, news: 55, search_result: 40, blog: 30 })
export const SOURCE_KINDS = /** @type {const} */ (['official', 'public_agency', 'academic', 'specialist_media', 'news', 'blog', 'wikidata', 'search_result'])

/** @typedef {typeof SOURCE_KINDS[number]} SourceKind */

// Second-level public suffixes that matter for the domains we see (registrable domain = one label more).
const MULTI_SUFFIX = new Set([
  'co.kr', 'or.kr', 'go.kr', 'ac.kr', 're.kr', 'ne.kr', 'pe.kr', 'seoul.kr', 'busan.kr', 'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'lg.jp',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'com.hk', 'gov.hk', 'edu.hk', 'org.hk', 'com.tw', 'gov.tw', 'edu.tw', 'org.tw',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au', 'co.nz', 'govt.nz', 'ac.nz', 'com.sg', 'gov.sg', 'edu.sg',
  'com.my', 'gov.my', 'co.th', 'go.th', 'ac.th', 'com.vn', 'gov.vn', 'co.id', 'go.id', 'ac.id', 'com.ph', 'gov.ph', 'co.in', 'gov.in', 'ac.in',
  'com.br', 'gov.br', 'org.br', 'com.mx', 'gob.mx', 'com.ar', 'gob.ar', 'com.co', 'gov.co', 'gob.es', 'com.tr', 'gov.tr', 'edu.tr', 'org.tr',
  'com.sa', 'gov.sa', 'gov.ae', 'ac.ae', 'co.za', 'gov.za', 'ac.za', 'com.eg', 'gov.eg', 'co.il', 'gov.il', 'ac.il', 'com.ru', 'gov.pl', 'edu.pl',
])

/** Registrable domain ("news.naver.com" → "naver.com", "www.yna.co.kr" → "yna.co.kr"). @param {string|null|undefined} host */
export function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  const parts = h.split('.').filter(Boolean)
  if (parts.length <= 2) return h
  const two = parts.slice(-2).join('.')
  return MULTI_SUFFIX.has(two) ? parts.slice(-3).join('.') : two
}

// Known domains (matched on the host and its parents). Specific entries win over the suffix rules below, so an
// official festival site on a government domain stays "official".
const DOMAINS = /** @type {Record<string, SourceKind>} */ ({
  // official sites of projects and festivals
  'vividsydney.com': 'official', 'fetedeslumieres.lyon.fr': 'official', 'lumiere-festival.com': 'official', 'amsterdamlightfestival.com': 'official',
  'ilightsingapore.gov.sg': 'official', 'gloweindhoven.nl': 'official', 'festival-of-lights.de': 'official', 'luminale.de': 'official',
  'burjkhalifa.ae': 'official', 'ars.electronica.art': 'official',
  // public agencies and tourism boards
  'seoul.go.kr': 'public_agency', 'visitseoul.net': 'public_agency', 'korea.kr': 'public_agency', 'knto.or.kr': 'public_agency', 'visitkorea.or.kr': 'public_agency',
  'mcst.go.kr': 'public_agency', 'arko.or.kr': 'public_agency', 'europa.eu': 'public_agency', 'unesco.org': 'public_agency',
  // academic
  'mediaarchitecture.org': 'academic', 'arxiv.org': 'academic', 'doi.org': 'academic', 'dl.acm.org': 'academic', 'acm.org': 'academic',
  'ieeexplore.ieee.org': 'academic', 'sciencedirect.com': 'academic', 'springer.com': 'academic', 'link.springer.com': 'academic',
  'tandfonline.com': 'academic', 'mdpi.com': 'academic', 'jstor.org': 'academic', 'researchgate.net': 'academic', 'dbpia.co.kr': 'academic',
  'kci.go.kr': 'academic', 'riss.kr': 'academic', 'scienceon.kisti.re.kr': 'academic', 'koreascience.or.kr': 'academic', 'cinii.ac.jp': 'academic',
  // specialist media
  'dezeen.com': 'specialist_media', 'designboom.com': 'specialist_media', 'archdaily.com': 'specialist_media', 'archdaily.cn': 'specialist_media',
  'archdaily.mx': 'specialist_media', 'archdaily.com.br': 'specialist_media', 'archdaily.cl': 'specialist_media', 'archdaily.kr': 'specialist_media',
  'archinect.com': 'specialist_media', 'creativeapplications.net': 'specialist_media', 'archpaper.com': 'specialist_media',
  'architizer.com': 'specialist_media', 'worldarchitecture.org': 'specialist_media', 'divisare.com': 'specialist_media', 'metalocus.es': 'specialist_media',
  'domusweb.it': 'specialist_media', 'detail.de': 'specialist_media', 'baunetz.de': 'specialist_media', 'architectural-review.com': 'specialist_media',
  'architectsjournal.co.uk': 'specialist_media', 'architecturalrecord.com': 'specialist_media', 'vmspace.com': 'specialist_media',
  'designdb.com': 'specialist_media', 'design.co.kr': 'specialist_media', 'casabrutus.com': 'specialist_media',
  'japan-architects.com': 'specialist_media', 'gooood.cn': 'specialist_media', 'stirworld.com': 'specialist_media',
  'frameweb.com': 'specialist_media', 'wallpaper.com': 'specialist_media',
  'mondo-arc.com': 'specialist_media', 'ledinside.com': 'specialist_media', 'avinteractive.com': 'specialist_media',
  // news
  'reuters.com': 'news', 'apnews.com': 'news', 'bbc.co.uk': 'news', 'bbc.com': 'news', 'cnn.com': 'news', 'nytimes.com': 'news',
  'theguardian.com': 'news', 'washingtonpost.com': 'news', 'bloomberg.com': 'news', 'afp.com': 'news', 'dw.com': 'news', 'aljazeera.com': 'news',
  'aljazeera.net': 'news', 'scmp.com': 'news', 'straitstimes.com': 'news', 'japantimes.co.jp': 'news', 'nhk.or.jp': 'news', 'asahi.com': 'news',
  'mainichi.jp': 'news', 'nikkei.com': 'news', 'yomiuri.co.jp': 'news', 'xinhuanet.com': 'news', 'news.cn': 'news', 'people.com.cn': 'news',
  'chinadaily.com.cn': 'news', 'yna.co.kr': 'news', 'yonhapnews.co.kr': 'news', 'newsis.com': 'news', 'news1.kr': 'news', 'koreaherald.com': 'news',
  'koreatimes.co.kr': 'news', 'joongang.co.kr': 'news', 'chosun.com': 'news', 'donga.com': 'news', 'hani.co.kr': 'news', 'khan.co.kr': 'news',
  'hankyung.com': 'news', 'mk.co.kr': 'news', 'seoul.co.kr': 'news', 'kmib.co.kr': 'news', 'segye.com': 'news', 'hankookilbo.com': 'news',
  'asiae.co.kr': 'news', 'heraldcorp.com': 'news', 'mt.co.kr': 'news', 'edaily.co.kr': 'news', 'fnnews.com': 'news', 'etnews.com': 'news',
  'zdnet.co.kr': 'news', 'dt.co.kr': 'news', 'newspim.com': 'news', 'nocutnews.co.kr': 'news', 'ohmynews.com': 'news', 'ytn.co.kr': 'news',
  'kbs.co.kr': 'news', 'imbc.com': 'news', 'sbs.co.kr': 'news', 'jtbc.co.kr': 'news', 'news.naver.com': 'news', 'n.news.naver.com': 'news',
  'news.daum.net': 'news', 'v.daum.net': 'news', 'spiegel.de': 'news', 'zeit.de': 'news', 'faz.net': 'news', 'sueddeutsche.de': 'news',
  'lemonde.fr': 'news', 'lefigaro.fr': 'news', 'liberation.fr': 'news', 'elpais.com': 'news', 'elmundo.es': 'news', 'lavanguardia.com': 'news',
  'repubblica.it': 'news', 'corriere.it': 'news', 'ansa.it': 'news', 'folha.uol.com.br': 'news', 'globo.com': 'news', 'nos.nl': 'news',
  'nu.nl': 'news', 'wyborcza.pl': 'news', 'tvn24.pl': 'news', 'rbc.ru': 'news', 'tass.ru': 'news', 'ria.ru': 'news', 'hurriyet.com.tr': 'news',
  'aa.com.tr': 'news', 'gulfnews.com': 'news', 'thenationalnews.com': 'news', 'arabnews.com': 'news', 'timeout.com': 'news', 'forbes.com': 'news',
  // blogs and self-publishing
  'blog.naver.com': 'blog', 'm.blog.naver.com': 'blog', 'post.naver.com': 'blog', 'tistory.com': 'blog', 'brunch.co.kr': 'blog', 'medium.com': 'blog',
  'wordpress.com': 'blog', 'blogspot.com': 'blog', 'substack.com': 'blog', 'note.com': 'blog', 'ameblo.jp': 'blog', 'hatenablog.com': 'blog',
  'velog.io': 'blog', 'cafe.naver.com': 'blog', 'reddit.com': 'blog', 'linkedin.com': 'blog', 'facebook.com': 'blog', 'instagram.com': 'blog',
  'x.com': 'blog', 'twitter.com': 'blog', 'youtube.com': 'blog', 'tiktok.com': 'blog', 'pinterest.com': 'blog', 'weibo.com': 'blog',
})

// Domain-suffix rules for agencies and universities that are not listed one by one.
const SUFFIX_RULES = /** @type {[RegExp, SourceKind][]} */ ([
  [/(^|\.)(go|or)\.kr$|(^|\.)(gov|mil)(\.[a-z]{2})?$|(^|\.)gouv\.fr$|(^|\.)go\.jp$|(^|\.)lg\.jp$|(^|\.)gob\.[a-z]{2}$|(^|\.)gv\.at$|(^|\.)admin\.ch$|(^|\.)bund\.de$|(^|\.)govt\.nz$|(^|\.)gc\.ca$|(^|\.)canada\.ca$|(^|\.)europa\.eu$/, 'public_agency'],
  [/(^|\.)(ac|re)\.kr$|(^|\.)edu(\.[a-z]{2})?$|(^|\.)ac\.[a-z]{2}$|(^|\.)uni-[a-z-]+\.de$|(^|\.)tu-[a-z-]+\.de$|(^|\.)univ-[a-z-]+\.fr$|(^|\.)(ethz|epfl)\.ch$/, 'academic'],
])

/** @type {Record<string, SourceKind>} */
const BY_PROVIDER = { gdelt: 'news', rss: 'specialist_media', websub: 'specialist_media', naver_news: 'news', naver_blog: 'blog', brave: 'search_result', wikidata: 'wikidata' }

/**
 * Source kind of a URL: a listed domain (or a parent of it), else an agency/university suffix, else the provider's
 * default. Note that "or.kr" covers Korean public institutes and foundations, which is why it counts as an agency.
 * @param {string|null|undefined} url @param {string} provider @returns {SourceKind}
 */
export function sourceKindFor(url, provider) {
  let host = ''
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '') } catch { /* not a URL */ }
  if (host) {
    const parts = host.split('.')
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts.slice(i).join('.')
      if (Object.prototype.hasOwnProperty.call(DOMAINS, d)) return DOMAINS[d]
    }
    for (const [re, kind] of SUFFIX_RULES) if (re.test(host)) return kind
  }
  return BY_PROVIDER[provider] || 'search_result'
}

/**
 * @param {SourceKind} kind @param {{independentDomains?: number, broken?: boolean}} [o]
 *   independentDomains: distinct registrable domains reporting the same candidate, this one included.
 */
export function reliability(kind, { independentDomains = 1, broken = false } = {}) {
  const base = BASE[kind] ?? BASE.search_result
  const bonus = Math.min(20, 10 * Math.max(0, Math.floor(independentDomains) - 1))
  return Math.max(0, Math.min(100, base + bonus - (broken ? 30 : 0)))
}

/** Candidate confidence. @param {number} score @param {number} bestReliability */
export const confidence = (score, bestReliability) => Math.round(0.6 * score + 0.4 * bestReliability)
