export type CommonsInfo = {
  file: string
  filePage: string
  originalUrl: string
  cacheSourceUrl: string
  mime: string
  sha1: string
  modifiedAt: string | null
  creator: string
  licenseCode: string
  licenseUrl: string
  rightsStatement: string
  attributionText: string
  commercialAllowed: boolean
  derivativesAllowed: boolean
  rightsFingerprint: string
  rawMetadata: Record<string, unknown>
}

export function stripHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export function rightsDecision(license: string) {
  const normalized=license.trim().toLowerCase().replace(/[-_]/g,' ').replace(/\s+/g,' ')
  const allowed=/^(cc by(?: sa)? (?:1\.0|2\.0|2\.5|3\.0|4\.0)|cc0(?: 1\.0)?|public domain|pd)$/.test(normalized)
  return {commercialAllowed:allowed,derivativesAllowed:allowed}
}

export function hasRightsWarning(categories: string[], metadata: Record<string, any>) {
  const flags=categories.join(' ')+' '+stripHtml(metadata.Restrictions?.value)+' '+stripHtml(metadata.Permission?.value);
  return /no[ _-]?fop|non[ _-]?commercial|copyright violation|deletion request|permission required|fair use|비상업|허가 필요/i.test(flags);
}

export async function fetchCommonsInfo(file: string): Promise<CommonsInfo> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    prop: "imageinfo|categories",
    cllimit: "100",
    iiprop: "url|extmetadata|sha1|timestamp|mime",
    iiurlwidth: "1600",
    iiextmetadatafilter: "Artist|Credit|Attribution|LicenseShortName|UsageTerms|LicenseUrl|ImageDescription|Copyrighted|Restrictions|Permission",
    titles: `File:${file}`,
  })
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {signal:AbortSignal.timeout(15000)})
  if (!res.ok) throw new Error(`Commons metadata HTTP ${res.status}`)
  const json = await res.json()
  const page = Object.values(json?.query?.pages ?? {})[0] as any
  const ii = page?.imageinfo?.[0]
  if (!ii) throw new Error(`Commons file not found: ${file}`)

  const meta = ii.extmetadata ?? {}
  const licenseCode = stripHtml(meta.LicenseShortName?.value || meta.UsageTerms?.value || "Unknown")
  const licenseUrl = String(meta.LicenseUrl?.value || "")
  const creator = stripHtml(meta.Artist?.value || meta.Credit?.value || meta.Attribution?.value || "Wikimedia Commons contributor")
  const rightsStatement = stripHtml(meta.UsageTerms?.value || meta.Copyrighted?.value || licenseCode)
  const categories=(page.categories||[]).map((c:any)=>String(c.title||''));
  const warning=hasRightsWarning(categories,meta)||!!json.continue?.clcontinue;
  const decision=rightsDecision(licenseCode);
  const commercialAllowed=decision.commercialAllowed&&!warning, derivativesAllowed=decision.derivativesAllowed&&!warning;
  meta.aol_rights_categories=categories;
  meta.aol_rights_warning=warning;
  const filePage = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`
  const attributionText = `${creator} · ${licenseCode} · Wikimedia Commons`
  const originalUrl = String(ii.url || "")
  const cacheSourceUrl = String(ii.thumburl || ii.url || "")
  const sha1 = String(ii.sha1 || "")
  const modifiedAt = ii.timestamp ? String(ii.timestamp) : null
  const mime = String(ii.mime || "image/jpeg")

  const rightsFingerprint = await sha256Hex(JSON.stringify({
    creator,
    licenseCode,
    licenseUrl,
    rightsStatement,
    commercialAllowed,
    derivativesAllowed,
    filePage,
  }))

  return {
    file,
    filePage,
    originalUrl,
    cacheSourceUrl,
    mime,
    sha1,
    modifiedAt,
    creator,
    licenseCode,
    licenseUrl,
    rightsStatement,
    attributionText,
    commercialAllowed,
    derivativesAllowed,
    rightsFingerprint,
    rawMetadata: meta,
  }
}

export function extensionForMime(mime: string): string {
  if (mime.includes("png")) return "png"
  if (mime.includes("webp")) return "webp"
  if (mime.includes("avif")) return "avif"
  return "jpg"
}

export function safeSlug(input: string): string {
  return input
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "image"
}
