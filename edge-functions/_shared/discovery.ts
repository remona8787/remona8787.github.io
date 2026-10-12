export type CityRow = {
  id: string
  city_code: string
  name_en: string
  name_local: string | null
  country_id: string
  bbox_min_lat: number | null
  bbox_min_lng: number | null
  bbox_max_lat: number | null
  bbox_max_lng: number | null
  wikidata_id: string | null
  centroid_lat: number | null
  centroid_lng: number | null
}

export type RawCandidate = {
  provider: "osm_overpass" | "wikidata" | "foursquare" | "google_places" | "ticketmaster" | "manual"
  provider_id: string
  name: string
  name_local?: string | null
  candidate_type?: string | null
  category_tags?: string[]
  lat?: number | null
  lng?: number | null
  address_text?: string | null
  website_url?: string | null
  short_description?: string | null
  opening_hours_text?: string | null
  business_status?: string | null
  metadata?: Record<string, unknown>
}

export function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[()[\]{}\/·,:;'"“”‘’\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const STOP = new Set([
  "seoul","museum","the","art","gallery","center","centre","building","light","media","digital",
  "서울","미술관","갤러리","센터","아트","미디어","디지털","건축"
])

export function tokens(s: string): string[] {
  return norm(s).split(" ").filter((x) => x.length >= 2 && !STOP.has(x))
}

export function stringScore(a: string, b: string): number {
  const aa = norm(a), bb = norm(b)
  if (!aa || !bb) return 0
  if (aa === bb) return 100
  if (aa.includes(bb) || bb.includes(aa)) return 85
  const A = new Set(tokens(aa))
  const B = new Set(tokens(bb))
  let hit = 0
  for (const x of A) if (B.has(x)) hit++
  return hit ? Math.min(75, 25 + hit * 16) : 0
}

export function inferType(tags: string[] = [], rawText = ""): string {
  const text = `${tags.join(" ")} ${rawText}`.toLowerCase()
  if (/media.?facade|façade|facade|illuminated building/.test(text)) return "Media Facade"
  if (/immersive|projection|interactive/.test(text)) return "Immersive"
  if (/light art|illumination|light festival/.test(text)) return "Light Art"
  if (/media art|digital art/.test(text)) return "Media Art"
  return "Architecture"
}

export function relevanceForCandidate(c: RawCandidate): {
  score:number, confidence:number, tags:string[], reason:Record<string,unknown>, auto:boolean, inferredType:string
} {
  const tags = c.category_tags || []
  const type = c.candidate_type || inferType(tags, `${c.name} ${c.short_description || ""}`)
  const hay = `${c.name} ${c.short_description || ""} ${tags.join(" ")}`.toLowerCase()

  let score = 20
  let confidence = 40
  const matched: string[] = []

  const add = (n:number, key:string) => { score += n; matched.push(key) }
  if (/media.?facade|façade|facade/.test(hay)) add(36, "media_facade_keyword")
  if (/media art|digital art|new media/.test(hay)) add(26, "media_art_keyword")
  if (/immersive|projection mapping|interactive/.test(hay)) add(22, "immersive_keyword")
  if (/light art|illumination|illuminated/.test(hay)) add(20, "light_keyword")
  if (/museum|gallery|art center|arts centre|arts center/.test(hay)) add(12, "art_space_keyword")
  if (type === "Media Facade") add(18, "type_media_facade")
  if (type === "Media Art") add(14, "type_media_art")
  if (type === "Immersive") add(12, "type_immersive")
  if (type === "Light Art") add(12, "type_light_art")
  if (c.website_url) { confidence += 10; matched.push("website") }
  if (c.lat != null && c.lng != null) { confidence += 10; matched.push("geo") }
  if ((c.category_tags || []).length) { confidence += 6; matched.push("provider_tags") }

  score = Math.min(99, score)
  confidence = Math.min(99, confidence)
  const auto = score >= 72 && confidence >= 55
  return {
    score,
    confidence,
    tags: [...new Set([type, ...tags])],
    reason: { matched, provider: c.provider, inferred_type: type },
    auto,
    inferredType: type
  }
}

