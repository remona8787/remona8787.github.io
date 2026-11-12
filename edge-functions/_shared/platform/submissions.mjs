// Submission checks (v2.0, docs/PLATFORM.md "Submissions"). Pure: the caller fetches the public index and does the
// network checks. duplicates() compares a submitted project with the archive's public index (data/index.json rows)
// and with other submissions; urlPolicy() says whether a submitted link may be fetched at all (no private hosts,
// no credentials in URLs, http(s) only). A person makes the final call on every submission.

const STOP = new Set('the and of de la le les der die das del di du a an 빛 축제 미디어 파사드 미디어파사드 media facade festival light lights lighting art show'.split(' '))
export function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKC').replace(/[()[\]{}·・,.:;'"“”‘’!?/\\|_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}
const tokens = (s) => normName(s).split(' ').filter((t) => t.length >= 2 && !STOP.has(t))
// Character bigrams catch Korean names without spaces (서울빛초롱축제 vs 서울 빛초롱 축제).
const bigrams = (s) => { const t = normName(s).replace(/\s+/g, ''); const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out }
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n) }

/** index: {fields, rows} as published in data/index.json. Returns the best matches above a threshold. */
export function duplicates(sub, index, { limit = 5, threshold = 0.45 } = {}) {
  const f = Object.fromEntries((index?.fields || []).map((k, i) => [k, i]))
  const names = [sub.name, sub.name_en].filter(Boolean)
  if (!names.length) return []
  const subBi = names.map(bigrams), subTok = new Set(names.flatMap(tokens))
  const out = []
  for (const r of index?.rows || []) {
    const cand = [r[f.name_ko], r[f.name_en], r[f.name_original]].filter(Boolean)
    let score = 0
    for (const c of cand) {
      const bi = bigrams(c)
      for (const s of subBi) score = Math.max(score, jaccard(s, bi))
      const ct = tokens(c)
      if (ct.length && ct.every((t) => subTok.has(t))) score = Math.max(score, 0.9)
    }
    const sameCountry = sub.country_iso2 && r[f.country_iso2] === sub.country_iso2
    const sameCity = sub.city && [r[f.city], r[f.city_ko]].some((c) => c && normName(c) === normName(sub.city))
    if (sub.country_iso2 && r[f.country_iso2] && !sameCountry) score *= 0.5
    if (sameCity) score = Math.min(1, score + 0.1)
    if (score >= threshold) out.push({ id: r[f.id], name: r[f.name_ko] || r[f.name_en] || r[f.name_original], country_iso2: r[f.country_iso2], city: r[f.city_ko] || r[f.city], score: Math.round(score * 100) / 100 })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

const PRIVATE_HOST = /^(?:localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f:]*\]?)$/i
/** Whether a submitted URL may be checked from the server. */
export function urlPolicy(raw) {
  let u
  try { u = new URL(String(raw)) } catch { return { ok: false, reason: 'malformed' } }
  if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: 'scheme' }
  if (u.username || u.password) return { ok: false, reason: 'credentials_in_url' }
  if (PRIVATE_HOST.test(u.hostname)) return { ok: false, reason: 'private_host' }
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return { ok: false, reason: 'port' }
  if (u.hostname.split('.').some((p) => p.startsWith('xn--'))) return { ok: true, url: u.href, note: 'punycode_host' }
  return { ok: true, url: u.href }
}