export function normalizeKey(name: string, lat?: number | null, lng?: number | null): string {
  const nm = norm(name).replace(/[^a-z0-9가-힣]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
  const la = lat == null ? "na" : (Math.round(lat * 1000) / 1000).toFixed(3)
  const ln = lng == null ? "na" : (Math.round(lng * 1000) / 1000).toFixed(3)
  return `${nm}:${la}:${ln}`
}

export async function fetchOverpassCityCandidates(city: CityRow, limit = 80): Promise<RawCandidate[]> {
  if (
    city.bbox_min_lat == null || city.bbox_min_lng == null ||
    city.bbox_max_lat == null || city.bbox_max_lng == null
  ) return []

  const bbox = `${city.bbox_min_lat},${city.bbox_min_lng},${city.bbox_max_lat},${city.bbox_max_lng}`
  const query = `
  [out:json][timeout:50];
  (
    nwr["tourism"="museum"](${bbox});
    nwr["tourism"="gallery"](${bbox});
    nwr["amenity"="arts_centre"](${bbox});
    nwr["building"="museum"](${bbox});
    nwr["building"="public"](${bbox});
    nwr["name"~"media|digital|light|illumination|projection",i](${bbox});
  );
  out center tags;`
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": "ArchitectureOfLight/0.10 (global discovery research app)"
    },
    body: query,
  })
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
  const json = await res.json()
  if(!Array.isArray(json?.elements))throw new Error("Invalid Overpass response")
  const items = json.elements as any[]
  return items.slice(0, limit).map((el) => {
    const tags = el.tags || {}
    const lat = el.lat ?? el.center?.lat ?? null
    const lng = el.lon ?? el.center?.lon ?? null
    const name = tags.name || tags["name:en"] || tags["name:ko"] || `OSM ${el.type} ${el.id}`
    return {
      provider: "osm_overpass",
      provider_id: `${el.type}/${el.id}`,
      name,
      name_local: tags["name:local"] || tags["name:ko"] || null,
      candidate_type: inferType(
        [tags.tourism, tags.amenity, tags.building, tags.office].filter(Boolean),
        `${name} ${tags.description || ""}`,
      ),
      category_tags: Object.entries(tags)
        .filter(([k]) => ["tourism","amenity","building","office","artwork_type"].includes(k))
        .map(([k,v]) => `${k}:${v}`),
      lat,
      lng,
      address_text: [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"]].filter(Boolean).join(" "),
      website_url: tags.website || tags.url || null,
      short_description: tags.description || null,
      opening_hours_text: tags.opening_hours || null,
      metadata: { osm_tags: tags }
    } as RawCandidate
  })
}

export async function fetchWikidataCityCandidates(city: CityRow, limit = 40): Promise<RawCandidate[]> {
  if (city.centroid_lat == null || city.centroid_lng == null) return []

  const query = `
SELECT DISTINCT ?item ?itemLabel ?coord ?website WHERE {
  VALUES ?class { wd:Q33506 wd:Q207694 }
  ?item wdt:P31/wdt:P279* ?class ;
        wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P856 ?website . }
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${city.centroid_lng} ${city.centroid_lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "35" .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ko". }
}
LIMIT ${limit}`

  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60000),
    headers: {
      "Accept": "application/sparql-results+json",
      "User-Agent": "ArchitectureOfLight/0.10 (global discovery research app)"
    }
  })
  if (!res.ok) throw new Error(`Provider HTTP ${res.status}`)

  const json = await res.json()
  if(!Array.isArray(json?.results?.bindings))throw new Error("Invalid Wikidata response")
  const bindings = json.results.bindings
  return bindings.map((b:any) => {
    const item = String(b.item?.value || "")
    const id = item.split("/").pop() || item
    const label = String(b.itemLabel?.value || id)
    let lat = null, lng = null
    const coord = String(b.coord?.value || "")
    const m = coord.match(/Point\(([-0-9.]+) ([-0-9.]+)\)/)
    if (m) { lng = Number(m[1]); lat = Number(m[2]) }
    return {
      provider: "wikidata",
      provider_id: id,
      name: label,
      candidate_type: "Architecture",
      category_tags: ["wikidata", "museum_or_art_museum"],
      lat,
      lng,
      website_url: String(b.website?.value || "") || null,
      short_description: "Wikidata museum / art museum candidate within city discovery radius",
      metadata: { wikidata_item: item }
    } as RawCandidate
  })
}
